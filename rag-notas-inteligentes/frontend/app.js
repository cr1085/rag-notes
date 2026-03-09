// ============================================================
// app.js
// Orquestador principal de la aplicación
// Conecta todos los módulos y maneja el estado de la app
// ============================================================

import { getNotes, createNote, updateNote, deleteNote, getQueryHistory } from './supabaseClient.js';
import { processNote, ragQuery, loadEmbeddingModel }                      from './rag.js';
import { hybridSearch, semanticSearch }                                    from './search.js';
import {
    renderNotesList,
    renderNoteEditor,
    renderSearchResults,
    renderChatResponse,
    showToast,
    showLoading,
    hideLoading,
    updateProgress,
} from './ui.js';

// ── Estado Global de la App ──────────────────────────────────
const state = {
    notes:         [],          // Lista de notas cargadas
    currentNote:   null,        // Nota actualmente seleccionada
    activeView:    'notes',     // Vista activa: 'notes' | 'editor' | 'search' | 'chat'
    modelLoaded:   false,       // ¿Modelo de embeddings cargado?
    isProcessing:  false,       // ¿Hay un proceso en curso?
    llmConfig: {                // Configuración del LLM (persiste en localStorage)
        provider: 'ollama',
        model:    'llama3.2',
        apiKey:   '',
        baseUrl:  'http://localhost:11434',
    },
};

// ── Inicialización ───────────────────────────────────────────

async function init() {
    console.log('🚀 Iniciando RAG Notas Inteligentes...');

    // Cargar configuración del LLM desde localStorage
    const savedConfig = localStorage.getItem('llm-config');
    if (savedConfig) {
        try { Object.assign(state.llmConfig, JSON.parse(savedConfig)); }
        catch { /* ignorar configuración corrupta */ }
    }

    // Configurar event listeners de navegación
    setupNavigation();

    // Configurar modal de configuración
    setupConfigModal();

    // Cargar notas
    await loadNotes();

    // Precargar modelo de embeddings en background
    preloadModel();

    console.log('✅ App inicializada');
}

// ── Precarga del Modelo ──────────────────────────────────────

async function preloadModel() {
    const statusEl = document.getElementById('model-status');
    if (statusEl) statusEl.textContent = '⏳ Cargando modelo...';

    try {
        await loadEmbeddingModel(({ status, progress, file }) => {
            if (statusEl && status === 'downloading') {
                const pct = progress ? `${Math.round(progress)}%` : '';
                statusEl.textContent = `⏳ Descargando modelo ${pct}`;
            }
        });

        state.modelLoaded = true;
        if (statusEl) {
            statusEl.textContent = '✅ Modelo listo';
            setTimeout(() => statusEl.textContent = '', 3000);
        }
    } catch (err) {
        console.warn('⚠️ No se pudo precargar el modelo:', err.message);
        if (statusEl) statusEl.textContent = '⚠️ Modelo no cargado';
    }
}

// ── Carga de Notas ───────────────────────────────────────────

async function loadNotes() {
    const { data, error } = await getNotes();

    if (error) {
        showToast('Error cargando notas: ' + error.message, 'error');
        return;
    }

    state.notes = data || [];
    renderCurrentView();

    // Actualizar contador en el nav
    document.getElementById('notes-count')?.textContent && (
        document.getElementById('notes-count').textContent = state.notes.length
    );
}

// ── Navegación ───────────────────────────────────────────────

function setupNavigation() {
    // Navegación principal
    document.querySelectorAll('[data-nav]').forEach(btn => {
        btn.addEventListener('click', () => switchView(btn.dataset.nav));
    });

    // Botón nueva nota
    document.getElementById('btn-new-note')?.addEventListener('click', () => {
        state.currentNote = null;
        switchView('editor');
    });
}

function switchView(view) {
    state.activeView = view;

    // Ocultar todas las vistas
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));

    // Mostrar la vista activa
    document.getElementById(`view-${view}`)?.classList.remove('hidden');

    // Actualizar nav activo
    document.querySelectorAll('[data-nav]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.nav === view);
    });

    renderCurrentView();
}

function renderCurrentView() {
    switch (state.activeView) {
        case 'notes':  renderNotesView();  break;
        case 'editor': renderEditorView(); break;
        case 'search': renderSearchView(); break;
        case 'chat':   renderChatView();   break;
    }
}

