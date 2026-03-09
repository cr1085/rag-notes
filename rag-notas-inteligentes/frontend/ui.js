// ============================================================
// ui.js
// Módulo de interfaz de usuario
// Renderiza componentes y maneja eventos de la UI
// ============================================================

// ── Renderizado de Notas ─────────────────────────────────────

/**
 * Renderizar lista de notas en el contenedor
 * @param {Array} notes - Array de notas
 * @param {HTMLElement} container - Elemento donde renderizar
 * @param {Function} onSelect - Callback al seleccionar una nota
 */
export function renderNotesList(notes, container, onSelect) {
    if (!container) return;

    if (notes.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📝</div>
                <p>No hay notas todavía.</p>
                <p class="empty-sub">Crea tu primera nota para comenzar.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = notes.map(note => `
        <div class="note-card ${note.is_processed ? 'processed' : 'pending'}"
             data-id="${note.id}"
             role="button"
             tabindex="0">
            <div class="note-card__header">
                <h3 class="note-card__title">${escapeHtml(note.title)}</h3>
                <div class="note-card__badges">
                    ${note.is_processed
                        ? '<span class="badge badge--success">✓ Indexado</span>'
                        : '<span class="badge badge--warning">⏳ Pendiente</span>'
                    }
                </div>
            </div>
            <p class="note-card__preview">${escapeHtml(note.content?.substring(0, 120) || '')}${note.content?.length > 120 ? '…' : ''}</p>
            <div class="note-card__footer">
                <div class="note-card__tags">
                    ${(note.tags || []).map(tag => `<span class="tag">#${escapeHtml(tag)}</span>`).join('')}
                </div>
                <span class="note-card__date">${formatDate(note.updated_at || note.created_at)}</span>
            </div>
        </div>
    `).join('');

    // Añadir event listeners
    container.querySelectorAll('.note-card').forEach(card => {
        card.addEventListener('click', () => onSelect(card.dataset.id));
        card.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') onSelect(card.dataset.id);
        });
    });
}

/**
 * Renderizar formulario de edición de nota
 * @param {Object|null} note - Nota a editar (null para crear nueva)
 * @param {HTMLElement} container - Contenedor del formulario
 * @param {Object} callbacks - { onSave, onDelete, onProcess, onCancel }
 */
export function renderNoteEditor(note, container, callbacks) {
    const isNew = !note;
    const { onSave, onDelete, onProcess, onCancel } = callbacks;

    container.innerHTML = `
        <div class="editor">
            <div class="editor__toolbar">
                <button class="btn btn--ghost btn--sm" id="btn-back">← Volver</button>
                <div class="editor__actions">
                    ${!isNew ? `
                        <button class="btn btn--primary btn--sm" id="btn-process">
                            ⚡ Procesar/Indexar
                        </button>
                        <button class="btn btn--danger btn--sm" id="btn-delete">
                            🗑️ Eliminar
                        </button>
                    ` : ''}
                    <button class="btn btn--success btn--sm" id="btn-save">
                        💾 ${isNew ? 'Crear nota' : 'Guardar cambios'}
                    </button>
                </div>
            </div>

            <div class="editor__body">
                <input
                    type="text"
                    id="note-title"
                    class="editor__title-input"
                    placeholder="Título de la nota..."
                    value="${escapeHtml(note?.title || '')}"
                    maxlength="200"
                />

                <textarea
                    id="note-content"
                    class="editor__content-input"
                    placeholder="Escribe tu nota aquí. Cuanto más detallada, mejor funciona el RAG..."
                    rows="20"
                >${escapeHtml(note?.content || '')}</textarea>

                <div class="editor__meta">
                    <input
                        type="text"
                        id="note-tags"
                        class="editor__tags-input"
                        placeholder="Etiquetas separadas por comas: IA, proyectos, ideas..."
                        value="${(note?.tags || []).join(', ')}"
                    />
                    ${!isNew ? `
                        <div class="editor__info">
                            <span>Creada: ${formatDate(note.created_at)}</span>
                            <span>Estado: ${note.is_processed ? '✅ Indexada' : '⏳ Sin indexar'}</span>
                        </div>
                    ` : ''}
                </div>
            </div>
        </div>
    `;

    // Event listeners
    document.getElementById('btn-back')?.addEventListener('click', onCancel);
    document.getElementById('btn-save')?.addEventListener('click', () => {
        const title   = document.getElementById('note-title').value.trim();
        const content = document.getElementById('note-content').value.trim();
        const tagsRaw = document.getElementById('note-tags').value;
        const tags    = tagsRaw.split(',').map(t => t.trim()).filter(Boolean);

        if (!title) { showToast('El título es requerido', 'error'); return; }
        if (!content) { showToast('El contenido es requerido', 'error'); return; }

        onSave({ title, content, tags });
    });

    document.getElementById('btn-delete')?.addEventListener('click', () => {
        if (confirm(`¿Eliminar la nota "${note?.title}"? Esta acción no se puede deshacer.`)) {
            onDelete(note.id);
        }
    });

    document.getElementById('btn-process')?.addEventListener('click', () => {
        onProcess(note);
    });
}

/**
 * Renderizar resultados de búsqueda semántica
 * @param {Array} results - Resultados de búsqueda
 * @param {HTMLElement} container - Contenedor
 * @param {Function} onSelectNote - Callback al hacer clic en resultado
 */
export function renderSearchResults(results, container, onSelectNote) {
    if (!container) return;

    if (results.length === 0) {
        container.innerHTML = `
            <div class="search-empty">
                <p>No se encontraron resultados relevantes.</p>
                <p class="text-muted">Prueba con otras palabras o verifica que las notas estén indexadas.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = `
        <div class="search-results-header">
            <span>${results.length} resultado${results.length !== 1 ? 's' : ''} encontrado${results.length !== 1 ? 's' : ''}</span>
        </div>
        ${results.map(result => {
            const similarity = result.similarity
                ? `${(result.similarity * 100).toFixed(0)}%`
                : result.score
                    ? `${(result.score * 100).toFixed(0)}%`
                    : '';
            return `
                <div class="search-result" data-note-id="${result.note_id}" role="button" tabindex="0">
                    <div class="search-result__header">
                        <h4 class="search-result__title">${escapeHtml(result.note_title || result.title || 'Sin título')}</h4>
                        ${similarity ? `<span class="similarity-badge">${similarity}</span>` : ''}
                    </div>
                    <p class="search-result__excerpt">${escapeHtml((result.chunk_content || result.content || '').substring(0, 200))}...</p>
                </div>
            `;
        }).join('')}
    `;

    container.querySelectorAll('.search-result').forEach(el => {
        el.addEventListener('click', () => onSelectNote(el.dataset.noteId));
        el.addEventListener('keydown', e => {
            if (e.key === 'Enter') onSelectNote(el.dataset.noteId);
        });
    });
}

/**
 * Renderizar respuesta del chat RAG
 * @param {Object} response - { question, answer, sources }
 * @param {HTMLElement} container - Contenedor del chat
 */
export function renderChatResponse(response, container) {
    const messageHtml = `
        <div class="chat-exchange">
            <div class="chat-message chat-message--user">
                <div class="chat-message__avatar">👤</div>
                <div class="chat-message__content">${escapeHtml(response.question)}</div>
            </div>
            <div class="chat-message chat-message--assistant">
                <div class="chat-message__avatar">🧠</div>
                <div class="chat-message__content">
                    <div class="chat-message__text">${markdownToHtml(response.answer)}</div>
                    ${response.sources?.length > 0 ? `
                        <div class="chat-sources">
                            <span class="chat-sources__label">Fuentes:</span>
                            ${response.sources.map((s, i) => `
                                <span class="chat-source-pill" title="Similitud: ${(s.similarity * 100).toFixed(1)}%">
                                    ${escapeHtml(s.note_title)}
                                </span>
                            `).join('')}
                        </div>
                    ` : ''}
                </div>
            </div>
        </div>
    `;

    container.insertAdjacentHTML('beforeend', messageHtml);
    container.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

// ── Utilidades de UI ─────────────────────────────────────────

/** Mostrar toast de notificación */
export function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.textContent = message;

    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
    toast.textContent = `${icons[type] || 'ℹ️'} ${message}`;

    document.getElementById('toast-container')?.appendChild(toast);

    // Animar entrada
    requestAnimationFrame(() => {
        toast.classList.add('toast--visible');
    });

    // Auto-remover
    setTimeout(() => {
        toast.classList.remove('toast--visible');
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

/** Mostrar overlay de carga con mensaje */
export function showLoading(message = 'Cargando...', containerId = 'loading-overlay') {
    const el = document.getElementById(containerId);
    if (el) {
        el.querySelector('.loading-message')?.textContent && (
            el.querySelector('.loading-message').textContent = message
        );
        el.classList.remove('hidden');
    }
}

/** Ocultar overlay de carga */
export function hideLoading(containerId = 'loading-overlay') {
    document.getElementById(containerId)?.classList.add('hidden');
}

/** Actualizar barra de progreso */
export function updateProgress(progress, message, containerId = 'progress-bar') {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.style.width = `${progress}%`;
    container.setAttribute('aria-valuenow', progress);
    if (message) {
        document.getElementById('progress-message')?.textContent && (
            document.getElementById('progress-message').textContent = message
        );
    }
}

// ── Helpers ──────────────────────────────────────────────────

/** Escapar HTML para prevenir XSS */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = String(text || '');
    return div.innerHTML;
}

/** Formatear fecha de forma legible */
function formatDate(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('es-ES', {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
}

/** Convertir markdown básico a HTML */
function markdownToHtml(text) {
    if (!text) return '';
    return escapeHtml(text)
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/`(.+?)`/g, '<code>$1</code>')
        .replace(/\n\n/g, '</p><p>')
        .replace(/\n/g, '<br>')
        .replace(/^/, '<p>')
        .replace(/$/, '</p>');
}
