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
import {
  setWorkerUrl,
  getWorkerUrl,
  isWorkerEnabled,
  fetchSheetDataViaWorker,
  fetchImageViaWorker,
} from '../core/worker-fetcher';

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
  mode: 'input' | 'preview' | 'syncing' | 'resync' | 'settings';
  progress: number;
  progressMessage: string;
  /** Whether to auto-sync after fetch completes (for Fetch & Sync button) */
  pendingSync: boolean;
  /** Currently selected worksheet in preview mode */
  activeWorksheet: string;
  /** Cloudflare Worker URL (optional) */
  workerUrl: string;
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
  workerUrl: getWorkerUrl() || '',
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
        // Resize window for preview
        sendToPlugin({
          type: 'RESIZE_WINDOW',
          payload: { width: 960, height: 600 },
        });
        render();
      }
      break;

    case 'SYNC_COMPLETE':
      state.isLoading = false;
      state.mode = 'input';
      // Resize window back to input size
      sendToPlugin({
        type: 'RESIZE_WINDOW',
        payload: { width: 720, height: 320 },
      });
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
      fetchImageData(msg.payload.url, msg.payload.nodeId);
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
 *
 * Uses Cloudflare Worker if configured, otherwise falls back to JSONP.
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

    let result: { success: boolean; data?: SheetData; error?: { message: string } | string };

    // Use worker if configured, otherwise use default fetcher
    if (isWorkerEnabled()) {
      console.log('[UI] Using Cloudflare Worker for fetching');
      const workerResult = await fetchSheetDataViaWorker(parsed.spreadsheetId, parsed.gid);
      result = {
        success: workerResult.success,
        data: workerResult.data,
        error: workerResult.error ? { message: workerResult.error } : undefined,
      };
    } else {
      console.log('[UI] Using default JSONP fetcher');
      result = await fetchSheetDataFromServer(parsed.spreadsheetId, parsed.gid);
    }

    if (!result.success || !result.data) {
      const errorMsg = typeof result.error === 'string'
        ? result.error
        : result.error?.message || 'Failed to fetch sheet data';
      sendToPlugin({
        type: 'FETCH_ERROR',
        payload: { error: errorMsg },
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

/**
 * Fetch image data from URL and send to plugin.
 * Uses Cloudflare Worker if configured, otherwise falls back to CORS proxy.
 */
async function fetchImageData(url: string, nodeId: string): Promise<void> {
  // If worker is enabled, try it first
  if (isWorkerEnabled()) {
    try {
      console.log('[UI] Fetching image via worker:', url);
      const uint8Array = await fetchImageViaWorker(url);
      sendToPlugin({
        type: 'IMAGE_DATA',
        payload: { nodeId, url, data: uint8Array },
      });
      return;
    } catch (error) {
      console.warn('[UI] Worker image fetch failed, falling back to direct/proxy:', error);
    }
  }

  // Fallback: Try direct fetch first, then CORS proxy
  const urlsToTry = [
    url,
    `https://corsproxy.io/?${encodeURIComponent(url)}`,
  ];

  for (const fetchUrl of urlsToTry) {
    try {
      const response = await fetch(fetchUrl);
      if (!response.ok) {
        continue;
      }

      const arrayBuffer = await response.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);

      sendToPlugin({
        type: 'IMAGE_DATA',
        payload: { nodeId, url, data: uint8Array },
      });
      return; // Success, exit
    } catch (error) {
      // Try next URL
      continue;
    }
  }

  console.warn('Failed to fetch image (tried all methods):', url);
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
  // Resize window back to input size
  sendToPlugin({
    type: 'RESIZE_WINDOW',
    payload: { width: 720, height: 320 },
  });
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
 * Handle click on a worksheet name - adds // WorksheetName to selected layer names.
 */
function handleWorksheetNameClick(worksheetName: string): void {
  sendToPlugin({
    type: 'RENAME_SELECTION',
    payload: { nameSuffix: `// ${worksheetName}` },
  });
}

/**
 * Open settings mode.
 */
function handleOpenSettings(): void {
  state.mode = 'settings';
  render();
}

/**
 * Save settings and go back to input mode.
 */
function handleSaveSettings(): void {
  const workerInput = document.getElementById('worker-url') as HTMLInputElement | null;
  if (workerInput) {
    const newUrl = workerInput.value.trim();
    state.workerUrl = newUrl;
    setWorkerUrl(newUrl || null);
  }

  state.mode = 'input';
  render();
}

/**
 * Cancel settings and go back to input mode.
 */
function handleCancelSettings(): void {
  state.mode = 'input';
  render();
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
  const selectionOption = document.querySelector('.scope-btn.selection-option') as HTMLElement | null;
  if (selectionOption) {
    selectionOption.style.display = state.hasSelection ? 'flex' : 'none';
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
 * Show a success message and announce to screen readers.
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
  // Also announce to screen readers
  announceToScreenReader(message);
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
    case 'settings':
      app.innerHTML = renderSettingsMode();
      break;
  }

  attachEventListeners();
}

/**
 * Render the input mode UI.
 */
function renderInputMode(): string {
  return `
    <div class="plugin-container" role="main">
      <header>
        <h1 id="plugin-title">Sheets to Layers</h1>
      </header>

      <main aria-labelledby="plugin-title">
        <section class="url-input" aria-labelledby="url-label">
          <label id="url-label" for="sheets-url">Google Sheets URL</label>
          <input
            type="url"
            id="sheets-url"
            placeholder="Paste your shareable Google Sheets link"
            value="${escapeHtml(state.url)}"
            aria-describedby="url-help"
            aria-invalid="${state.error && state.error.includes('URL') ? 'true' : 'false'}"
          />
          <p id="url-help" class="help-text">
            Make sure your sheet is set to "Anyone with the link can view"
          </p>
        </section>

        <section class="scope-selection" aria-labelledby="scope-label">
          <label id="scope-label">Sync scope</label>
          <div class="scope-buttons" role="group" aria-labelledby="scope-label">
            <button
              class="scope-btn ${state.scope === 'document' ? 'active' : ''}"
              data-scope="document"
              aria-pressed="${state.scope === 'document'}"
            >
              Update entire document
            </button>
            <button
              class="scope-btn ${state.scope === 'page' ? 'active' : ''}"
              data-scope="page"
              aria-pressed="${state.scope === 'page'}"
            >
              Update current page only
            </button>
            <button
              class="scope-btn selection-option ${state.scope === 'selection' ? 'active' : ''}"
              data-scope="selection"
              style="display: ${state.hasSelection ? 'flex' : 'none'}"
              aria-pressed="${state.scope === 'selection'}"
            >
              Update current selection only
            </button>
          </div>
        </section>

        ${state.error ? `
          <section class="error-display" role="alert" aria-live="assertive">
            <p class="error-message">${escapeHtml(state.error)}</p>
          </section>
        ` : ''}

        <div class="success-message" role="status" aria-live="polite" style="display: none;"></div>
      </main>

      <footer class="actions">
        <button id="fetch-btn" class="secondary" ${state.isLoading ? 'disabled' : ''} aria-busy="${state.isLoading}">
          ${state.isLoading ? 'Loading...' : 'Fetch'}
        </button>
        <button id="sync-btn" class="primary" ${state.isLoading ? 'disabled' : ''} aria-busy="${state.isLoading}">
          ${state.isLoading ? 'Loading...' : 'Fetch & Sync'}
        </button>
      </footer>

      <!-- Live region for screen reader announcements -->
      <div id="live-region" class="live-region" role="status" aria-live="polite" aria-atomic="true"></div>
    </div>
  `;
}

/**
 * Render worksheet tabs with ARIA roles for accessibility.
 */
function renderWorksheetTabs(): string {
  if (!state.sheetData || state.sheetData.worksheets.length <= 1) {
    return '';
  }

  const activeIndex = state.sheetData.worksheets.findIndex(ws => ws.name === state.activeWorksheet);

  return `
    <div class="worksheet-tabs" role="tablist" aria-label="Worksheets">
      ${state.sheetData.worksheets.map((ws, index) => `
        <button
          class="tab ${ws.name === state.activeWorksheet ? 'active' : ''}"
          data-worksheet="${escapeHtml(ws.name)}"
          data-tab-index="${index}"
          role="tab"
          aria-selected="${ws.name === state.activeWorksheet}"
          aria-controls="preview-panel"
          tabindex="${ws.name === state.activeWorksheet ? '0' : '-1'}"
          id="tab-${index}"
        >
          ${escapeHtml(ws.name)}
        </button>
      `).join('')}
    </div>
  `;
}

/**
 * Render the preview table with accessibility attributes.
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
    <div class="preview-table-container" id="preview-panel" role="tabpanel" aria-label="Sheet data preview">
      <table class="preview-table" aria-label="Sheet data from ${escapeHtml(state.activeWorksheet)}">
        <thead>
          <tr>
            <th class="index-header" scope="col">#</th>
            ${worksheet.labels.map(label => `
              <th
                class="clickable-header"
                scope="col"
                data-label="${escapeHtml(label)}"
                title="Click to name selected layers #${escapeHtml(label)}"
                tabindex="0"
                role="button"
                aria-label="Select column ${escapeHtml(label)}"
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
                tabindex="0"
                role="button"
                aria-label="Select row ${rowIndex + 1}"
              >
                ${rowIndex + 1}
              </td>
              ${row.map((value, colIndex) => `
                <td
                  class="value-cell clickable"
                  data-label="${escapeHtml(worksheet.labels[colIndex])}"
                  data-index="${rowIndex + 1}"
                  title="${value ? 'Click to name layer with #' + escapeHtml(worksheet.labels[colIndex]) + '.' + (rowIndex + 1) : 'Empty cell'}"
                  tabindex="0"
                  role="button"
                  aria-label="${value ? escapeHtml(worksheet.labels[colIndex]) + ' row ' + (rowIndex + 1) + ': ' + escapeHtml(truncateValue(value, 20)) : 'Empty cell at ' + escapeHtml(worksheet.labels[colIndex]) + ' row ' + (rowIndex + 1)}"
                >
                  ${value ? escapeHtml(truncateValue(value, 40)) : '<span class="empty-value" aria-hidden="true">—</span>'}
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
        <button id="back-btn" class="icon-button" aria-label="Back to input" title="Back to input">&larr;</button>
        <h1>Preview Data</h1>
      </header>

      <main>
        <div class="preview-info">
          <span
            class="worksheet-name clickable"
            data-worksheet="${escapeHtml(state.activeWorksheet)}"
            title="Click to add // ${escapeHtml(state.activeWorksheet)} to selected layer names"
            tabindex="0"
            role="button"
            aria-label="Apply worksheet ${escapeHtml(state.activeWorksheet)} to selection"
          >${escapeHtml(state.activeWorksheet)}</span>
          <span class="separator">•</span>
          <span>${labelCount} column${labelCount !== 1 ? 's' : ''}</span>
          <span class="separator">•</span>
          <span>${rowCount} row${rowCount !== 1 ? 's' : ''}</span>
        </div>

        <p class="preview-help">
          Click worksheet name, headers, or cells to rename selected layers
        </p>

        ${renderPreviewTable()}
      </main>

      ${renderWorksheetTabs()}

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
 * Render the settings mode UI.
 */
function renderSettingsMode(): string {
  return `
    <div class="plugin-container">
      <header>
        <button id="settings-back-btn" class="icon-button" aria-label="Back" title="Back">&larr;</button>
        <h1>Settings</h1>
      </header>

      <main>
        <section class="settings-section">
          <label for="worker-url">Cloudflare Worker URL (optional)</label>
          <input
            type="url"
            id="worker-url"
            placeholder="https://your-worker.workers.dev"
            value="${escapeHtml(state.workerUrl)}"
          />
          <p class="help-text">
            Using a Cloudflare Worker improves reliability and handles CORS for images.
            <a href="https://github.com/anthropics/sheets-sync#worker-setup" target="_blank">Setup guide</a>
          </p>
        </section>

        <section class="settings-info">
          <h3>Current Mode</h3>
          <p>${isWorkerEnabled() ? '✓ Using Cloudflare Worker' : 'Using default JSONP (no worker configured)'}</p>
        </section>
      </main>

      <footer class="actions">
        <button id="settings-cancel-btn" class="secondary">Cancel</button>
        <button id="settings-save-btn" class="primary">Save</button>
      </footer>
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

  // Scope buttons
  const scopeButtons = document.querySelectorAll('.scope-btn');
  scopeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const scope = (btn as HTMLElement).dataset.scope as SyncScope;
      if (scope) {
        state.scope = scope;
        render();
      }
    });
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

  // Settings button
  const settingsBtn = document.getElementById('settings-btn');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', handleOpenSettings);
  }

  // Settings back/cancel/save buttons
  const settingsBackBtn = document.getElementById('settings-back-btn');
  const settingsCancelBtn = document.getElementById('settings-cancel-btn');
  const settingsSaveBtn = document.getElementById('settings-save-btn');
  if (settingsBackBtn) {
    settingsBackBtn.addEventListener('click', handleCancelSettings);
  }
  if (settingsCancelBtn) {
    settingsCancelBtn.addEventListener('click', handleCancelSettings);
  }
  if (settingsSaveBtn) {
    settingsSaveBtn.addEventListener('click', handleSaveSettings);
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

  // Worksheet tabs - click and keyboard navigation
  const worksheetTabs = document.querySelectorAll('.worksheet-tabs .tab');
  worksheetTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const worksheetName = (tab as HTMLElement).dataset.worksheet;
      if (worksheetName) {
        handleWorksheetTabClick(worksheetName);
      }
    });

    // Arrow key navigation for tabs
    tab.addEventListener('keydown', (e) => handleTabKeyDown(e as KeyboardEvent));
  });

  // Clickable label headers - mouse and keyboard
  const clickableHeaders = document.querySelectorAll('.clickable-header');
  clickableHeaders.forEach((header) => {
    const handleActivate = () => {
      const label = (header as HTMLElement).dataset.label;
      if (label) {
        handleLabelClick(label);
        announceToScreenReader(`Applied column ${label} to selection`);
      }
    };

    header.addEventListener('click', handleActivate);
    header.addEventListener('keydown', (e) => {
      const event = e as KeyboardEvent;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        handleActivate();
      }
    });
  });

  // Clickable index cells - mouse and keyboard
  const indexCells = document.querySelectorAll('.index-cell.clickable');
  indexCells.forEach((cell) => {
    const handleActivate = () => {
      const index = parseInt((cell as HTMLElement).dataset.index || '0', 10);
      if (index > 0) {
        handleIndexClick(index);
        announceToScreenReader(`Applied row ${index} to selection`);
      }
    };

    cell.addEventListener('click', handleActivate);
    cell.addEventListener('keydown', (e) => {
      const event = e as KeyboardEvent;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        handleActivate();
      }
    });
  });

  // Clickable value cells - mouse and keyboard
  const valueCells = document.querySelectorAll('.value-cell.clickable');
  valueCells.forEach((cell) => {
    const handleActivate = () => {
      const label = (cell as HTMLElement).dataset.label;
      const index = parseInt((cell as HTMLElement).dataset.index || '0', 10);
      if (label && index > 0) {
        handleCellClick(label, index);
        announceToScreenReader(`Applied ${label} row ${index} to selection`);
      }
    };

    cell.addEventListener('click', handleActivate);
    cell.addEventListener('keydown', (e) => {
      const event = e as KeyboardEvent;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        handleActivate();
      }
    });
  });

  // Clickable worksheet name - mouse and keyboard
  const worksheetName = document.querySelector('.worksheet-name.clickable');
  if (worksheetName) {
    const handleActivate = () => {
      const name = (worksheetName as HTMLElement).dataset.worksheet;
      if (name) {
        handleWorksheetNameClick(name);
        announceToScreenReader(`Applied worksheet ${name} to selection`);
      }
    };

    worksheetName.addEventListener('click', handleActivate);
    worksheetName.addEventListener('keydown', (e) => {
      const event = e as KeyboardEvent;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        handleActivate();
      }
    });
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
 * Handle global keyboard events.
 */
function handleGlobalKeyDown(event: KeyboardEvent): void {
  const { key, target } = event;

  // Escape key closes the plugin
  if (key === 'Escape') {
    // If we're in preview mode, go back to input mode
    if (state.mode === 'preview') {
      handleBack();
      return;
    }
    // If we're in settings mode, cancel settings
    if (state.mode === 'settings') {
      handleCancelSettings();
      return;
    }
    // Otherwise, close the plugin (send close message to main thread)
    // Note: The main thread will handle the actual closing
    return;
  }

  // Enter key submits form when focused on input
  if (key === 'Enter' && target instanceof HTMLInputElement) {
    if (target.id === 'sheets-url' && state.mode === 'input') {
      event.preventDefault();
      fetchAndSync();
    }
  }
}

/**
 * Handle keyboard navigation for worksheet tabs.
 */
function handleTabKeyDown(event: KeyboardEvent): void {
  if (!state.sheetData || state.sheetData.worksheets.length <= 1) {
    return;
  }

  const tabs = state.sheetData.worksheets.map(ws => ws.name);
  const currentIndex = tabs.indexOf(state.activeWorksheet);
  let newIndex = currentIndex;

  switch (event.key) {
    case 'ArrowLeft':
    case 'ArrowUp':
      newIndex = Math.max(0, currentIndex - 1);
      break;
    case 'ArrowRight':
    case 'ArrowDown':
      newIndex = Math.min(tabs.length - 1, currentIndex + 1);
      break;
    case 'Home':
      newIndex = 0;
      break;
    case 'End':
      newIndex = tabs.length - 1;
      break;
    default:
      return;
  }

  if (newIndex !== currentIndex) {
    event.preventDefault();
    state.activeWorksheet = tabs[newIndex];
    render();

    // Focus the new tab after render
    setTimeout(() => {
      const newTab = document.querySelector(`[data-tab-index="${newIndex}"]`) as HTMLElement;
      if (newTab) {
        newTab.focus();
      }
    }, 0);
  }
}

/**
 * Announce a message to screen readers via the live region.
 */
function announceToScreenReader(message: string): void {
  const liveRegion = document.getElementById('live-region');
  if (liveRegion) {
    liveRegion.textContent = message;
    // Clear after announcement
    setTimeout(() => {
      liveRegion.textContent = '';
    }, 1000);
  }
}

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

  // Global keyboard handler
  window.addEventListener('keydown', handleGlobalKeyDown);

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