// ── Vista: Lista de Notas ────────────────────────────────────

function renderNotesView() {
    const container = document.getElementById('notes-list');
    if (!container) return;

    renderNotesList(state.notes, container, (noteId) => {
        state.currentNote = state.notes.find(n => n.id === noteId) || null;
        switchView('editor');
    });
}

// ── Vista: Editor de Nota ────────────────────────────────────

function renderEditorView() {
    const container = document.getElementById('editor-container');
    if (!container) return;

    renderNoteEditor(state.currentNote, container, {
        onSave: handleSaveNote,
        onDelete: handleDeleteNote,
        onProcess: handleProcessNote,
        onCancel: () => switchView('notes'),
    });
}

async function handleSaveNote({ title, content, tags }) {
    showLoading('Guardando nota...');

    try {
        if (state.currentNote) {
            // Actualizar nota existente
            const { data, error } = await updateNote(state.currentNote.id, { title, content, tags });
            if (error) throw error;
            state.currentNote = data;
            showToast('Nota actualizada ✓', 'success');
        } else {
            // Crear nueva nota
            const { data, error } = await createNote({ title, content, tags });
            if (error) throw error;
            state.currentNote = data;
            showToast('Nota creada ✓', 'success');
        }

        await loadNotes();
        switchView('editor'); // Re-renderizar con la nota guardada

    } catch (err) {
        showToast('Error al guardar: ' + err.message, 'error');
    } finally {
        hideLoading();
    }
}

async function handleDeleteNote(noteId) {
    showLoading('Eliminando nota...');

    try {
        const { error } = await deleteNote(noteId);
        if (error) throw error;

        state.currentNote = null;
        await loadNotes();
        switchView('notes');
        showToast('Nota eliminada', 'info');

    } catch (err) {
        showToast('Error al eliminar: ' + err.message, 'error');
    } finally {
        hideLoading();
    }
}

async function handleProcessNote(note) {
    if (state.isProcessing) {
        showToast('Ya hay un proceso en curso', 'warning');
        return;
    }

    state.isProcessing = true;

    // Mostrar overlay de progreso
    const progressOverlay = document.getElementById('progress-overlay');
    progressOverlay?.classList.remove('hidden');

    try {
        const result = await processNote(note, {}, ({ step, progress, message }) => {
            updateProgress(progress, message, 'progress-fill');
            document.getElementById('progress-message').textContent = message;
        });

        showToast(`✅ Nota indexada: ${result.chunks} chunks, ${result.embeddings} embeddings`, 'success');

        // Recargar la nota para actualizar el estado is_processed
        await loadNotes();
        state.currentNote = state.notes.find(n => n.id === note.id) || state.currentNote;
        renderEditorView();

    } catch (err) {
        showToast('Error al procesar nota: ' + err.message, 'error');
        console.error(err);
    } finally {
        state.isProcessing = false;
        progressOverlay?.classList.add('hidden');
        updateProgress(0, '', 'progress-fill');
    }
}

// ── Vista: Búsqueda ──────────────────────────────────────────

function renderSearchView() {
    const searchInput = document.getElementById('search-input');
    if (!searchInput) return;

    // Limpiar listener anterior
    const newInput = searchInput.cloneNode(true);
    searchInput.parentNode.replaceChild(newInput, searchInput);

    let searchTimeout;
    newInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => handleSearch(e.target.value), 400);
    });
}

async function handleSearch(query) {
    const container = document.getElementById('search-results');
    if (!container) return;

    if (!query || query.trim().length < 2) {
        container.innerHTML = '<p class="text-muted text-center">Escribe para buscar en tus notas...</p>';
        return;
    }

    container.innerHTML = '<div class="loading-inline">🔍 Buscando...</div>';

    try {
        const { combined } = await hybridSearch(query);

        renderSearchResults(combined, container, (noteId) => {
            state.currentNote = state.notes.find(n => n.id === noteId) || null;
            switchView('editor');
        });
    } catch (err) {
        container.innerHTML = `<p class="text-error">Error en búsqueda: ${err.message}</p>`;
    }
}

