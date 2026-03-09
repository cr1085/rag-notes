// ============================================================
// supabaseClient.js
// Cliente de Supabase para el frontend
// Punto único de conexión con la base de datos
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ── Configuración ────────────────────────────────────────────
// Reemplazar con tus credenciales de Supabase
// Puedes encontrarlas en: Project Settings → API
const SUPABASE_URL  = window.ENV?.SUPABASE_URL  || 'https://TU_PROYECTO.supabase.co';
const SUPABASE_ANON = window.ENV?.SUPABASE_ANON || 'TU_ANON_KEY';

// ── Crear cliente ────────────────────────────────────────────
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

// ── API de Notas ─────────────────────────────────────────────

/**
 * Obtener todas las notas ordenadas por fecha de creación
 * @returns {Promise<{data: Array, error: Object}>}
 */
export async function getNotes() {
    return supabase
        .from('notes')
        .select('id, title, content, tags, is_processed, created_at, updated_at')
        .order('created_at', { ascending: false });
}

/**
 * Obtener una nota por ID incluyendo sus chunks
 * @param {string} id - UUID de la nota
 */
export async function getNoteById(id) {
    return supabase
        .from('notes')
        .select(`
            *,
            chunks (id, content, chunk_index)
        `)
        .eq('id', id)
        .single();
}

/**
 * Crear una nueva nota
 * @param {Object} note - { title, content, tags }
 */
export async function createNote({ title, content, tags = [] }) {
    return supabase
        .from('notes')
        .insert({ title, content, tags, is_processed: false })
        .select()
        .single();
}

/**
 * Actualizar una nota existente
 * @param {string} id - UUID de la nota
 * @param {Object} updates - Campos a actualizar
 */
export async function updateNote(id, updates) {
    return supabase
        .from('notes')
        .update({ ...updates, is_processed: false }) // Re-procesar al editar
        .eq('id', id)
        .select()
        .single();
}

/**
 * Eliminar una nota y todos sus chunks/embeddings (CASCADE)
 * @param {string} id - UUID de la nota
 */
export async function deleteNote(id) {
    return supabase
        .from('notes')
        .delete()
        .eq('id', id);
}

/**
 * Marcar nota como procesada (embeddings generados)
 * @param {string} id - UUID de la nota
 */
export async function markNoteProcessed(id) {
    return supabase
        .from('notes')
        .update({ is_processed: true })
        .eq('id', id);
}

// ── API de Chunks ────────────────────────────────────────────

/**
 * Guardar múltiples chunks para una nota
 * Elimina chunks existentes antes de insertar (re-procesamiento)
 * @param {string} noteId - UUID de la nota
 * @param {Array<string>} chunkTexts - Array de textos de chunks
 */
export async function saveChunks(noteId, chunkTexts) {
    // Eliminar chunks anteriores si existen
    await supabase.from('chunks').delete().eq('note_id', noteId);

    const chunks = chunkTexts.map((content, index) => ({
        note_id:     noteId,
        content,
        chunk_index: index,
    }));

    return supabase
        .from('chunks')
        .insert(chunks)
        .select();
}

// ── API de Embeddings ────────────────────────────────────────

/**
 * Guardar embeddings para los chunks de una nota
 * @param {Array<Object>} embeddingRows - [{ chunk_id, note_id, embedding, model_name }]
 */
export async function saveEmbeddings(embeddingRows) {
    // Eliminar embeddings anteriores para los chunks dados
    const chunkIds = embeddingRows.map(r => r.chunk_id);
    await supabase.from('embeddings').delete().in('chunk_id', chunkIds);

    return supabase
        .from('embeddings')
        .insert(embeddingRows)
        .select('id');
}

/**
 * Búsqueda semántica usando la función match_chunks de PostgreSQL
 * @param {Array<number>} queryEmbedding - Vector de 384 dimensiones
 * @param {Object} options - { threshold: 0.5, count: 5 }
 */
export async function searchSimilarChunks(queryEmbedding, options = {}) {
    const { threshold = 0.5, count = 5 } = options;

    return supabase.rpc('match_chunks', {
        query_embedding:  queryEmbedding,
        match_threshold:  threshold,
        match_count:      count,
    });
}

// ── API de Queries (Historial) ───────────────────────────────

/**
 * Guardar una consulta RAG en el historial
 * @param {Object} query - { question, answer, context_chunks, model_used, metadata }
 */
export async function saveQuery({ question, answer, contextChunks = [], modelUsed, metadata = {} }) {
    return supabase
        .from('queries')
        .insert({
            question,
            answer,
            context_chunks: contextChunks,
            model_used:     modelUsed,
            metadata,
        })
        .select()
        .single();
}

/**
 * Obtener historial de consultas ordenado por fecha
 * @param {number} limit - Número máximo de consultas a retornar
 */
export async function getQueryHistory(limit = 20) {
    return supabase
        .from('queries')
        .select('id, question, answer, model_used, created_at')
        .order('created_at', { ascending: false })
        .limit(limit);
}
