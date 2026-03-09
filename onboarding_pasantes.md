# 👋 Onboarding para Pasantes — RAG Notas Inteligentes

Bienvenido/a al proyecto. Esta guía te explicará todo lo que necesitas saber para empezar a contribuir desde el primer día.

---

## ¿Qué es este proyecto?

RAG Notas Inteligentes es un "segundo cerebro" con IA. Permite a los usuarios:
1. Guardar notas de texto
2. Indexarlas automáticamente (convertirlas en vectores)
3. Hacer búsquedas semánticas ("encuentra notas sobre productividad" aunque no uses esa palabra exacta)
4. Chatear con sus propias notas ("¿Qué dijo en mi nota sobre el proyecto X?")

**Tecnología principal:** RAG (Retrieval Augmented Generation), pgvector, Transformers.js, Supabase.

---

## Stack Tecnológico

| Capa | Tecnología | ¿Por qué? |
|------|-----------|-----------|
| Frontend | HTML + JS Vanilla (ES Modules) | Sin build step, fácil de entender |
| Estilos | CSS puro con variables | Sin dependencias, totalmente customizable |
| Base de datos | Supabase (PostgreSQL) | BaaS con pgvector integrado |
| Vectores | pgvector | Extensión PostgreSQL para embeddings |
| Embeddings | Transformers.js (browser) | Open-source, no requiere API de pago |
| Modelo | all-MiniLM-L6-v2 | Pequeño (~25MB), buena calidad, 384 dims |
| Backend | Supabase Edge Functions (Deno) | Serverless, cerca de la base de datos |
| LLM | Ollama / OpenRouter / OpenAI-compat. | Flexible: local u online |

---

## Estructura del Proyecto

```
rag-notas-inteligentes/
├── frontend/
│   ├── index.html          ← HTML principal (UI completa)
│   ├── styles.css          ← Estilos (dark theme, responsive)
│   ├── app.js              ← Orquestador principal (EMPIEZA AQUÍ)
│   ├── supabaseClient.js   ← Toda la comunicación con Supabase
│   ├── rag.js              ← Lógica de embeddings y pipeline RAG
│   ├── search.js           ← Búsqueda semántica e híbrida
│   └── ui.js               ← Funciones de renderizado de la UI
│
├── backend/
│   └── edge-functions/
│       ├── generateEmbeddings.ts  ← Alternativa server-side para embeddings
│       ├── searchSimilar.ts       ← Búsqueda vectorial como endpoint HTTP
│       └── ragQuery.ts            ← Pipeline RAG completo como endpoint HTTP
│
├── database/
│   ├── pgvector_setup.sql  ← Paso 1: Habilitar extensiones
│   └── schema.sql          ← Paso 2: Crear tablas, índices, funciones
│
└── docs/
    ├── arquitectura.md     ← Diseño del sistema (diagramas)
    ├── flujo_rag.md        ← Explicación técnica de RAG
    └── onboarding_pasantes.md  ← Este archivo
```

---

## Qué hace cada módulo en detalle

### `app.js` — El Director
Piensa en él como el director de orquesta. No hace trabajo pesado, pero coordina todo:
- Cuando el usuario hace clic en "Nueva nota" → llama a `renderNoteEditor()`
- Cuando el usuario guarda → llama a `createNote()` de supabaseClient
- Cuando el usuario hace una pregunta → llama a `ragQuery()` de rag.js

**Patrón clave:** Estado centralizado en `state = { notes, currentNote, activeView, llmConfig }`

### `supabaseClient.js` — El Mensajero
Toda comunicación con Supabase pasa por aquí. Si necesitas hacer una consulta nueva, agrégala aquí. Nunca llames al SDK de Supabase desde otro módulo.

