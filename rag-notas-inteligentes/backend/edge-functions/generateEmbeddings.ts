// ============================================================
// edge-functions/generateEmbeddings.ts
// Supabase Edge Function: Genera embeddings para una nota
//
// Invocación:
// POST /functions/v1/generateEmbeddings
// Body: { noteId: "uuid" }
//
// Requiere variables de entorno en Supabase:
// - SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY
// ============================================================

import { serve }        from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Importar pipeline de Transformers.js para Deno
// Nota: En Deno/Edge Functions se puede usar el modelo desde HuggingFace
// Alternativa: usar la API de Inference de HuggingFace si hay límites de memoria

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── Chunking ─────────────────────────────────────────────────

function chunkText(text: string, chunkSize = 500, overlap = 50): string[] {
    const sentences = text.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);
    const chunks: string[] = [];
    let current = '';

    for (const sentence of sentences) {
        if (current.length + sentence.length > chunkSize && current.length > 0) {
            chunks.push(current.trim());
            current = current.slice(-overlap) + ' ' + sentence;
        } else {
            current += (current ? ' ' : '') + sentence;
        }
    }

    if (current.trim()) chunks.push(current.trim());
    return chunks.length > 0 ? chunks : [text.trim()];
}

// ── Generar embedding via HuggingFace Inference API ──────────
// Si prefieres ejecutar el modelo localmente en la Edge Function,
// considera usar @xenova/transformers (requiere más memoria RAM)

async function getEmbedding(text: string, hfToken?: string): Promise<number[]> {
    const MODEL = 'sentence-transformers/all-MiniLM-L6-v2';

    const response = await fetch(
        `https://api-inference.huggingface.co/pipeline/feature-extraction/${MODEL}`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                // Token de HuggingFace (gratuito) para mayor límite de rate
                ...(hfToken ? { 'Authorization': `Bearer ${hfToken}` } : {}),
            },
            body: JSON.stringify({
                inputs: text,
                options: { wait_for_model: true, use_cache: true },
            }),
        }
    );

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`HuggingFace API error: ${err}`);
    }

    // La API retorna un array 2D: [[embedding_values...]]
    // Necesitamos el primer elemento (single input)
    const result = await response.json();

    // Normalizar el vector (requerido para similitud coseno)
    const vector: number[] = Array.isArray(result[0]) ? result[0] : result;
    return normalizeVector(vector);
}

function normalizeVector(vec: number[]): number[] {
    const magnitude = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
    if (magnitude === 0) return vec;
    return vec.map(v => v / magnitude);
}

// ── Handler Principal ────────────────────────────────────────

serve(async (req: Request) => {
    // Manejar preflight CORS
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        // Parsear body
        const { noteId } = await req.json();

        if (!noteId) {
            return new Response(
                JSON.stringify({ error: 'noteId es requerido' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // Crear cliente de Supabase con service role key (sin RLS)
        const supabase = createClient(
            Deno.env.get('SUPABASE_URL')!,
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        );

        const hfToken = Deno.env.get('HUGGINGFACE_TOKEN');

        // 1. Obtener la nota
        const { data: note, error: noteError } = await supabase
            .from('notes')
            .select('id, title, content')
            .eq('id', noteId)
            .single();

        if (noteError || !note) {
            return new Response(
                JSON.stringify({ error: 'Nota no encontrada' }),
                { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // 2. Chunking del texto
        const chunkTexts = chunkText(note.content);

        // 3. Eliminar chunks y embeddings anteriores
        await supabase.from('chunks').delete().eq('note_id', noteId);

        // 4. Insertar nuevos chunks
        const { data: savedChunks, error: chunksErr } = await supabase
            .from('chunks')
            .insert(chunkTexts.map((content, i) => ({
                note_id:     noteId,
                content,
                chunk_index: i,
            })))
            .select();

        if (chunksErr) throw new Error(`Error guardando chunks: ${chunksErr.message}`);

        // 5. Generar embeddings en paralelo (con límite de concurrencia)
        const BATCH_SIZE = 5; // Procesar 5 a la vez para no sobrecargar la API
        const embeddingRows = [];

        for (let i = 0; i < savedChunks.length; i += BATCH_SIZE) {
            const batch = savedChunks.slice(i, i + BATCH_SIZE);
            const batchEmbeddings = await Promise.all(
                batch.map(async (chunk, idx) => {
                    const text = idx === 0 && i === 0
                        ? `${note.title}\n\n${chunk.content}`  // Añadir título al primer chunk
                        : chunk.content;
                    const embedding = await getEmbedding(text, hfToken);
                    return {
                        chunk_id:   chunk.id,
                        note_id:    noteId,
                        embedding,
                        model_name: 'sentence-transformers/all-MiniLM-L6-v2',
                    };
                })
            );
            embeddingRows.push(...batchEmbeddings);
        }

        // 6. Guardar embeddings en pgvector
        const { error: embErr } = await supabase
            .from('embeddings')
            .insert(embeddingRows);

        if (embErr) throw new Error(`Error guardando embeddings: ${embErr.message}`);

        // 7. Marcar nota como procesada
        await supabase
            .from('notes')
            .update({ is_processed: true })
            .eq('id', noteId);

        return new Response(
            JSON.stringify({
                success:    true,
                chunks:     savedChunks.length,
                embeddings: embeddingRows.length,
            }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

    } catch (error) {
        console.error('Error en generateEmbeddings:', error);
        return new Response(
            JSON.stringify({ error: error.message }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});
