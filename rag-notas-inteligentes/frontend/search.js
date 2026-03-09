// ============================================================
// search.js
// Módulo de búsqueda: semántica (vectorial) + texto completo
// Combina ambas estrategias para mejores resultados (hybrid search)
// ============================================================

import { generateEmbedding } from './rag.js';
import { searchSimilarChunks, supabase } from './supabaseClient.js';

// ── Búsqueda Semántica ───────────────────────────────────────

/**
 * Búsqueda semántica usando pgvector
 * Encuentra chunks cuyo significado es similar a la query,
 * incluso si no comparten palabras exactas.
 *
 * @param {string} query - Texto de búsqueda del usuario
 * @param {Object} options - { threshold: 0.4, count: 8 }
 * @returns {Promise<Array>} Resultados con { note_id, note_title, chunk_content, similarity }
 */
export async function semanticSearch(query, options = {}) {
    const { threshold = 0.4, count = 8 } = options;

    if (!query || query.trim().length < 3) {
        return { data: [], error: null };
    }

    // Generar embedding de la query
    const queryEmbedding = await generateEmbedding(query.trim());

    // Buscar en pgvector
    const { data, error } = await searchSimilarChunks(queryEmbedding, { threshold, count });

    if (error) {
        console.error('Error en búsqueda semántica:', error);
        return { data: [], error };
    }

    // Deduplicar por nota (si múltiples chunks de la misma nota coinciden,
    // conservar solo el más similar)
    const deduped = deduplicateByNote(data || []);

    return { data: deduped, error: null };
}

// ── Búsqueda de Texto Completo ───────────────────────────────

/**
 * Búsqueda de texto completo usando PostgreSQL full-text search
 * Más rápida que semántica pero requiere coincidencia de palabras exactas.
 *
 * @param {string} query - Texto a buscar
 * @param {Object} options - { limit: 10 }
 * @returns {Promise<Array>} Notas que contienen las palabras buscadas
 */
export async function fullTextSearch(query, options = {}) {
    const { limit = 10 } = options;

    if (!query || query.trim().length < 2) {
        return { data: [], error: null };
    }

    // Formato de búsqueda FTS: palabras separadas por & (AND) o | (OR)
    const ftsQuery = query.trim().split(/\s+/).join(' & ');

    const { data, error } = await supabase
        .from('notes')
        .select('id, title, content, tags, created_at')
        .textSearch('content', ftsQuery, {
            type:   'websearch',  // Soporta frases entre comillas y operadores
            config: 'spanish',
        })
        .limit(limit);

    return { data: data || [], error };
}

// ── Búsqueda Híbrida ─────────────────────────────────────────

/**
 * Combina búsqueda semántica + texto completo para mejores resultados
 * Los resultados semánticos tienen mayor peso por defecto.
 *
 * @param {string} query - Texto de búsqueda
 * @param {Object} options - Opciones para ambos tipos de búsqueda
 * @returns {Promise<{ semantic: Array, fullText: Array, combined: Array }>}
 */
export async function hybridSearch(query, options = {}) {
    // Ejecutar ambas búsquedas en paralelo
    const [semanticResult, ftsResult] = await Promise.all([
        semanticSearch(query, { threshold: 0.35, count: 6, ...options }),
        fullTextSearch(query, { limit: 6 }),
    ]);

    // Combinar y rankear resultados
    const combined = mergeResults(
        semanticResult.data,
        ftsResult.data,
    );

    return {
        semantic:  semanticResult.data,
        fullText:  ftsResult.data,
        combined,
    };
}

// ── Utilidades ───────────────────────────────────────────────

/**
 * Deduplicar resultados por nota_id, conservando el chunk más similar
 * @param {Array} chunks - Array de resultados de búsqueda
 * @returns {Array} Array sin duplicados por nota
 */
function deduplicateByNote(chunks) {
    const seen = new Map();

    for (const chunk of chunks) {
        const existing = seen.get(chunk.note_id);
        if (!existing || chunk.similarity > existing.similarity) {
            seen.set(chunk.note_id, chunk);
        }
    }

    return Array.from(seen.values())
        .sort((a, b) => b.similarity - a.similarity);
}

/**
 * Combinar resultados semánticos y FTS con scoring
 * Asigna score final: semantic (peso 0.7) + fts (peso 0.3)
 */
function mergeResults(semanticResults, ftsResults) {
    const noteScores = new Map();

    // Agregar scores de búsqueda semántica (peso mayor)
    semanticResults.forEach((result, i) => {
        const score = (result.similarity || 0) * 0.7;
        const existing = noteScores.get(result.note_id) || {
            note_id:    result.note_id,
            note_title: result.note_title,
            content:    result.chunk_content || '',
            score:      0,
            type:       'semantic',
        };
        existing.score += score;
        noteScores.set(result.note_id, existing);
    });

    // Agregar scores de FTS (peso menor)
    ftsResults.forEach((note, i) => {
        // Score basado en posición (primeros resultados tienen mejor score)
        const ftsScore = (1 - i / ftsResults.length) * 0.3;
        const existing = noteScores.get(note.id) || {
            note_id:    note.id,
            note_title: note.title,
            content:    note.content?.substring(0, 200) || '',
            score:      0,
            type:       'fts',
        };
        existing.score += ftsScore;
        if (existing.type === 'semantic') existing.type = 'hybrid';
        noteScores.set(note.id, existing);
    });

    // Ordenar por score final descendente
    return Array.from(noteScores.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, 8);  // Top 8 resultados
}

/**
 * Resaltar términos de búsqueda en un texto
 * @param {string} text - Texto donde resaltar
 * @param {string} query - Términos de búsqueda
 * @returns {string} HTML con términos resaltados con <mark>
 */
export function highlightTerms(text, query) {
    if (!query || !text) return text;

    const terms = query.trim().split(/\s+/).filter(t => t.length > 2);
    if (terms.length === 0) return text;

    const pattern = new RegExp(`(${terms.map(escapeRegex).join('|')})`, 'gi');
    return text.replace(pattern, '<mark class="highlight">$1</mark>');
}

/** Escapar caracteres especiales de regex */
function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
