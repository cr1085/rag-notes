// ============================================================
// rag.js
// Motor RAG principal: chunking, embeddings y pipeline completo
// Usa Transformers.js para generar embeddings en el navegador
// ============================================================

import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js';
import { saveChunks, saveEmbeddings, markNoteProcessed, searchSimilarChunks, saveQuery } from './supabaseClient.js';

// ── Configuración de Transformers.js ────────────────────────
// Usar modelos cacheados localmente cuando sea posible
env.allowLocalModels  = false;
env.useBrowserCache   = true;   // Cache en IndexedDB del navegador

// Nombre del modelo de embeddings (384 dimensiones)
const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';

// Pipeline singleton (se carga una sola vez)
let _embedder = null;

// ── Inicialización del modelo ────────────────────────────────

/**
 * Cargar e inicializar el modelo de embeddings
 * El modelo se descarga una vez y queda cacheado en el navegador (~25MB)
 * @param {Function} onProgress - Callback para reportar progreso de descarga
 * @returns {Promise<pipeline>}
 */
export async function loadEmbeddingModel(onProgress = null) {
    if (_embedder) return _embedder;

    console.log('⏳ Cargando modelo de embeddings:', EMBEDDING_MODEL);

    _embedder = await pipeline(
        'feature-extraction',
        EMBEDDING_MODEL,
        {
            progress_callback: onProgress,
            quantized: true,  // Usar versión cuantizada (más pequeña y rápida)
        }
    );

    console.log('✅ Modelo cargado correctamente');
    return _embedder;
}

// ── Generación de Embeddings ─────────────────────────────────

/**
 * Generar embedding para un texto
 * @param {string} text - Texto a vectorizar
 * @returns {Promise<Array<number>>} Vector de 384 dimensiones
 */
export async function generateEmbedding(text) {
    const embedder = await loadEmbeddingModel();

    const output = await embedder(text, {
        pooling: 'mean',       // Mean pooling: promedio de todos los tokens
        normalize: true,       // Normalizar el vector (requerido para similitud coseno)
    });

    // Convertir el tensor a array JavaScript plano
    return Array.from(output.data);
}

/**
 * Generar embeddings para múltiples textos (más eficiente que uno a uno)
 * @param {Array<string>} texts - Array de textos
 * @returns {Promise<Array<Array<number>>>} Array de vectores
 */
export async function generateEmbeddings(texts) {
    const embedder = await loadEmbeddingModel();

    const outputs = await Promise.all(
        texts.map(text => embedder(text, { pooling: 'mean', normalize: true }))
    );

    return outputs.map(output => Array.from(output.data));
}

// ── Chunking de Texto ────────────────────────────────────────

/**
 * Dividir texto en chunks con overlap
 * Estrategia: Por oraciones con ventana deslizante
 *
 * @param {string} text - Texto completo de la nota
 * @param {Object} options
 * @param {number} options.chunkSize    - Tamaño máximo de cada chunk en caracteres (default: 500)
 * @param {number} options.chunkOverlap - Caracteres de solapamiento entre chunks (default: 50)
 * @returns {Array<string>} Array de chunks de texto
 */
export function chunkText(text, { chunkSize = 500, chunkOverlap = 50 } = {}) {
    if (!text || text.trim().length === 0) return [];

    // Dividir en oraciones usando signos de puntuación
    const sentences = text
        .split(/(?<=[.!?])\s+/)
        .map(s => s.trim())
        .filter(s => s.length > 0);

    const chunks = [];
    let currentChunk = '';

    for (const sentence of sentences) {
        // Si agregar la oración excede el tamaño máximo, crear nuevo chunk
        if (currentChunk.length + sentence.length > chunkSize && currentChunk.length > 0) {
            chunks.push(currentChunk.trim());

            // Aplicar overlap: tomar los últimos N caracteres del chunk actual
            const overlapText = currentChunk.slice(-chunkOverlap);
            currentChunk = overlapText + ' ' + sentence;
        } else {
            currentChunk += (currentChunk ? ' ' : '') + sentence;
        }
    }

    // Agregar el último chunk si tiene contenido
    if (currentChunk.trim().length > 0) {
        chunks.push(currentChunk.trim());
    }

    // Si el texto es muy corto, retornarlo como un único chunk
    if (chunks.length === 0) {
        chunks.push(text.trim());
    }

    return chunks;
}

