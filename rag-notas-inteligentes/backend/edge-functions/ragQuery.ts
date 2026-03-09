// ============================================================
// edge-functions/ragQuery.ts
// Supabase Edge Function: Pipeline RAG completo
//
// Invocación:
// POST /functions/v1/ragQuery
// Body: {
//   question: "¿Qué es RAG?",
//   llmConfig: { provider, model, apiKey, baseUrl },
//   searchOptions?: { threshold, count }
// }
// ============================================================

import { serve }        from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── Embedding ────────────────────────────────────────────────

async function getEmbedding(text: string, hfToken?: string): Promise<number[]> {
    const response = await fetch(
        'https://api-inference.huggingface.co/pipeline/feature-extraction/sentence-transformers/all-MiniLM-L6-v2',
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(hfToken ? { 'Authorization': `Bearer ${hfToken}` } : {}),
            },
            body: JSON.stringify({ inputs: text, options: { wait_for_model: true } }),
        }
    );

    if (!response.ok) throw new Error(`HF API error: ${await response.text()}`);
    const result = await response.json();
    const vector: number[] = Array.isArray(result[0]) ? result[0] : result;
    const magnitude = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
    return magnitude === 0 ? vector : vector.map(v => v / magnitude);
}

// ── Contexto ─────────────────────────────────────────────────

function buildContext(chunks: any[]): string {
    return chunks
        .map((c, i) => `[Fuente ${i + 1}: "${c.note_title}" (relevancia: ${(c.similarity * 100).toFixed(1)}%)]\n${c.chunk_content}`)
        .join('\n\n---\n\n');
}

// ── LLM ──────────────────────────────────────────────────────

async function callLLM(question: string, context: string, config: any): Promise<string> {
    const {
        provider = 'ollama',
        model    = 'llama3.2',
        apiKey   = '',
        baseUrl  = 'http://localhost:11434',
    } = config;

    const systemPrompt = `Eres un asistente inteligente que responde preguntas basándose EXCLUSIVAMENTE en las notas del usuario que se te proporcionan como contexto.

REGLAS:
1. Solo responde basándote en la información del contexto
2. Si la información no está en el contexto, dilo claramente
3. Cita la fuente cuando sea relevante
4. Responde en el mismo idioma que la pregunta
5. Sé conciso y claro

CONTEXTO:
${context}`;

    const endpoints: Record<string, string> = {
        ollama:     `${baseUrl}/api/chat`,
        openrouter: 'https://openrouter.ai/api/v1/chat/completions',
        openai:     'https://api.openai.com/v1/chat/completions',
        custom:     `${baseUrl}/v1/chat/completions`,
    };

    const url = endpoints[provider] || endpoints.custom;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    let body: string;
    if (provider === 'ollama') {
        body = JSON.stringify({
            model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user',   content: question },
            ],
            stream:  false,
            options: { temperature: 0.3 },
        });
    } else {
        body = JSON.stringify({
            model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user',   content: question },
            ],
            temperature: 0.3,
            max_tokens:  1024,
        });
    }

    const response = await fetch(url, { method: 'POST', headers, body });
    if (!response.ok) throw new Error(`LLM error (${response.status}): ${await response.text()}`);

    const data = await response.json();
    return provider === 'ollama'
        ? data.message?.content
        : data.choices?.[0]?.message?.content;
}

// ── Handler ──────────────────────────────────────────────────

serve(async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    try {
        const { question, llmConfig = {}, searchOptions = {} } = await req.json();

        if (!question?.trim()) {
            return new Response(
                JSON.stringify({ error: 'question es requerido' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const supabase = createClient(
            Deno.env.get('SUPABASE_URL')!,
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        );

        const hfToken = Deno.env.get('HUGGINGFACE_TOKEN');
        const { threshold = 0.4, count = 5 } = searchOptions;

        // 1. Embedding de la pregunta
        const questionEmbedding = await getEmbedding(question, hfToken);

        // 2. Búsqueda semántica
        const { data: chunks, error: searchErr } = await supabase.rpc('match_chunks', {
            query_embedding:  questionEmbedding,
            match_threshold:  threshold,
            match_count:      count,
        });

        if (searchErr) throw new Error(searchErr.message);

        if (!chunks || chunks.length === 0) {
            return new Response(
                JSON.stringify({
                    answer:  'No encontré información relevante en tus notas para esta pregunta.',
                    sources: [],
                    question,
                }),
                { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // 3. Construir contexto y consultar LLM
        const context = buildContext(chunks);
        const answer  = await callLLM(question, context, llmConfig);

        // 4. Guardar en historial
        await supabase.from('queries').insert({
            question,
            answer,
            context_chunks: chunks.map((c: any) => c.chunk_id),
            model_used:     llmConfig.model || 'unknown',
            metadata:       { provider: llmConfig.provider, searchOptions },
        });

        return new Response(
            JSON.stringify({ answer, sources: chunks, question }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

    } catch (error) {
        console.error('RAG query error:', error);
        return new Response(
            JSON.stringify({ error: error.message }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});
