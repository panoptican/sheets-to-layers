/**
 * UI entry point for Sheets Sync plugin.
 *
 * This code runs in an iframe with network access but no direct
 * access to the Figma document. All document operations must go
 * through message passing to the main thread.
 */

import type { PluginMessage, UIMessage } from '../messages';
import type { SheetData, SyncScope } from '../core/types';
import { parseGoogleSheetsUrl } from '../utils/url';
import { fetchSheetData as fetchSheetDataFromServer, clearCache } from '../core/sheet-fetcher';

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
  /** Whether to auto-sync after fetch completes (for Fetch & Sync button) */
  pendingSync: boolean;
  /** Currently selected worksheet in preview mode */
  activeWorksheet: string;
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
  pendingSync: false,
  activeWorksheet: '',
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
      state.error = null;
      // Set active worksheet to first one if available
      if (msg.payload.sheetData.worksheets.length > 0) {
        state.activeWorksheet = msg.payload.sheetData.worksheets[0].name;
      }

      if (state.pendingSync) {
        // Fetch & Sync flow: auto-trigger sync after fetch
        state.pendingSync = false;
        handleSync();
      } else {
        // Fetch only flow: go to preview mode
        state.isLoading = false;
        state.mode = 'preview';
        render();
      }
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
      state.pendingSync = false;
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
 * Network requests are made here in the UI context (which has network access).
 * Results are sent back to the main plugin thread via messages.
 */