// ── Pipeline de Ingesta ──────────────────────────────────────

/**
 * Procesar una nota completa: chunking + embeddings + almacenamiento
 * Este es el pipeline principal de ingesta del sistema RAG
 *
 * @param {Object} note - { id, title, content }
 * @param {Object} options - Opciones de chunking
 * @param {Function} onProgress - Callback: ({ step, progress, message })
 * @returns {Promise<{ chunks: number, embeddings: number }>}
 */
export async function processNote(note, options = {}, onProgress = null) {
    const report = (step, progress, message) => {
        console.log(`[${step}] ${message}`);
        onProgress?.({ step, progress, message });
    };

    report('init', 0, `Iniciando procesamiento de "${note.title}"`);

    // 1. CHUNKING: Dividir el contenido en fragmentos manejables
    report('chunking', 10, 'Dividiendo nota en chunks...');
    const chunkTexts = chunkText(note.content, options);

    if (chunkTexts.length === 0) {
        throw new Error('La nota no tiene contenido suficiente para procesar');
    }

    report('chunking', 20, `${chunkTexts.length} chunks generados`);

    // 2. GUARDAR CHUNKS en Supabase
    report('saving-chunks', 30, 'Guardando chunks en base de datos...');
    const { data: savedChunks, error: chunksError } = await saveChunks(note.id, chunkTexts);

    if (chunksError) throw new Error(`Error guardando chunks: ${chunksError.message}`);

    report('saving-chunks', 40, `${savedChunks.length} chunks guardados`);

    // 3. GENERAR EMBEDDINGS para cada chunk
    report('embeddings', 50, 'Generando embeddings (puede tardar la primera vez)...');

    // Añadir el título al contexto del primer chunk para mejor relevancia
    const textsToEmbed = chunkTexts.map((chunk, i) =>
        i === 0 ? `${note.title}\n\n${chunk}` : chunk
    );

    const embeddingVectors = await generateEmbeddings(textsToEmbed);

    report('embeddings', 75, `${embeddingVectors.length} embeddings generados`);

    // 4. GUARDAR EMBEDDINGS en pgvector
    report('saving-embeddings', 80, 'Almacenando vectores en pgvector...');

    const embeddingRows = savedChunks.map((chunk, i) => ({
        chunk_id:   chunk.id,
        note_id:    note.id,
        embedding:  embeddingVectors[i],
        model_name: EMBEDDING_MODEL,
    }));

    const { error: embError } = await saveEmbeddings(embeddingRows);
    if (embError) throw new Error(`Error guardando embeddings: ${embError.message}`);

    // 5. MARCAR NOTA como procesada
    report('finalizing', 90, 'Finalizando...');
    await markNoteProcessed(note.id);

    report('done', 100, '✅ Nota procesada correctamente');

    return {
        chunks:     savedChunks.length,
        embeddings: embeddingRows.length,
    };
}

// ── Pipeline RAG (Query) ─────────────────────────────────────

/**
 * Pipeline RAG completo: pregunta → contexto → respuesta
 *
 * Flujo:
 * 1. Generar embedding de la pregunta
 * 2. Buscar chunks similares en pgvector
 * 3. Construir contexto con los chunks más relevantes
 * 4. Enviar al LLM con el contexto
 * 5. Retornar respuesta + fuentes
 *
 * @param {string} question - Pregunta del usuario
 * @param {Object} llmConfig - Configuración del LLM: { provider, model, apiKey, baseUrl }
 * @param {Object} searchOptions - { threshold, count }
 * @returns {Promise<{ answer, sources, question }>}
 */
