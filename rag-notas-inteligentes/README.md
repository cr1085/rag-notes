# 🧠 RAG Notas Inteligentes

> **Tu segundo cerebro potenciado con IA.** Guarda notas, indexa su contenido con embeddings y chatea con tu propia base de conocimiento usando RAG (Retrieval Augmented Generation).

![Stack](https://img.shields.io/badge/Stack-HTML%20%7C%20JS%20%7C%20Supabase%20%7C%20pgvector-5b7fff?style=flat-square)
![Embeddings](https://img.shields.io/badge/Embeddings-all--MiniLM--L6--v2-3dd68c?style=flat-square)
![LLM](https://img.shields.io/badge/LLM-Ollama%20%7C%20OpenRouter-f5c542?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-white?style=flat-square)

---

## ✨ Características

- 📝 **Gestión de notas** — Crear, editar, eliminar y organizar notas con tags
- ⚡ **Indexación automática** — Chunking + embeddings generados directamente en el navegador (sin API de pago)
- 🔍 **Búsqueda semántica** — Encuentra notas por significado, no solo por palabras exactas
- 💬 **Chat RAG** — Haz preguntas y recibe respuestas basadas en tus notas
- 🔒 **Open-source first** — Todos los modelos son gratuitos y open-source
- 🏠 **Funciona local** — Compatible con Ollama para LLM completamente offline

---

## 🏗️ Stack Tecnológico

| Componente | Tecnología |
|-----------|-----------|
| Frontend | HTML5 + JavaScript ES Modules |
| Base de datos | Supabase (PostgreSQL) |
| Vector storage | pgvector (integrado en Supabase) |
| Embeddings | Transformers.js + `all-MiniLM-L6-v2` (384 dims) |
| Backend serverless | Supabase Edge Functions (Deno) |
| LLM | Ollama / OpenRouter / OpenAI-compatible |

---

## 🚀 Instalación y Configuración

### Prerequisitos
- Cuenta gratuita en [supabase.com](https://supabase.com)
- Navegador moderno (Chrome 90+, Firefox 90+, Safari 15+)
- [Ollama](https://ollama.ai) instalado (opcional, para LLM local)

### 1. Clonar el repositorio

```bash
git clone https://github.com/tu-usuario/rag-notas-inteligentes.git
cd rag-notas-inteligentes
```

### 2. Configurar Supabase

**a) Crear un proyecto en [supabase.com](https://app.supabase.com)**

**b) Configurar la base de datos** — En el SQL Editor de Supabase, ejecutar en orden:

```sql
-- Paso 1: Habilitar extensiones
-- (copiar y ejecutar el contenido de database/pgvector_setup.sql)

-- Paso 2: Crear tablas y funciones
-- (copiar y ejecutar el contenido de database/schema.sql)
```

**c) Obtener credenciales** — En Settings → API:
- `Project URL`
- `anon` / `public` key

### 3. Configurar el frontend

Editar `frontend/index.html` y reemplazar las credenciales:

```html
<script>
    window.ENV = {
        SUPABASE_URL:  'https://XXXXXXXXXXXX.supabase.co',
        SUPABASE_ANON: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    };
</script>
```

### 4. Servir el frontend

```bash
# Opción A: npx serve (recomendado)
npx serve frontend/

# Opción B: Python
cd frontend && python3 -m http.server 3000

# Opción C: Extensión Live Server de VS Code
# Click derecho en index.html → "Open with Live Server"
```

Abrir en el navegador: `http://localhost:3000`

---

## 🤖 Configurar el LLM

### Opción A: Ollama (local, recomendado)

```bash
# Instalar Ollama desde https://ollama.ai
# Descargar un modelo
ollama pull llama3.2      # 2GB, buena calidad
# o
ollama pull mistral       # 4GB, mejor calidad
# o
ollama pull phi3:mini     # 2.3GB, muy rápido

# Iniciar servidor
ollama serve
```

En la app: **⚙️ Configurar LLM** → Provider: `ollama`, Modelo: `llama3.2`, URL: `http://localhost:11434`

### Opción B: OpenRouter (online, free tier disponible)

1. Crear cuenta en [openrouter.ai](https://openrouter.ai)
2. Obtener API key (gratuita con límites)

En la app: Provider: `openrouter`, Modelo: `mistralai/mistral-7b-instruct:free`, API Key: `sk-or-...`

### Opción C: OpenAI-compatible (LM Studio, Groq, etc.)

Configurar URL base y API key según el proveedor.

---

## 📖 Cómo usar el sistema RAG

### 1. Crear y indexar notas
1. Ir a **📋 Mis Notas** → clic en **+ Nueva Nota**
2. Escribir un título y contenido detallado
3. Guardar la nota
4. Hacer clic en **⚡ Procesar/Indexar**
5. Esperar que el modelo descargue (~30s primera vez) y procese la nota

### 2. Buscar semánticamente
1. Ir a **🔍 Buscar**
2. Escribir una búsqueda (no necesita ser literal)
3. Los resultados muestran el porcentaje de relevancia

### 3. Chatear con tus notas
1. Ir a **💬 Chat RAG**
2. Verificar que el LLM esté configurado (⚙️)
3. Hacer una pregunta sobre el contenido de tus notas
4. El sistema busca chunks relevantes y genera una respuesta con fuentes

---

## 🔌 Desplegar Edge Functions (opcional)

Las Edge Functions permiten generar embeddings en el servidor (útil si el dispositivo es lento):

```bash
# Instalar Supabase CLI
npm install -g supabase

# Login
supabase login

# Vincular proyecto
supabase link --project-ref TU_PROJECT_REF

# Desplegar funciones
supabase functions deploy generateEmbeddings
supabase functions deploy searchSimilar
supabase functions deploy ragQuery

# Configurar variables de entorno en Supabase Dashboard → Edge Functions → Secrets
# HUGGINGFACE_TOKEN = hf_xxxxx (opcional, para mayor rate limit)
```

---

## 📁 Estructura del Proyecto

```
rag-notas-inteligentes/
├── frontend/
│   ├── index.html          # UI principal
│   ├── styles.css          # Estilos (dark theme)
│   ├── app.js              # Orquestador principal
│   ├── supabaseClient.js   # Capa de acceso a datos
│   ├── rag.js              # Pipeline RAG + embeddings
│   ├── search.js           # Búsqueda semántica e híbrida
│   └── ui.js               # Componentes de UI
├── backend/
│   └── edge-functions/
│       ├── generateEmbeddings.ts
│       ├── searchSimilar.ts
│       └── ragQuery.ts
├── database/
│   ├── pgvector_setup.sql  # Paso 1: extensiones
│   └── schema.sql          # Paso 2: tablas + índices + funciones
└── docs/
    ├── arquitectura.md
    ├── flujo_rag.md
    └── onboarding_pasantes.md
```

---

## 🗺️ Roadmap

### Fase 1 — MVP (actual)
- [x] CRUD de notas
- [x] Chunking con overlap
- [x] Embeddings en browser (Transformers.js)
- [x] Almacenamiento en pgvector con índice HNSW
- [x] Búsqueda semántica + FTS híbrida
- [x] Chat RAG multi-proveedor (Ollama, OpenRouter, OpenAI)
- [x] Historial de consultas
- [x] Edge Functions para procesamiento server-side

### Fase 2 — Mejoras de UX (próximo)
- [ ] Autenticación multi-usuario (Supabase Auth)
- [ ] Streaming de respuestas del LLM
- [ ] Importación de archivos (.txt, .md, .pdf)
- [ ] Editor Markdown con preview
- [ ] Modo oscuro / claro

### Fase 3 — Memoria Semántica Avanzada
- [ ] Grafo de relaciones entre notas
- [ ] Clustering automático por temas
- [ ] Reranking de resultados (cross-encoder)
- [ ] HyDE (Hypothetical Document Embeddings)
- [ ] Multi-query expansion
- [ ] Parent-child chunking

### Fase 4 — Agentes y Automatizaciones
- [ ] Agente de síntesis: "resume todas mis notas sobre X"
- [ ] Agente de conexiones: "¿qué notas están relacionadas con esta idea?"
- [ ] Webhooks para agregar notas automáticamente
- [ ] Integración con Obsidian, Notion (import)
- [ ] API pública para integrar con otras apps

---

## 🤝 Contribuir

1. Fork el repositorio
2. Crear una rama: `git checkout -b feature/mi-feature`
3. Hacer commits descriptivos
4. Abrir un Pull Request

Ver `docs/onboarding_pasantes.md` para tareas disponibles y guías de estilo.

---

## 📄 Licencia

MIT — libre para uso personal y comercial.
