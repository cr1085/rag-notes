# 🧠 RAG Notas Inteligentes

> **Tu segundo cerebro potenciado con IA.** Guarda notas, indexa su contenido con embeddings y chatea con tu propia base de conocimiento usando RAG (Retrieval Augmented Generation).


![Estado](https://img.shields.io/badge/estado-en%20desarrollo-yellow)
![Licencia](https://img.shields.io/badge/licencia-Apache%202.0-green)
![Versión](https://img.shields.io/badge/versión-0.1.0-blue)
![Discord](https://img.shields.io/discord/1234567890?logo=discord)
![Sponsors](https://img.shields.io/github/sponsors/cr1085?logo=github)


---

##  Características

-  **Gestión de notas** — Crear, editar, eliminar y organizar notas con tags
-  **Indexación automática** — Chunking + embeddings generados directamente en el navegador (sin API de pago)
-  **Búsqueda semántica** — Encuentra notas por significado, no solo por palabras exactas
-  **Chat RAG** — Haz preguntas y recibe respuestas basadas en tus notas
-  **Open-source first** — Todos los modelos son gratuitos y open-source
-  **Funciona local** — Compatible con Ollama para LLM completamente offline

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

### 1. Clonar el repositorio

```bash
git clone https://github.com/cr1085/rag-notes.git
cd rag-notas-inteligentes
```


## 📖 Cómo usar el sistema RAG

### 1. Crear y indexar notas
1. Ir a **Mis Notas** → clic en **+ Nueva Nota**
2. Escribir un título y contenido detallado
3. Guardar la nota
4. Hacer clic en **Procesar/Indexar**
5. Esperar que el modelo descargue (~30s primera vez) y procese la nota

### 2. Buscar semánticamente
1. Ir a **Buscar**
2. Escribir una búsqueda (no necesita ser literal)
3. Los resultados muestran el porcentaje de relevancia

### 3. Chatear con tus notas
1. Ir a **Chat RAG**
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



## License

This project is licensed under the **Apache License 2.0**.

Apache 2.0 allows commercial use, modification, distribution, and private use of the software.  
Unlike **AGPL v3**, it does not require releasing the full source code when the software is used as a SaaS service.

See the [LICENSE](LICENSE) file for details.


