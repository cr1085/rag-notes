// ============================================================
// edge-functions/searchSimilar.ts
// Supabase Edge Function: Búsqueda semántica
//
// Invocación:
// POST /functions/v1/searchSimilar
// Body: { query: "texto de búsqueda", threshold?: 0.5, count?: 5 }
// ============================================================

import { serve }        from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function getEmbedding(text: string, hfToken?: string): Promise<number[]> {
    const MODEL = 'sentence-transformers/all-MiniLM-L6-v2';

    const response = await fetch(
        `https://api-inference.huggingface.co/pipeline/feature-extraction/${MODEL}`,
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

    // Normalizar para similitud coseno
    const magnitude = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
    return magnitude === 0 ? vector : vector.map(v => v / magnitude);
}

serve(async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    try {
        const { query, threshold = 0.5, count = 5 } = await req.json();

        if (!query || query.trim().length < 2) {
            return new Response(
                JSON.stringify({ error: 'query debe tener al menos 2 caracteres' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const supabase = createClient(
            Deno.env.get('SUPABASE_URL')!,
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        );

        const hfToken = Deno.env.get('HUGGINGFACE_TOKEN');

        // Generar embedding de la query
        const queryEmbedding = await getEmbedding(query, hfToken);

        // Búsqueda vectorial usando función RPC
        const { data, error } = await supabase.rpc('match_chunks', {
            query_embedding:  queryEmbedding,
            match_threshold:  threshold,
            match_count:      count,
        });

        if (error) throw new Error(error.message);

        return new Response(
            JSON.stringify({ results: data || [], count: (data || []).length }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

    } catch (error) {
        return new Response(
            JSON.stringify({ error: error.message }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});