async function fetchSheetData(url: string): Promise<void> {
  try {
    // Parse the URL to get spreadsheet ID and gid
    const parsed = parseGoogleSheetsUrl(url);

    if (!parsed.isValid) {
      sendToPlugin({
        type: 'FETCH_ERROR',
        payload: {
          error: parsed.errorMessage || 'Invalid Google Sheets URL',
        },
      });
      return;
    }

    // Fetch the sheet data
    const result = await fetchSheetDataFromServer(parsed.spreadsheetId, parsed.gid);

    if (!result.success || !result.data) {
      sendToPlugin({
        type: 'FETCH_ERROR',
        payload: {
          error: result.error?.message || 'Failed to fetch sheet data',
        },
      });
      return;
    }

    // Send the data to the main plugin thread
    sendToPlugin({
      type: 'SHEET_DATA',
      payload: {
        data: result.data,
      },
    });
  } catch (error) {
    sendToPlugin({
      type: 'FETCH_ERROR',
      payload: {
        error: error instanceof Error ? error.message : 'Unknown error fetching sheet data',
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
  state.pendingSync = false; // Fetch only, no auto-sync
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
  state.pendingSync = true; // Will trigger sync after fetch completes
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
  state.activeWorksheet = '';
  render();
}

/**
 * Handle worksheet tab click.
 */
function handleWorksheetTabClick(worksheetName: string): void {
  state.activeWorksheet = worksheetName;
  render();
}

/**
 * Handle click on a label header - renames selected layers with #Label.
 */
function handleLabelClick(label: string): void {
  sendToPlugin({
    type: 'RENAME_SELECTION',
    payload: { nameSuffix: `#${label}` },
  });
}

/**
 * Handle click on a specific cell - renames selected layers with #Label.Index.
 */
function handleCellClick(label: string, index: number): void {
  sendToPlugin({
    type: 'RENAME_SELECTION',
    payload: { nameSuffix: `#${label}.${index}` },
  });
}

/**
 * Handle click on an index number - adds .Index to selected layer names.
 */
function handleIndexClick(index: number): void {
  sendToPlugin({
    type: 'RENAME_SELECTION',
    payload: { nameSuffix: `.${index}` },
  });
}

/**
 * Truncate a string value for display.
 */
function truncateValue(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return value.substring(0, maxLength - 1) + '…';
}

/**
 * Get the active worksheet from state.
 */
function getActiveWorksheet(): { name: string; labels: string[]; rows: Record<string, string[]> } | null {
  if (!state.sheetData) return null;
  return state.sheetData.worksheets.find(ws => ws.name === state.activeWorksheet) || null;
}

/**
 * Convert worksheet data to row format for table display.
 */
function getValueRows(worksheet: { labels: string[]; rows: Record<string, string[]> }): string[][] {
  const maxRows = Math.max(
    ...worksheet.labels.map(l => worksheet.rows[l]?.length ?? 0),
    0
  );

  const rows: string[][] = [];
  for (let i = 0; i < maxRows; i++) {
    rows.push(worksheet.labels.map(l => worksheet.rows[l]?.[i] ?? ''));
  }
  return rows;
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
 * Render worksheet tabs.
 */
function renderWorksheetTabs(): string {
  if (!state.sheetData || state.sheetData.worksheets.length <= 1) {
    return '';
  }

  return `
    <div class="worksheet-tabs">
      ${state.sheetData.worksheets.map(ws => `
        <button
          class="tab ${ws.name === state.activeWorksheet ? 'active' : ''}"
          data-worksheet="${escapeHtml(ws.name)}"
        >
          ${escapeHtml(ws.name)}
        </button>
      `).join('')}
    </div>
  `;
}

/**
 * Render the preview table.
 */
function renderPreviewTable(): string {
  const worksheet = getActiveWorksheet();
  if (!worksheet) {
    return '<p class="preview-empty">No data available</p>';
  }

  if (worksheet.labels.length === 0) {
    return '<p class="preview-empty">No columns found in this worksheet</p>';
  }

  const rows = getValueRows(worksheet);

  return `
    <div class="preview-table-container">
      <table class="preview-table">
        <thead>
          <tr>
            <th class="index-header">#</th>
            ${worksheet.labels.map(label => `
              <th
                class="clickable-header"
                data-label="${escapeHtml(label)}"
                title="Click to name selected layers #${escapeHtml(label)}"
              >
                ${escapeHtml(label)}
              </th>
            `).join('')}
          </tr>
        </thead>
        <tbody>
          ${rows.map((row, rowIndex) => `
            <tr>
              <td
                class="index-cell clickable"
                data-index="${rowIndex + 1}"
                title="Click to add .${rowIndex + 1} to selected layer names"
              >
                ${rowIndex + 1}
              </td>
              ${row.map((value, colIndex) => `
                <td
                  class="value-cell clickable"
                  data-label="${escapeHtml(worksheet.labels[colIndex])}"
                  data-index="${rowIndex + 1}"
                  title="${value ? 'Click to name layer with #' + escapeHtml(worksheet.labels[colIndex]) + '.' + (rowIndex + 1) : 'Empty cell'}"
                >
                  ${value ? escapeHtml(truncateValue(value, 40)) : '<span class="empty-value">—</span>'}
                </td>
              `).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

/**
 * Render the preview mode UI.
 */
function renderPreviewMode(): string {
  const worksheet = getActiveWorksheet();
  const rowCount = worksheet ? getValueRows(worksheet).length : 0;
  const labelCount = worksheet?.labels.length ?? 0;

  return `
    <div class="plugin-container preview-mode">
      <header>
        <button id="back-btn" class="icon-button" title="Back to input">&larr;</button>
        <h1>Preview Data</h1>
      </header>

      ${renderWorksheetTabs()}

      <main>
        <div class="preview-info">
          <span>${labelCount} column${labelCount !== 1 ? 's' : ''}</span>
          <span class="separator">•</span>
          <span>${rowCount} row${rowCount !== 1 ? 's' : ''}</span>
        </div>

        <p class="preview-help">
          Click headers or cells to rename selected layers
        </p>

        ${renderPreviewTable()}
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

  // Worksheet tabs
  const worksheetTabs = document.querySelectorAll('.worksheet-tabs .tab');
  worksheetTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const worksheetName = (tab as HTMLElement).dataset.worksheet;
      if (worksheetName) {
        handleWorksheetTabClick(worksheetName);
      }
    });
  });

  // Clickable label headers
  const clickableHeaders = document.querySelectorAll('.clickable-header');
  clickableHeaders.forEach((header) => {
    header.addEventListener('click', () => {
      const label = (header as HTMLElement).dataset.label;
      if (label) {
        handleLabelClick(label);
      }
    });
  });

  // Clickable index cells
  const indexCells = document.querySelectorAll('.index-cell.clickable');
  indexCells.forEach((cell) => {
    cell.addEventListener('click', () => {
      const index = parseInt((cell as HTMLElement).dataset.index || '0', 10);
      if (index > 0) {
        handleIndexClick(index);
      }
    });
  });

  // Clickable value cells
  const valueCells = document.querySelectorAll('.value-cell.clickable');
  valueCells.forEach((cell) => {
    cell.addEventListener('click', () => {
      const label = (cell as HTMLElement).dataset.label;
      const index = parseInt((cell as HTMLElement).dataset.index || '0', 10);
      if (label && index > 0) {
        handleCellClick(label, index);
      }
    });
  });
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