### `rag.js` — El Cerebro
El módulo más importante. Aquí vive la magia del RAG:
- `loadEmbeddingModel()`: Descarga el modelo la primera vez, lo cachea para siempre
- `generateEmbedding(text)`: Convierte texto → vector[384]
- `chunkText(text)`: Divide una nota larga en fragmentos manejables
- `processNote(note)`: Pipeline completo: chunking → embeddings → guardar en DB
- `ragQuery(question, llmConfig)`: Pipeline completo: embedding → búsqueda → LLM → respuesta

### `search.js` — El Buscador
Dos tipos de búsqueda:
- **Semántica** (vectorial): Entiende significado, no requiere palabras exactas
- **FTS** (texto completo): Rápida, requiere palabras exactas
- **Híbrida**: Combina ambas con pesos (70% semántica, 30% FTS)

### `ui.js` — El Pintor
Solo se encarga de renderizar HTML. Es "puro" (no tiene estado propio):
- Recibe datos → devuelve HTML
- Maneja toasts, overlays, progreso
- Previene XSS (siempre usar `escapeHtml()` antes de insertar texto del usuario)

---

## Cómo configurar el entorno

### Prerequisitos
- Node.js 18+ (opcional, solo para Supabase CLI)
- Cuenta gratuita en [supabase.com](https://supabase.com)
- Ollama instalado (opcional, para LLM local): [ollama.ai](https://ollama.ai)

### Paso 1: Clonar y configurar Supabase

```bash
git clone <repo-url>
cd rag-notas-inteligentes
```

### Paso 2: Configurar la base de datos
1. Ir a tu proyecto en [supabase.com](https://app.supabase.com)
2. Abrir el **SQL Editor**
3. Ejecutar `database/pgvector_setup.sql` (habilita extensiones)
4. Ejecutar `database/schema.sql` (crea tablas, índices, funciones)

### Paso 3: Obtener credenciales de Supabase
1. Ir a **Settings → API** en tu dashboard de Supabase
2. Copiar **Project URL** y **anon public key**

### Paso 4: Configurar el frontend
Editar `frontend/index.html`, buscar este bloque y reemplazar:

```html
<script>
    window.ENV = {
        SUPABASE_URL:  'https://TU_PROYECTO.supabase.co',  // ← reemplazar
        SUPABASE_ANON: 'TU_ANON_KEY_AQUI',                  // ← reemplazar
    };
</script>
```

### Paso 5: Abrir el frontend
```bash
# Usar cualquier servidor HTTP estático:
npx serve frontend/
# O con Python:
cd frontend && python3 -m http.server 3000
# O simplemente abrir index.html en el navegador (algunos browsers bloquean ES modules)
```

### Paso 6: Configurar el LLM (opcional)
**Con Ollama (recomendado para desarrollo):**
```bash
# Instalar Ollama desde https://ollama.ai
ollama pull llama3.2
ollama serve  # Puerto 11434 por defecto
```

En la app, hacer clic en "⚙️ Configurar LLM" y verificar que el provider sea "ollama" y el modelo "llama3.2".

---

## Flujo de desarrollo típico

1. Crear una nota de prueba
2. Hacer clic en "⚡ Procesar/Indexar" (primera vez tarda ~30s mientras descarga el modelo)
3. Ir a "🔍 Buscar" y probar la búsqueda semántica
4. Ir a "💬 Chat RAG" y hacer una pregunta sobre el contenido de tus notas
5. Verificar el historial en la tabla `queries` de Supabase

---

## Tareas sugeridas para pasantes

### Nivel 1 — Familiarización (1-2 días)
- [ ] Configurar el entorno completo y crear 5 notas de prueba
- [ ] Leer todos los archivos JS con los comentarios
- [ ] Probar la búsqueda semántica y entender por qué funciona
- [ ] Leer `docs/flujo_rag.md` y hacer preguntas

### Nivel 2 — Primeras contribuciones (3-5 días)
- [ ] Agregar **conteo de palabras** en el editor de notas
- [ ] Agregar **filtrado por tags** en la vista de notas
- [ ] Mejorar el **modo responsive** en móviles
- [ ] Agregar **exportar nota como .txt o .md**
- [ ] Agregar un **botón "Limpiar historial"** en el chat

### Nivel 3 — Features intermedias (1-2 semanas)
- [ ] Implementar **búsqueda por tags** en la vista de notas
- [ ] Agregar **modo oscuro / claro** con toggle
- [ ] Agregar **contador de chunks** por nota (visible en el editor)
- [ ] Implementar **re-procesamiento automático** cuando se edita una nota
- [ ] Agregar **drag & drop** para reordenar notas

### Nivel 4 — Features avanzadas (2-4 semanas)
- [ ] Implementar **autenticación con Supabase Auth** (multi-usuario)
- [ ] Agregar **importación de notas** desde archivos .txt, .md
- [ ] Implementar **streaming de respuestas** del LLM (texto aparece en tiempo real)
- [ ] Agregar **visualización del grafo de notas** relacionadas (D3.js)
- [ ] Implementar **reranking** para mejorar la calidad de los resultados
- [ ] Agregar **memoria conversacional** en el chat (contexto de conversación)

---

## Guía de estilo de código

```javascript
// ✅ BIEN: Funciones bien nombradas con JSDoc
/**
 * Genera embedding para un texto
 * @param {string} text - Texto a vectorizar
 * @returns {Promise<Array<number>>} Vector de 384 dimensiones
 */
export async function generateEmbedding(text) { ... }

// ✅ BIEN: Manejo de errores explícito
const { data, error } = await createNote({ title, content });
if (error) { showToast('Error: ' + error.message, 'error'); return; }

// ❌ MAL: Sin manejo de errores
const data = await createNote({ title, content }); // podría fallar silenciosamente

// ✅ BIEN: Escapar HTML antes de insertar en el DOM
container.innerHTML = `<h3>${escapeHtml(note.title)}</h3>`; // previene XSS

// ❌ MAL: XSS vulnerability
container.innerHTML = `<h3>${note.title}</h3>`; // NUNCA hacer esto
```

---

## Preguntas frecuentes

**¿Por qué el modelo tarda la primera vez?**
Transformers.js descarga el modelo (`all-MiniLM-L6-v2`, ~25MB) desde HuggingFace y lo cachea en IndexedDB del navegador. Las siguientes veces carga en <2 segundos.

**¿Puedo usar otro modelo de embeddings?**
Sí. Cambia `EMBEDDING_MODEL` en `rag.js` por cualquier modelo compatible con Transformers.js. Si el modelo genera vectores de diferente dimensión (ej: 768), actualiza el esquema SQL (`vector(768)`) y re-indexa todas las notas.

**¿Por qué se usa distancia coseno y no euclidiana?**
La distancia coseno mide el ángulo entre vectores (solo dirección), ignorando la magnitud. Para texto semántico, dos frases similares tienen el mismo "ángulo" aunque una sea más larga. La distancia euclidiana penalizaría textos largos injustamente.

**¿Qué pasa si Ollama no está corriendo?**
El chat mostrará un error de conexión. Puedes usar OpenRouter con modelos gratuitos como alternativa.

**¿Cómo puedo ver los vectores en la base de datos?**
En Supabase SQL Editor: `SELECT id, model_name, embedding FROM embeddings LIMIT 1;` — verás un array de 384 números.

---

## Contacto y recursos

- **Slack del equipo**: #proyecto-rag-notas
- **Issues del proyecto**: Ver GitHub Issues
- **Documentación Supabase**: [supabase.com/docs](https://supabase.com/docs)
- **Documentación Transformers.js**: [huggingface.co/docs/transformers.js](https://huggingface.co/docs/transformers.js/en/index)
- **pgvector**: [github.com/pgvector/pgvector](https://github.com/pgvector/pgvector)

¡Bienvenido al equipo! 🚀
