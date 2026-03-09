# 🔄 Flujo RAG — Guía Técnica Detallada

## ¿Qué es RAG?

**Retrieval Augmented Generation** es una técnica que mejora las respuestas de los LLMs añadiendo **conocimiento externo relevante** al prompt. En lugar de depender solo del conocimiento interno del modelo (que puede estar desactualizado o ser incompleto), RAG busca información pertinente en una base de datos y la incluye en el contexto de la consulta.

```
Sin RAG:   Usuario → LLM → Respuesta (basada solo en entrenamiento)
Con RAG:   Usuario → Retrieval → Contexto + Pregunta → LLM → Respuesta (basada en tus notas)
```

## Fase 1: Ingesta (Index Time)

Ocurre cuando el usuario guarda y procesa una nota.

### 1.1 Chunking

El texto completo de una nota se divide en fragmentos (chunks) más pequeños porque:
- Los LLMs tienen límite de contexto
- La búsqueda vectorial es más precisa con textos cortos y específicos
- Permite recuperar solo la parte relevante de una nota larga

**Ejemplo:**
```
Nota original (1500 chars):
"RAG (Retrieval Augmented Generation) es una técnica... [párrafo 1]
Los embeddings son representaciones... [párrafo 2]
pgvector permite almacenar... [párrafo 3]"

↓ chunkText(500 chars, 50 overlap)

Chunk 1 (0-500): "RAG es una técnica..."
Chunk 2 (450-950): "...embeddings son representaciones numéricas..."
Chunk 3 (900-1400): "...pgvector permite almacenar vectores..."
```

El **overlap** (solapamiento) asegura que la información al borde de un chunk no se pierda.

### 1.2 Generación de Embeddings

Cada chunk se convierte en un vector numérico de 384 dimensiones usando el modelo `all-MiniLM-L6-v2`.

```javascript
// Concepto simplificado
"RAG es una técnica de IA" → [0.123, -0.456, 0.789, ... 384 números]
"Cómo mejorar LLMs con retrieval" → [0.118, -0.461, 0.795, ... 384 números]
// Estos dos vectores estarán MUY CERCA en el espacio vectorial (semánticamente similares)

"El gato come pescado" → [-0.234, 0.567, -0.123, ... 384 números]
// Este vector estará MUY LEJOS de los anteriores
```

**Mean Pooling + Normalización:**
1. El texto se tokeniza y cada token genera un vector
2. Se promedian todos los vectores de tokens (mean pooling)
3. Se normaliza el resultado (||v|| = 1) para usar similitud coseno

### 1.3 Almacenamiento en pgvector

Los vectores se almacenan en PostgreSQL con la extensión pgvector. Se usa un índice **HNSW** (Hierarchical Navigable Small World) para búsqueda aproximada eficiente.

```sql
-- El vector se almacena como tipo nativo de pgvector
INSERT INTO embeddings (chunk_id, note_id, embedding, model_name)
VALUES ('uuid...', 'uuid...', '[0.123, -0.456, ...]', 'all-MiniLM-L6-v2');
```

---

## Fase 2: Consulta (Query Time)

Ocurre cuando el usuario hace una pregunta en el chat.

### 2.1 Embedding de la Pregunta

La pregunta del usuario también se convierte en un vector usando el **mismo modelo** que se usó para indexar.

```
"¿Cómo funciona la búsqueda vectorial?" → [0.234, -0.345, 0.567, ...]
```

### 2.2 Búsqueda de Similitud en pgvector

Se buscan los chunks cuyos vectores están más "cerca" del vector de la pregunta.

```sql
SELECT 
    c.content,
    n.title,
    1 - (e.embedding <=> query_vector) AS similarity  -- <=> es operador de distancia coseno
FROM embeddings e
JOIN chunks c ON c.id = e.chunk_id
JOIN notes  n ON n.id = e.note_id
WHERE 1 - (e.embedding <=> query_vector) > 0.4  -- umbral mínimo
ORDER BY e.embedding <=> query_vector             -- ordenar por cercanía
LIMIT 5;
```

**Distancia coseno**: Mide el ángulo entre dos vectores (no la distancia euclidiana). Dos textos con significado similar tendrán un ángulo pequeño (similitud alta).

### 2.3 Construcción del Contexto

Los chunks recuperados se formatean como contexto para el LLM:

```
[Fuente 1: "Introducción a RAG" (relevancia: 87.3%)]
RAG es una técnica que combina búsqueda de información con generación de texto...

---

[Fuente 2: "Modelos de embeddings" (relevancia: 72.1%)]
Los embeddings son representaciones numéricas del significado del texto...
```

### 2.4 Consulta al LLM

El prompt final combina instrucciones del sistema, el contexto de las notas y la pregunta:

```
SYSTEM: Eres un asistente que responde SOLO basándote en el contexto proporcionado.
        [instrucciones de comportamiento]

CONTEXTO:
[Fuente 1: "Nota X"...]
[Fuente 2: "Nota Y"...]

USER: ¿Cómo funciona la búsqueda vectorial?
```

El LLM genera una respuesta fundamentada en el contexto, citando las fuentes relevantes.

---

## Parámetros Clave y su Efecto

| Parámetro | Valor por defecto | Efecto de aumentar | Efecto de disminuir |
|-----------|-------------------|-------------------|---------------------|
| `chunkSize` | 500 chars | Más contexto por chunk, menos chunks | Chunks más precisos, más chunks |
| `chunkOverlap` | 50 chars | Menos pérdida de información en bordes | Más riesgo de perder contexto |
| `threshold` | 0.4 | Menos resultados, más precisos | Más resultados, posibles falsos positivos |
| `match_count` | 5 | Más contexto al LLM (más tokens, más costo) | Menos contexto, respuestas menos completas |
| `temperature` | 0.3 | Respuestas más creativas/variadas | Respuestas más deterministas/precisas |

---

## Métricas de Calidad

Para evaluar la calidad del sistema RAG:

- **Recall**: ¿Los chunks relevantes están en el top-K recuperado?
- **Similitud media**: ¿Qué tan altos son los scores de los chunks recuperados?
- **Relevancia de respuesta**: ¿La respuesta del LLM usa el contexto correctamente?
- **Alucinaciones**: ¿El LLM inventa información que no está en el contexto?

---

## Estrategias de Mejora (Roadmap)

1. **Reranking**: Usar un modelo secundario para reordenar los chunks recuperados
2. **HyDE** (Hypothetical Document Embeddings): Generar un documento hipotético antes de buscar
3. **Query expansion**: Expandir la query con sinónimos antes de buscar
4. **Parent-child chunking**: Chunks pequeños para búsqueda, contexto grande para LLM
5. **Multi-query**: Reformular la pregunta de múltiples maneras y combinar resultados
