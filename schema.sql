-- ============================================================
-- schema.sql
-- Esquema principal de la base de datos para RAG Notas Inteligentes
-- Ejecutar DESPUÉS de pgvector_setup.sql
-- ============================================================

-- ============================================================
-- TABLA: notes
-- Almacena las notas originales del usuario
-- ============================================================
CREATE TABLE IF NOT EXISTS notes (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title       TEXT NOT NULL,
    content     TEXT NOT NULL,
    tags        TEXT[] DEFAULT '{}',           -- Arreglo de etiquetas para filtrado
    metadata    JSONB DEFAULT '{}',            -- Metadatos adicionales flexibles
    is_processed BOOLEAN DEFAULT FALSE,        -- Flag: ¿ya se generaron embeddings?
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Índice para búsqueda de texto completo en notas
CREATE INDEX IF NOT EXISTS idx_notes_content_fts
    ON notes USING GIN (to_tsvector('spanish', content));

CREATE INDEX IF NOT EXISTS idx_notes_title_fts
    ON notes USING GIN (to_tsvector('spanish', title));

-- Índice en tags para filtrado rápido
CREATE INDEX IF NOT EXISTS idx_notes_tags
    ON notes USING GIN (tags);

-- Índice en is_processed para encontrar notas sin embeddings
CREATE INDEX IF NOT EXISTS idx_notes_is_processed
    ON notes (is_processed);


-- ============================================================
-- TABLA: chunks
-- Fragmentos de texto derivados de las notas (chunking)
-- Cada nota puede tener múltiples chunks para RAG más preciso
-- ============================================================
CREATE TABLE IF NOT EXISTS chunks (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    note_id     UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    content     TEXT NOT NULL,               -- Contenido del chunk
    chunk_index INTEGER NOT NULL,            -- Posición del chunk en la nota (0-based)
    start_char  INTEGER,                     -- Posición de inicio en el texto original
    end_char    INTEGER,                     -- Posición de fin en el texto original
    metadata    JSONB DEFAULT '{}',          -- e.g., { "overlap": 50, "strategy": "sentence" }
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Índice para obtener todos los chunks de una nota rápidamente
CREATE INDEX IF NOT EXISTS idx_chunks_note_id
    ON chunks (note_id);

-- Índice compuesto para ordenar chunks de una nota en orden
CREATE INDEX IF NOT EXISTS idx_chunks_note_order
    ON chunks (note_id, chunk_index);


-- ============================================================
-- TABLA: embeddings
-- Vectores de embeddings generados para cada chunk
-- Tabla separada de chunks para mayor flexibilidad
-- ============================================================
CREATE TABLE IF NOT EXISTS embeddings (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    chunk_id    UUID NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
    note_id     UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,  -- Desnormalización para JOINs más rápidos
    embedding   vector(384),                 -- 384 dims para all-MiniLM-L6-v2
                                             -- Cambiar a 768 si se usa un modelo más grande
    model_name  TEXT DEFAULT 'all-MiniLM-L6-v2',  -- Modelo usado para generar el embedding
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ÍNDICE VECTORIAL HNSW (Hierarchical Navigable Small World)
-- Mejor rendimiento en búsqueda para la mayoría de casos de uso
-- cosine: mejor para similitud semántica (recomendado para embeddings de texto)
-- ip: producto interno (útil cuando los vectores están normalizados)
-- l2: distancia euclidiana (para embedding de imágenes o features numéricas)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_embeddings_hnsw
    ON embeddings USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);
-- m: número de conexiones por nodo (16 es buen balance velocidad/calidad)
-- ef_construction: tamaño del grafo durante construcción (64 = balance)

-- Índice para filtrar por nota
CREATE INDEX IF NOT EXISTS idx_embeddings_note_id
    ON embeddings (note_id);

-- Índice para filtrar por chunk
CREATE INDEX IF NOT EXISTS idx_embeddings_chunk_id
    ON embeddings (chunk_id);


-- ============================================================
-- TABLA: queries
-- Historial de preguntas y respuestas del usuario (RAG)
-- ============================================================
CREATE TABLE IF NOT EXISTS queries (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    question        TEXT NOT NULL,           -- Pregunta original del usuario
    answer          TEXT,                    -- Respuesta generada por el LLM
    context_chunks  UUID[],                  -- IDs de chunks usados como contexto
    model_used      TEXT,                    -- Modelo LLM usado para responder
    embedding       vector(384),             -- Embedding de la pregunta (para analytics)
    metadata        JSONB DEFAULT '{}',      -- e.g., { "temperature": 0.7, "tokens": 512 }
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Índice para historial ordenado por fecha
CREATE INDEX IF NOT EXISTS idx_queries_created_at
    ON queries (created_at DESC);


-- ============================================================
-- FUNCIÓN: match_chunks
-- Búsqueda semántica de chunks por similitud de coseno
-- Retorna los N chunks más similares a un embedding de consulta
-- ============================================================
CREATE OR REPLACE FUNCTION match_chunks(
    query_embedding  vector(384),    -- Embedding de la pregunta del usuario
    match_threshold  FLOAT DEFAULT 0.5,   -- Umbral mínimo de similitud (0-1)
    match_count      INT   DEFAULT 5      -- Número máximo de resultados
)
RETURNS TABLE (
    chunk_id    UUID,
    note_id     UUID,
    note_title  TEXT,
    chunk_content TEXT,
    similarity  FLOAT
)
LANGUAGE SQL STABLE
AS $$
    SELECT
        c.id                                        AS chunk_id,
        n.id                                        AS note_id,
        n.title                                     AS note_title,
        c.content                                   AS chunk_content,
        1 - (e.embedding <=> query_embedding)       AS similarity
    FROM embeddings e
    JOIN chunks  c ON c.id = e.chunk_id
    JOIN notes   n ON n.id = e.note_id
    WHERE 1 - (e.embedding <=> query_embedding) > match_threshold
    ORDER BY e.embedding <=> query_embedding  -- Ordenar por distancia (menor = más similar)
    LIMIT match_count;
$$;


-- ============================================================
-- FUNCIÓN: update_updated_at
-- Trigger para actualizar automáticamente updated_at en notes
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_notes_updated_at
    BEFORE UPDATE ON notes
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();


-- ============================================================
-- ROW LEVEL SECURITY (RLS) - Seguridad por usuario
-- Habilitar cuando se use autenticación de Supabase Auth
-- ============================================================

-- Habilitar RLS en todas las tablas sensibles
ALTER TABLE notes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE chunks     ENABLE ROW LEVEL SECURITY;
ALTER TABLE embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE queries    ENABLE ROW LEVEL SECURITY;

-- POLÍTICA DE EJEMPLO (descomentar y adaptar cuando se implemente auth)
-- CREATE POLICY "Users can only see their own notes"
--     ON notes FOR ALL
--     USING (auth.uid() = user_id);  -- Requiere añadir columna user_id UUID a notes

-- Para desarrollo sin auth, crear política pública temporal:
CREATE POLICY "Allow all for development"
    ON notes FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all for development"
    ON chunks FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all for development"
    ON embeddings FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all for development"
    ON queries FOR ALL USING (true) WITH CHECK (true);


-- ============================================================
-- DATOS DE PRUEBA (comentar en producción)
-- ============================================================
INSERT INTO notes (title, content, tags) VALUES
(
    'Introducción a RAG',
    'RAG (Retrieval Augmented Generation) es una técnica que combina búsqueda de información con generación de texto. Permite a los LLMs responder preguntas basadas en una base de conocimiento específica, reduciendo las alucinaciones y mejorando la precisión de las respuestas.',
    ARRAY['IA', 'RAG', 'LLM']
),
(
    'pgvector en Supabase',
    'pgvector es una extensión de PostgreSQL que permite almacenar y buscar vectores de alta dimensión. Supabase lo incluye por defecto. Soporta búsqueda por similitud coseno, distancia euclidiana y producto interno. Es ideal para almacenar embeddings de texto.',
    ARRAY['base-de-datos', 'vectores', 'supabase']
),
(
    'Modelos de embeddings',
    'Los embeddings son representaciones numéricas del significado del texto. all-MiniLM-L6-v2 es un modelo eficiente de 384 dimensiones. Transformers.js permite ejecutar modelos de embeddings directamente en el navegador usando WebAssembly, sin necesidad de servidor.',
    ARRAY['embeddings', 'NLP', 'modelos']
);
