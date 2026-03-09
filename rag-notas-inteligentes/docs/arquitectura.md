# 🏗️ Arquitectura — RAG Notas Inteligentes

## Visión General

RAG Notas Inteligentes es un sistema de "segundo cerebro" basado en **Retrieval Augmented Generation**. Combina almacenamiento vectorial, modelos de embeddings open-source y LLMs para responder preguntas basándose en el conocimiento personal del usuario.

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND (Browser)                       │
│                                                                  │
│  index.html ──► app.js (orquestador)                            │
│                  ├── supabaseClient.js  (acceso a datos)         │
│                  ├── rag.js             (embeddings + pipeline)  │
│                  ├── search.js          (búsqueda híbrida)       │
│                  └── ui.js              (renderizado)            │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTP / Supabase JS SDK
┌────────────────────────────▼────────────────────────────────────┐
│                    SUPABASE BACKEND                              │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────────┐   │
│  │ Edge Function │  │ Edge Function │  │    Edge Function     │   │
│  │generateEmbed. │  │ searchSimilar │  │     ragQuery         │   │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬──────────┘   │
│         │                 │                       │              │
│  ┌──────▼─────────────────▼───────────────────────▼───────────┐ │
│  │                   PostgreSQL + pgvector                      │ │
│  │                                                              │ │
│  │  notes ──► chunks ──► embeddings (vector 384d)              │ │
│  │  queries (historial)                                         │ │
│  │                                                              │ │
│  │  FUNCIÓN: match_chunks(query_embedding, threshold, count)   │ │
│  └──────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                             │
              ┌──────────────▼──────────────┐
              │     LLM PROVIDER             │
              │  Ollama / OpenRouter /        │
              │  OpenAI-compatible / Custom   │
              └──────────────────────────────┘
```

---

## Módulos del Frontend

### `app.js` — Orquestador
- Gestiona el **estado global** de la aplicación (`state`)
- Controla la **navegación** entre vistas
- Coordina los módulos: conecta eventos de UI con lógica de negocio
- Persiste configuración del LLM en `localStorage`

### `supabaseClient.js` — Capa de Datos
- **Punto único** de acceso a Supabase
- Funciones CRUD para notas, chunks, embeddings y queries
- Abstrae completamente el SDK de Supabase del resto del código

### `rag.js` — Motor RAG
- Carga y gestiona el modelo de embeddings (`all-MiniLM-L6-v2`) via Transformers.js
- Función `chunkText()`: divide texto en fragmentos con overlap
- Función `processNote()`: pipeline completo de ingesta
- Función `ragQuery()`: pipeline completo de consulta
- Función `queryLLM()`: integración multi-proveedor (Ollama, OpenRouter, etc.)

### `search.js` — Búsqueda
- `semanticSearch()`: búsqueda por similitud vectorial en pgvector
- `fullTextSearch()`: búsqueda de texto completo con PostgreSQL FTS
- `hybridSearch()`: combinación de ambas con scoring ponderado

### `ui.js` — Presentación
- Funciones de renderizado puras (sin estado)
- Renderiza notas, editor, resultados de búsqueda y chat
- Gestión de toasts, overlays y barras de progreso

---

## Pipeline de Ingesta (Write Path)

```
Usuario escribe nota
        │
        ▼
[1] createNote() → Supabase notes table
        │
        ▼
[2] chunkText() → Array de strings
    - Tamaño: 500 chars
    - Overlap: 50 chars
    - Estrategia: por oraciones
        │
        ▼
[3] saveChunks() → Supabase chunks table
        │
        ▼
[4] generateEmbeddings() → Transformers.js (browser)
    - Modelo: all-MiniLM-L6-v2
    - Dimensiones: 384
    - Pooling: mean + normalize
        │
        ▼
[5] saveEmbeddings() → Supabase embeddings (pgvector)
        │
        ▼
[6] markNoteProcessed() → notes.is_processed = true
```

## Pipeline de Consulta (Read Path / RAG)

```
Usuario hace pregunta
        │
        ▼
[1] generateEmbedding(question) → vector[384]
        │
        ▼
[2] searchSimilarChunks() → supabase.rpc('match_chunks')
    - Distancia: coseno
    - Índice: HNSW
    - Umbral: 0.4
    - Top K: 5
        │
        ▼
[3] buildContext() → Texto estructurado con fuentes
        │
        ▼
[4] queryLLM() → POST al proveedor configurado
    - System prompt con instrucciones RAG
    - Contexto de chunks
    - Temperatura: 0.3 (respuestas más deterministas)
        │
        ▼
[5] saveQuery() → historial en tabla queries
        │
        ▼
[6] Mostrar respuesta + fuentes al usuario
```

---

## Modelo de Datos

```sql
notes (1) ──────────────────── (N) chunks
    id UUID PK                      id UUID PK
    title TEXT                      note_id UUID FK
    content TEXT                    content TEXT
    tags TEXT[]                     chunk_index INT
    is_processed BOOL               start_char INT
    metadata JSONB                  end_char INT
    created_at TIMESTAMPTZ          created_at TIMESTAMPTZ
    updated_at TIMESTAMPTZ
                                         │
chunks (1) ──────────────────── (1) embeddings
                                     id UUID PK
                                     chunk_id UUID FK
                                     note_id UUID FK (desnorm.)
                                     embedding vector(384)
                                     model_name TEXT
                                     created_at TIMESTAMPTZ

queries (standalone)
    id UUID PK
    question TEXT
    answer TEXT
    context_chunks UUID[]
    model_used TEXT
    embedding vector(384)
    metadata JSONB
    created_at TIMESTAMPTZ
```

---

## Decisiones de Diseño

| Decisión | Elección | Alternativas | Razón |
|----------|----------|--------------|-------|
| Embeddings en browser | Transformers.js | Edge Function + HF API | Sin costo, privacidad, offline |
| Chunking | Por oraciones + overlap | Por tokens, por párrafos | Balance precisión/rendimiento |
| Índice vectorial | HNSW | IVFFlat, exacto | Mejor trade-off velocidad/recall |
| Similitud | Coseno | Euclidiana, producto interno | Estándar para texto semántico |
| LLM | Configurable | Hardcoded | Flexibilidad: local u online |
| Auth | RLS desactivado (dev) | Supabase Auth | Simplifica el MVP |

---

## Limitaciones del MVP

- Sin autenticación multiusuario (un solo usuario por instancia)
- Modelo de embeddings cargado una vez por sesión (puede tardar en navegadores lentos)
- Sin streaming de respuestas del LLM
- Sin soporte para adjuntos/imágenes en notas
