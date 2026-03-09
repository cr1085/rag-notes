-- ============================================================
-- pgvector_setup.sql
-- Configuración inicial de la extensión pgvector en Supabase
-- Ejecutar PRIMERO antes que schema.sql
-- ============================================================

-- 1. Habilitar la extensión pgvector (disponible en Supabase por defecto)
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Verificar que la extensión esté activa
SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';

-- 3. Habilitar extensión uuid para generar IDs únicos
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 4. Habilitar pg_trgm para búsqueda de texto completo (complementa búsqueda vectorial)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- NOTAS PARA EL DESARROLLADOR:
-- - pgvector soporta vectores de hasta 2000 dimensiones
-- - all-MiniLM-L6-v2 genera vectores de 384 dimensiones
-- - Los índices IVFFLAT son más rápidos pero menos precisos que HNSW
-- - Los índices HNSW (disponibles en pgvector >= 0.5.0) son más lentos de construir
--   pero mucho más rápidos en búsqueda y más precisos
-- - Supabase usa pgvector >= 0.5.0, así que podemos usar HNSW
