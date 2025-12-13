/**
 * UI entry point for Sheets Sync plugin.
 *
 * This code runs in an iframe with network access but no direct
 * access to the Figma document. All document operations must go
 * through message passing to the main thread.
 */

import type { PluginMessage, UIMessage } from '../messages';
import type { SheetData, SyncScope } from '../core/types';

// ============================================================================
// State
// ============================================================================

interface UIState {
  url: string;
  scope: SyncScope;
  hasSelection: boolean;
  isLoading: boolean;
  error: string | null;
  sheetData: SheetData | null;
  mode: 'input' | 'preview' | 'syncing' | 'resync';
  progress: number;
  progressMessage: string;
}

const state: UIState = {
  url: '',
  scope: 'page',
  hasSelection: false,
  isLoading: false,
  error: null,
  sheetData: null,
  mode: 'input',
  progress: 0,
  progressMessage: '',
};

// ============================================================================
// DOM Elements
// ============================================================================

function getElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element not found: ${id}`);
  return el as T;
}

// ============================================================================
// Message Handling
// ============================================================================

/**
 * Send a message to the main plugin thread.
 */
function sendToPlugin(message: UIMessage): void {
  parent.postMessage({ pluginMessage: message }, '*');
}

/**
 * Handle messages from the main plugin thread.
 */
function handlePluginMessage(msg: PluginMessage): void {
  switch (msg.type) {
    case 'INIT':
      state.hasSelection = msg.payload.hasSelection;
      if (msg.payload.lastUrl) {
        state.url = msg.payload.lastUrl;
        updateURLInput();
      }
      updateSelectionOption();
      break;

    case 'SELECTION_CHANGED':
      state.hasSelection = msg.payload.hasSelection;
      updateSelectionOption();
      break;

    case 'FETCH_SUCCESS':
      state.sheetData = msg.payload.sheetData;
      state.isLoading = false;
      state.mode = 'preview';
      state.error = null;
      render();
      break;

    case 'SYNC_COMPLETE':
      state.isLoading = false;
      state.mode = 'input';
      if (msg.payload.success) {
        showSuccess(
          `Synced ${msg.payload.layersUpdated} of ${msg.payload.layersProcessed} layers`
        );
      } else {
        showError(`Sync completed with ${msg.payload.errors.length} errors`);
      }
      if (msg.payload.warnings.length > 0) {
        console.warn('Sync warnings:', msg.payload.warnings);
      }
      render();
      break;

    case 'PROGRESS':
      state.progress = msg.payload.progress;
      state.progressMessage = msg.payload.message;
      updateProgress();
      break;

    case 'ERROR':
      state.isLoading = false;
      state.error = msg.payload.message;
      render();
      break;

    case 'RESYNC_MODE':
      state.url = msg.payload.url;
      state.mode = 'resync';
      state.isLoading = true;
      render();
      // Automatically start fetch and sync
      fetchAndSync();
      break;

    case 'REQUEST_SHEET_FETCH':
      // Main thread is asking us to fetch sheet data
      fetchSheetData(msg.payload.url);
      break;

    case 'REQUEST_IMAGE_FETCH':
      // Will be implemented in TICKET-010
      break;

    default:
      console.warn('Unhandled plugin message:', (msg as PluginMessage).type);
  }
}

// ============================================================================
// Data Fetching
// ============================================================================

/**
 * Fetch sheet data from URL.
 * Note: Full implementation in TICKET-003. This is a placeholder.
 */
async function fetchSheetData(url: string): Promise<void> {
  try {
    // TODO: Implement full fetch in TICKET-003
    // For now, just send back a placeholder error to indicate not implemented
    sendToPlugin({
      type: 'FETCH_ERROR',
      payload: {
        error: 'Sheet fetching not yet implemented (TICKET-003). URL: ' + url,
      },
    });
  } catch (error) {
    sendToPlugin({
      type: 'FETCH_ERROR',
      payload: {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    });
  }
}

// ============================================================================
// Actions
// ============================================================================

/**
 * Handle fetch button click.
 */
function handleFetch(): void {
  const url = state.url.trim();
  if (!url) {
    showError('Please enter a Google Sheets URL');
    return;
  }

  state.isLoading = true;
  state.error = null;
  render();

  sendToPlugin({
    type: 'FETCH',
    payload: { url },
  });
}

/**
 * Handle fetch & sync button click.
 */
function fetchAndSync(): void {
  const url = state.url.trim();
  if (!url) {
    showError('Please enter a Google Sheets URL');
    return;
  }

  state.isLoading = true;
  state.mode = 'syncing';
  state.error = null;
  render();

  sendToPlugin({
    type: 'FETCH_AND_SYNC',
    payload: { url, scope: state.scope },
  });
}

/**
 * Handle sync button click (from preview mode).
 */
function handleSync(): void {
  state.isLoading = true;
  state.mode = 'syncing';
  state.error = null;
  render();

  sendToPlugin({
    type: 'SYNC',
    payload: { scope: state.scope },
  });
}

/**
 * Handle URL input change.
 */
function handleURLChange(event: Event): void {
  const input = event.target as HTMLInputElement;
  state.url = input.value;
}

/**
 * Handle scope radio change.
 */
function handleScopeChange(event: Event): void {
  const input = event.target as HTMLInputElement;
  state.scope = input.value as SyncScope;
}

/**
 * Go back to input mode from preview.
 */
function handleBack(): void {
  state.mode = 'input';
  state.sheetData = null;
  render();
}

// ============================================================================
// UI Updates
// ============================================================================

/**
 * Update the URL input field.
 */
function updateURLInput(): void {
  const input = document.getElementById('sheets-url') as HTMLInputElement | null;
  if (input) {
    input.value = state.url;
  }
}

/**
 * Update the selection option visibility.
 */
function updateSelectionOption(): void {
  const selectionOption = document.querySelector('.selection-option') as HTMLElement | null;
  if (selectionOption) {
    selectionOption.style.display = state.hasSelection ? 'block' : 'none';
  }
}

/**
 * Update the progress display.
 */
function updateProgress(): void {
  const progressBar = document.querySelector('.progress-bar') as HTMLElement | null;
  const progressText = document.querySelector('.progress-text') as HTMLElement | null;

  if (progressBar) {
    progressBar.style.width = `${state.progress}%`;
  }
  if (progressText) {
    progressText.textContent = state.progressMessage;
  }
}

/**
 * Show an error message.
 */
function showError(message: string): void {
  state.error = message;
  render();
}

/**
 * Show a success message.
 */
function showSuccess(message: string): void {
  const successEl = document.querySelector('.success-message') as HTMLElement | null;
  if (successEl) {
    successEl.textContent = message;
    successEl.style.display = 'block';
    setTimeout(() => {
      successEl.style.display = 'none';
    }, 3000);
  }
}

// ============================================================================
// Rendering
// ============================================================================

/**
 * Main render function.
 */
function render(): void {
  const app = document.getElementById('app');
  if (!app) return;

  switch (state.mode) {
    case 'input':
      app.innerHTML = renderInputMode();
      break;
    case 'preview':
      app.innerHTML = renderPreviewMode();
      break;
    case 'syncing':
    case 'resync':
      app.innerHTML = renderSyncingMode();
      break;
  }

  attachEventListeners();
}

/**
 * Render the input mode UI.
 */
function renderInputMode(): string {
  return `
    <div class="plugin-container">
      <header>
        <h1>Sheets Sync</h1>
      </header>

      <main>
        <section class="url-input">
          <label for="sheets-url">Google Sheets URL</label>
          <input
            type="url"
            id="sheets-url"
            placeholder="Paste your shareable Google Sheets link"
            value="${escapeHtml(state.url)}"
          />
          <p class="help-text">
            Make sure your sheet is set to "Anyone with the link can view"
          </p>
        </section>

        <section class="scope-selection">
          <label>Sync scope</label>
          <div class="radio-group">
            <label>
              <input type="radio" name="scope" value="document" ${state.scope === 'document' ? 'checked' : ''} />
              Update entire document
            </label>
            <label>
              <input type="radio" name="scope" value="page" ${state.scope === 'page' ? 'checked' : ''} />
              Update current page only
            </label>
            <label class="selection-option" style="display: ${state.hasSelection ? 'block' : 'none'}">
              <input type="radio" name="scope" value="selection" ${state.scope === 'selection' ? 'checked' : ''} />
              Update current selection only
            </label>
          </div>
        </section>

        ${state.error ? `
          <section class="error-display">
            <p class="error-message">${escapeHtml(state.error)}</p>
          </section>
        ` : ''}

        <div class="success-message" style="display: none;"></div>
      </main>

      <footer class="actions">
        <button id="fetch-btn" class="secondary" ${state.isLoading ? 'disabled' : ''}>
          ${state.isLoading ? 'Loading...' : 'Fetch'}
        </button>
        <button id="sync-btn" class="primary" ${state.isLoading ? 'disabled' : ''}>
          ${state.isLoading ? 'Loading...' : 'Fetch & Sync'}
        </button>
      </footer>
    </div>
  `;
}

/**
 * Render the preview mode UI.
 * Note: Full implementation in TICKET-018.
 */
function renderPreviewMode(): string {
  return `
    <div class="plugin-container">
      <header>
        <button id="back-btn" class="icon-button">&larr;</button>
        <h1>Preview Data</h1>
      </header>

      <main>
        <p class="preview-placeholder">
          Data preview will be implemented in TICKET-018.
        </p>
        ${state.sheetData ? `
          <p>Worksheets: ${state.sheetData.worksheets.map(w => w.name).join(', ')}</p>
        ` : ''}
      </main>

      <footer class="actions">
        <button id="back-btn-footer" class="secondary">Back</button>
        <button id="sync-preview-btn" class="primary">Sync</button>
      </footer>
    </div>
  `;
}

/**
 * Render the syncing mode UI.
 */
function renderSyncingMode(): string {
  return `
    <div class="plugin-container syncing">
      <main>
        <div class="progress-container">
          <div class="progress-track">
            <div class="progress-bar" style="width: ${state.progress}%"></div>
          </div>
          <p class="progress-text">${escapeHtml(state.progressMessage) || 'Starting...'}</p>
        </div>
      </main>
    </div>
  `;
}

/**
 * Attach event listeners after render.
 */
function attachEventListeners(): void {
  // URL input
  const urlInput = document.getElementById('sheets-url');
  if (urlInput) {
    urlInput.addEventListener('input', handleURLChange);
  }

  // Scope radios
  const scopeRadios = document.querySelectorAll('input[name="scope"]');
  scopeRadios.forEach((radio) => {
    radio.addEventListener('change', handleScopeChange);
  });

  // Fetch button
  const fetchBtn = document.getElementById('fetch-btn');
  if (fetchBtn) {
    fetchBtn.addEventListener('click', handleFetch);
  }

  // Sync button
  const syncBtn = document.getElementById('sync-btn');
  if (syncBtn) {
    syncBtn.addEventListener('click', fetchAndSync);
  }

  // Back buttons
  const backBtn = document.getElementById('back-btn');
  const backBtnFooter = document.getElementById('back-btn-footer');
  if (backBtn) {
    backBtn.addEventListener('click', handleBack);
  }
  if (backBtnFooter) {
    backBtnFooter.addEventListener('click', handleBack);
  }

  // Sync from preview button
  const syncPreviewBtn = document.getElementById('sync-preview-btn');
  if (syncPreviewBtn) {
    syncPreviewBtn.addEventListener('click', handleSync);
  }
}

/**
 * Escape HTML to prevent XSS.
 */
function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize the UI.
 */
function init(): void {
  // Listen for messages from the plugin
  window.addEventListener('message', (event) => {
    const msg = event.data.pluginMessage;
    if (msg) {
      handlePluginMessage(msg as PluginMessage);
    }
  });

  // Initial render
  render();

  // Tell the plugin we're ready
  sendToPlugin({ type: 'UI_READY' });
}

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