export async function ragQuery(question, llmConfig, searchOptions = {}) {
    // 1. Generar embedding de la pregunta
    const questionEmbedding = await generateEmbedding(question);

    // 2. Buscar chunks similares
    const { data: similarChunks, error: searchError } = await searchSimilarChunks(
        questionEmbedding,
        searchOptions
    );

    if (searchError) throw new Error(`Error en búsqueda: ${searchError.message}`);

    if (!similarChunks || similarChunks.length === 0) {
        return {
            answer:   'No encontré información relevante en tus notas para responder esta pregunta.',
            sources:  [],
            question,
        };
    }

    // 3. Construir contexto con los chunks más relevantes
    const context = buildContext(similarChunks);

    // 4. Consultar al LLM
    const answer = await queryLLM(question, context, llmConfig);

    // 5. Guardar en historial
    await saveQuery({
        question,
        answer,
        contextChunks: similarChunks.map(c => c.chunk_id),
        modelUsed:     llmConfig.model,
        metadata:      { provider: llmConfig.provider, searchOptions },
    });

    return {
        answer,
        sources: similarChunks,
        question,
    };
}

// ── Construcción de Contexto ─────────────────────────────────

/**
 * Construir el contexto RAG a partir de chunks similares
 * @param {Array} chunks - Chunks con { note_title, chunk_content, similarity }
 * @returns {string} Contexto formateado para el LLM
 */
function buildContext(chunks) {
    const contextParts = chunks.map((chunk, i) => {
        const similarity = (chunk.similarity * 100).toFixed(1);
        return `[Fuente ${i + 1}: "${chunk.note_title}" (relevancia: ${similarity}%)]\n${chunk.chunk_content}`;
    });

    return contextParts.join('\n\n---\n\n');
}

// ── Integración con LLM ──────────────────────────────────────

/**
 * Enviar pregunta + contexto al LLM configurado
 * Soporta: Ollama, OpenRouter, OpenAI-compatible APIs
 *
 * @param {string} question - Pregunta del usuario
 * @param {string} context - Contexto construido de chunks
 * @param {Object} config - Configuración del LLM
 */
async function queryLLM(question, context, config) {
    const {
        provider = 'ollama',
        model    = 'llama3.2',
        apiKey   = '',
        baseUrl  = 'http://localhost:11434',
    } = config;

    const systemPrompt = `Eres un asistente inteligente que responde preguntas basándose EXCLUSIVAMENTE en las notas del usuario que se te proporcionan como contexto.

REGLAS:
1. Solo responde basándote en la información del contexto proporcionado
2. Si la información no está en el contexto, dilo claramente
3. Cita la fuente cuando sea relevante (ej: "Según tu nota sobre X...")
4. Responde en el mismo idioma que la pregunta
5. Sé conciso y claro

CONTEXTO DE LAS NOTAS:
${context}`;

    const userMessage = `Pregunta: ${question}`;

    // Seleccionar el endpoint según el proveedor
    const endpoints = {
        ollama:     `${baseUrl}/api/chat`,
        openrouter: 'https://openrouter.ai/api/v1/chat/completions',
        openai:     'https://api.openai.com/v1/chat/completions',
        custom:     `${baseUrl}/v1/chat/completions`,
    };

    const url = endpoints[provider] || endpoints.custom;

    const headers = {
        'Content-Type': 'application/json',
    };

    if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
    }

    if (provider === 'openrouter') {
        headers['HTTP-Referer'] = window.location.origin;
        headers['X-Title']     = 'RAG Notas Inteligentes';
    }

    // Formato del body según proveedor
    let body;
    if (provider === 'ollama') {
        // Formato específico de Ollama
        body = JSON.stringify({
            model,
            messages: [
                { role: 'system',    content: systemPrompt },
                { role: 'user',      content: userMessage  },
            ],
            stream: false,
            options: { temperature: 0.3 },
        });
    } else {
        // Formato OpenAI-compatible (OpenRouter, OpenAI, LM Studio, etc.)
        body = JSON.stringify({
            model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user',   content: userMessage  },
            ],
            temperature:  0.3,
            max_tokens:   1024,
        });
    }

    const response = await fetch(url, { method: 'POST', headers, body });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Error del LLM (${response.status}): ${errText}`);
    }

    const data = await response.json();

    // Extraer respuesta según formato del proveedor
    if (provider === 'ollama') {
        return data.message?.content || 'Sin respuesta del modelo';
    } else {
        return data.choices?.[0]?.message?.content || 'Sin respuesta del modelo';
    }
}