// ── Vista: Chat RAG ──────────────────────────────────────────

function renderChatView() {
    const chatInput = document.getElementById('chat-input');
    const chatBtn   = document.getElementById('chat-send');

    if (!chatInput || !chatBtn) return;

    // Limpiar listeners anteriores
    const newBtn = chatBtn.cloneNode(true);
    chatBtn.parentNode.replaceChild(newBtn, chatBtn);

    newBtn.addEventListener('click', handleChatSubmit);

    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleChatSubmit();
        }
    });

    // Cargar historial
    loadChatHistory();
}

async function handleChatSubmit() {
    const chatInput   = document.getElementById('chat-input');
    const chatMessages = document.getElementById('chat-messages');
    const question     = chatInput?.value?.trim();

    if (!question) return;

    chatInput.value = '';
    chatInput.disabled = true;
    document.getElementById('chat-send').disabled = true;

    // Mostrar "pensando..."
    const thinkingId = `thinking-${Date.now()}`;
    chatMessages.insertAdjacentHTML('beforeend', `
        <div id="${thinkingId}" class="chat-message chat-message--thinking">
            <div class="chat-message__avatar">🧠</div>
            <div class="chat-message__content">
                <span class="thinking-dots"><span>.</span><span>.</span><span>.</span></span>
            </div>
        </div>
    `);
    chatMessages.lastElementChild?.scrollIntoView({ behavior: 'smooth' });

    try {
        const response = await ragQuery(question, state.llmConfig, {
            threshold: 0.4,
            count:     5,
        });

        // Remover "pensando..."
        document.getElementById(thinkingId)?.remove();

        renderChatResponse(response, chatMessages);

    } catch (err) {
        document.getElementById(thinkingId)?.remove();
        chatMessages.insertAdjacentHTML('beforeend', `
            <div class="chat-message chat-message--error">
                <div class="chat-message__avatar">❌</div>
                <div class="chat-message__content">Error: ${err.message}</div>
            </div>
        `);
        chatMessages.lastElementChild?.scrollIntoView({ behavior: 'smooth' });
    } finally {
        chatInput.disabled = false;
        document.getElementById('chat-send').disabled = false;
        chatInput.focus();
    }
}

async function loadChatHistory() {
    const { data: history } = await getQueryHistory(10);
    const container = document.getElementById('chat-history');
    if (!container || !history?.length) return;

    container.innerHTML = history.reverse().map(q => `
        <div class="history-item" data-question="${q.question.replace(/"/g, '&quot;')}">
            <span class="history-icon">💬</span>
            <span class="history-question">${q.question.substring(0, 50)}${q.question.length > 50 ? '…' : ''}</span>
        </div>
    `).join('');

    container.querySelectorAll('.history-item').forEach(item => {
        item.addEventListener('click', () => {
            document.getElementById('chat-input').value = item.dataset.question;
        });
    });
}

// ── Modal de Configuración ───────────────────────────────────

function setupConfigModal() {
    const modal    = document.getElementById('config-modal');
    const openBtn  = document.getElementById('btn-config');
    const closeBtn = document.getElementById('config-close');
    const saveBtn  = document.getElementById('config-save');

    openBtn?.addEventListener('click', () => {
        // Rellenar form con config actual
        document.getElementById('cfg-provider').value = state.llmConfig.provider;
        document.getElementById('cfg-model').value    = state.llmConfig.model;
        document.getElementById('cfg-apikey').value   = state.llmConfig.apiKey;
        document.getElementById('cfg-baseurl').value  = state.llmConfig.baseUrl;
        modal?.classList.remove('hidden');
    });

    closeBtn?.addEventListener('click', () => modal?.classList.add('hidden'));
    modal?.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });

    saveBtn?.addEventListener('click', () => {
        state.llmConfig = {
            provider: document.getElementById('cfg-provider').value,
            model:    document.getElementById('cfg-model').value,
            apiKey:   document.getElementById('cfg-apikey').value,
            baseUrl:  document.getElementById('cfg-baseurl').value,
        };
        localStorage.setItem('llm-config', JSON.stringify(state.llmConfig));
        modal?.classList.add('hidden');
        showToast('Configuración guardada ✓', 'success');
    });
}

// ── Bootstrap ────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
