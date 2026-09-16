import {
  isPluginMessage,
  type PluginMessage,
  type UIMessage,
} from '../messages';
import { h, render as renderPreact, type ComponentChild } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  Button as FigmaButton,
  Checkbox as FigmaCheckbox,
  Dropdown as FigmaDropdown,
  IconButton as FigmaIconButton,
  IconClose24,
  IconNavigateBack24,
  IconNavigateForward24,
  Modal as FigmaModal,
  render as renderFigmaPluginUI,
  SegmentedControl as FigmaSegmentedControl,
  Textbox as FigmaTextbox,
} from '@create-figma-plugin/ui';
import {
  DEFAULT_INTERPRETATION,
  type BindingAction,
  type DocumentSyncConfig,
  type InterpretationPreferences,
  type OperationResult,
  type PreflightSummary,
  type SheetData,
  type SheetSnapshot,
  type SyncScope,
  type Worksheet,
} from '../core/types';
import { reorientSheetData } from '../core/sheet-structure';
import { parseGoogleSheetsUrl } from '../utils/url';
import { createSheetFetcher } from '../core/fetcher-factory';
import {
  MAX_IMAGE_RESPONSE_BYTES,
  readResponseBytesBounded,
  runImageRequest,
  withRequestDeadline,
} from '../core/transport';

const ROWS = 100;
const MAX_CELLS = 2000;
const imageRequests = new Map<string, Promise<Uint8Array>>();
type Mode = 'input' | 'preview' | 'running' | 'preflight' | 'result';
type Kind = 'fetch' | 'fetch-and-sync' | 'sync' | 'retry' | 'resync';
type Active = { id: string; kind: Kind; controller: AbortController };
type State = {
  mode: Mode;
  url: string;
  scope: SyncScope;
  hasSelection: boolean;
  preferences: InterpretationPreferences;
  previewSettings: InterpretationPreferences | null;
  snapshot: SheetSnapshot | null;
  data: SheetData | null;
  browsing: string;
  rowPage: number;
  colPage: number;
  active: Active | null;
  preflight: PreflightSummary | null;
  excluded: Set<string>;
  result: OperationResult | null;
  error: string | null;
  progress: { value: number; message: string };
};
const state: State = {
  mode: 'input',
  url: '',
  scope: 'page',
  hasSelection: false,
  preferences: copyPrefs(DEFAULT_INTERPRETATION),
  previewSettings: null,
  snapshot: null,
  data: null,
  browsing: '',
  rowPage: 0,
  colPage: 0,
  active: null,
  preflight: null,
  excluded: new Set(),
  result: null,
  error: null,
  progress: { value: 0, message: '' },
};

function copyPrefs(p: InterpretationPreferences): InterpretationPreferences {
  return {
    orientations: { ...p.orientations },
    blankText: p.blankText,
    ...(p.defaultWorksheet ? { defaultWorksheet: p.defaultWorksheet } : {}),
  };
}
function send(message: UIMessage): void {
  parent.postMessage({ pluginMessage: message }, '*');
}
function runId(): string {
  return (
    crypto.randomUUID?.() ||
    `run-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}
function begin(kind: Kind): Active {
  state.active?.controller.abort();
  const active = { id: runId(), kind, controller: new AbortController() };
  state.active = active;
  state.error = null;
  state.preflight = null;
  state.excluded.clear();
  state.progress = { value: 0, message: 'Preparing…' };
  return active;
}
function active(run: string): boolean {
  return state.active?.id === run && !state.active.controller.signal.aborted;
}
function finish(run: string): void {
  if (state.active?.id === run) state.active = null;
  for (const key of imageRequests.keys()) {
    if (key.startsWith(`${run}:`)) imageRequests.delete(key);
  }
}
function resize(width: number, height: number): void {
  send({ type: 'RESIZE_WINDOW', payload: { width, height } });
}
function applyConfig(config: DocumentSyncConfig): void {
  state.url = config.sourceUrl;
  state.scope = config.scope;
  state.preferences = copyPrefs(config.preferences);
}
function setSnapshot(snapshot: SheetSnapshot): void {
  state.snapshot = snapshot;
  state.url = snapshot.sourceUrl;
  state.preferences = copyPrefs(snapshot.preferences);
  recompute();
  state.browsing = state.data?.activeWorksheet || '';
}
function recompute(): void {
  if (state.snapshot)
    state.data = reorientSheetData(state.snapshot.data, state.preferences);
  state.rowPage = 0;
  state.colPage = 0;
}
function worksheet(): Worksheet | null {
  return state.data?.worksheets.find((w) => w.name === state.browsing) || null;
}
function defaultWorksheet(): string {
  return (
    state.preferences.defaultWorksheet || state.data?.activeWorksheet || ''
  );
}
function rows(w: Worksheet): string[][] {
  const n = Math.max(0, ...w.labels.map((l) => w.rows[l]?.length || 0));
  return Array.from({ length: n }, (_, i) =>
    w.labels.map((l) => w.rows[l]?.[i] || ''),
  );
}

function receive(message: PluginMessage): void {
  if (message.type === 'INIT') {
    state.hasSelection = message.payload.hasSelection;
    if (message.payload.config) applyConfig(message.payload.config);
    else state.url = message.payload.lastUrl || '';
    render();
    return;
  }
  if (message.type === 'SELECTION_CHANGED') {
    state.hasSelection = message.payload.hasSelection;
    render();
    return;
  }
  if (message.type === 'CANCEL_FETCH') {
    if (state.active?.id === message.runId) state.active.controller.abort();
    return;
  }
  // A locally cancelled run still needs its matching terminal result so the
  // user can see the work that completed before cancellation. All nonterminal
  // messages remain blocked once the controller has been aborted.
  const terminalForActiveRun =
    message.type === 'SYNC_COMPLETE' && state.active?.id === message.runId;
  if (!terminalForActiveRun && !active(message.runId)) return;
  if (message.type === 'REQUEST_SHEET_FETCH') {
    void fetchSheet(message.runId, message.payload.url);
    return;
  }
  if (message.type === 'REQUEST_IMAGE_FETCH') {
    void fetchImage(message.runId, message.payload);
    return;
  }
  if (message.type === 'FETCH_SUCCESS') {
    setSnapshot(message.payload.snapshot);
    state.mode = state.active?.kind === 'fetch' ? 'preview' : 'running';
    resize(
      state.mode === 'preview' ? 960 : 720,
      state.mode === 'preview' ? 600 : 360,
    );
    render();
    return;
  }
  if (message.type === 'PREFLIGHT') {
    if (state.preflight?.preflightId !== message.payload.preflightId)
      state.excluded.clear();
    state.preflight = message.payload;
    state.mode = 'preflight';
    resize(960, 600);
    render();
    return;
  }
  if (message.type === 'PROGRESS') {
    state.progress = {
      value: message.payload.progress,
      message: message.payload.message,
    };
    render();
    return;
  }
  if (message.type === 'ERROR') {
    state.error = message.payload.message;
    state.mode = state.snapshot ? 'preview' : 'input';
    finish(message.runId);
    render();
    return;
  }
  if (message.type === 'SYNC_COMPLETE') {
    state.result = message.payload;
    state.mode = 'result';
    finish(message.runId);
    render();
    return;
  }
}
function receiveResync(
  message: Extract<PluginMessage, { type: 'RESYNC_MODE' }>,
): void {
  state.active?.controller.abort();
  state.active = {
    id: message.runId,
    kind: 'resync',
    controller: new AbortController(),
  };
  applyConfig(message.payload.config);
  state.mode = 'running';
  state.progress = { value: 0, message: 'Loading saved source…' };
  render();
}

async function fetchSheet(id: string, url: string): Promise<void> {
  const operation = state.active;
  if (!operation || operation.id !== id) return;
  const parsed = parseGoogleSheetsUrl(url);
  if (!parsed.isValid) {
    send({
      type: 'FETCH_ERROR',
      runId: id,
      payload: { error: parsed.errorMessage || 'Invalid Google Sheets URL' },
    });
    return;
  }
  try {
    const result = await createSheetFetcher().fetchSheetData(
      parsed.spreadsheetId,
      parsed.gid,
      { signal: operation.controller.signal, refresh: true },
    );
    if (!active(id)) return;
    if (!result.success || !result.data) {
      const error =
        typeof result.error === 'string' ? result.error : result.error?.message;
      send({
        type: 'FETCH_ERROR',
        runId: id,
        payload: { error: error || 'Failed to fetch sheet data' },
      });
      return;
    }
    send({
      type: 'SHEET_DATA',
      runId: id,
      payload: { data: result.data, fetchedAt: Date.now() },
    });
  } catch (error) {
    if (active(id))
      send({
        type: 'FETCH_ERROR',
        runId: id,
        payload: {
          error: operation.controller.signal.aborted
            ? 'Fetch cancelled.'
            : error instanceof Error
              ? error.message
              : 'Failed to fetch sheet data',
        },
      });
  }
}
async function bytes(url: string, signal: AbortSignal): Promise<Uint8Array> {
  const response = await fetch(url, { signal, credentials: 'omit' });
  if (!response.ok)
    throw new Error(`Image request failed (${response.status}).`);
  if (
    !(response.headers.get('content-type') || '')
      .toLowerCase()
      .startsWith('image/')
  )
    throw new Error('Image URL did not return an image.');
  return await readResponseBytesBounded(
    response,
    MAX_IMAGE_RESPONSE_BYTES,
    signal,
  );
}
async function fetchImage(
  id: string,
  identity: { requestId: string; nodeId: string; url: string },
): Promise<void> {
  const operation = state.active;
  if (!operation || operation.id !== id) return;
  try {
    const key = `${id}:${identity.url}`;
    let request = imageRequests.get(key);
    if (!request) {
      const fetcher = createSheetFetcher();
      // Worker image fetching already acquires the shared image/upstream
      // limit. Wrapping it here would queue the same request twice and can
      // deadlock once the image limit is full.
      request = fetcher.fetchImage
        ? fetcher.fetchImage(identity.url, {
            signal: operation.controller.signal,
          })
        : runImageRequest(
            () =>
              withRequestDeadline(
                (deadlineSignal) => bytes(identity.url, deadlineSignal),
                { signal: operation.controller.signal },
              ),
            operation.controller.signal,
          );
      imageRequests.set(key, request);
      void request.then(
        () => imageRequests.delete(key),
        () => imageRequests.delete(key),
      );
    }
    const data = await request;
    if (active(id))
      send({ type: 'IMAGE_DATA', runId: id, payload: { ...identity, data } });
  } catch (error) {
    if (active(id))
      send({
        type: 'IMAGE_FETCH_ERROR',
        runId: id,
        payload: {
          ...identity,
          error:
            error instanceof Error ? error.message : 'Failed to load image.',
        },
      });
  }
}

function fetchStart(andSync: boolean): void {
  if (!state.url.trim()) {
    state.error = 'Enter a Google Sheets URL.';
    render();
    return;
  }
  const operation = begin(andSync ? 'fetch-and-sync' : 'fetch');
  state.mode = 'running';
  render();
  if (andSync)
    send({
      type: 'FETCH_AND_SYNC',
      runId: operation.id,
      payload: {
        url: state.url.trim(),
        scope: state.scope,
        preferences: state.preferences,
      },
    });
  else
    send({
      type: 'FETCH',
      runId: operation.id,
      payload: { url: state.url.trim(), preferences: state.preferences },
    });
}
function syncStart(): void {
  if (!state.snapshot) return;
  const operation = begin('sync');
  state.mode = 'running';
  render();
  send({
    type: 'SYNC',
    runId: operation.id,
    payload: {
      scope: state.scope,
      snapshotId: state.snapshot.id,
      preferences: state.preferences,
    },
  });
}
function apply(): void {
  if (!state.preflight || !state.active) return;
  send({
    type: 'APPLY',
    runId: state.active.id,
    payload: {
      snapshotId: state.preflight.snapshotId,
      preflightId: state.preflight.preflightId,
      excludedIssueIds: [...state.excluded],
    },
  });
  state.mode = 'running';
  state.progress.message = 'Syncing layers…';
  render();
}
function retry(): void {
  if (!state.result) return;
  const operation = begin('retry');
  state.mode = 'running';
  render();
  send({
    type: 'RETRY_FAILED',
    runId: operation.id,
    payload: { snapshotId: state.result.snapshotId },
  });
}
function binding(action: BindingAction): void {
  send({ type: 'RENAME_SELECTION', payload: { action } });
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function btn(id: string, text: string, className = ''): HTMLButtonElement {
  const node = el('button', `plain-button ${className}`, text);
  node.id = id;
  node.type = 'button';
  return node;
}
const figmaUiRoots = new Set<HTMLDivElement>();
const renderFigmaUIComponent = renderFigmaPluginUI<{
  component: ComponentChild;
}>(({ component }) => component);
function mountFigmaUI(
  component: ComponentChild,
  className = '',
): HTMLDivElement {
  const host = el('div', `figma-ui-host ${className}`.trim());
  renderFigmaUIComponent(host, { component });
  figmaUiRoots.add(host);
  return host;
}
function unmountFigmaUI(): void {
  for (const host of figmaUiRoots) renderPreact(null, host);
  figmaUiRoots.clear();
}
type FigmaButtonOptions = {
  primary?: boolean;
  disabled?: boolean;
  className?: string;
  hostClassName?: string;
  title?: string;
  ariaLabel?: string;
  onClick?: () => void;
};
function figmaButton(
  id: string,
  text: string,
  options: FigmaButtonOptions = {},
): HTMLDivElement {
  return mountFigmaUI(
    h(FigmaButton, {
      id,
      secondary: options.primary !== true,
      disabled: options.disabled === true,
      className: options.className,
      title: options.title,
      'aria-label': options.ariaLabel,
      onClick: options.onClick,
      children: text,
    }),
    options.hostClassName,
  );
}
function figmaIconButton(
  id: string,
  icon: ComponentChild,
  label: string,
  options: Pick<FigmaButtonOptions, 'disabled' | 'onClick'> = {},
): HTMLDivElement {
  return mountFigmaUI(
    h(FigmaIconButton, {
      id,
      disabled: options.disabled === true,
      title: label,
      'aria-label': label,
      onClick: options.onClick,
      children: icon,
    }),
  );
}
function root(name = ''): HTMLDivElement {
  return el('div', `plugin-container ${name}`);
}
function notice(message: string): HTMLElement {
  const node = el('section', 'error-display');
  node.setAttribute('role', 'alert');
  node.append(el('p', 'error-message', message));
  return node;
}
function live(): HTMLElement {
  const node = el('div', 'live-region');
  node.id = 'live-region';
  node.setAttribute('role', 'status');
  node.setAttribute('aria-live', 'polite');
  return node;
}

function inputView(): HTMLElement {
  const node = root();
  const header = el('header');
  const title = el('h1', '', 'Sheets to Layers');
  title.id = 'plugin-title';
  header.append(title);
  const main = el('main');
  const section = el('section', 'url-input');
  const label = el('label', 'field-label', 'Google Sheets URL');
  label.htmlFor = 'sheets-url';
  const input = mountFigmaUI(
    h(FigmaTextbox, {
      id: 'sheets-url',
      value: state.url,
      placeholder: 'Paste your shareable Google Sheets link',
      onValueInput: (value: string) => {
        state.url = value;
      },
    }),
  );
  section.append(label, input);
  main.append(section, scopeView());
  if (state.error) main.append(notice(state.error));
  const footer = el('footer', 'actions');
  footer.append(
    figmaButton('fetch-btn', 'Fetch'),
    figmaButton('sync-btn', 'Fetch & Sync', { primary: true }),
  );
  node.append(header, main, footer, live());
  return node;
}
function scopeView(): HTMLElement {
  const section = el('section', 'scope-selection');
  section.append(el('div', 'field-label', 'Sync scope'));
  const choices = el('div', 'scope-control');
  const options = [
    { value: 'document', children: 'Entire document' },
    { value: 'page', children: 'Current page' },
    ...(state.hasSelection
      ? [{ value: 'selection', children: 'Current selection' }]
      : []),
  ];
  choices.append(
    mountFigmaUI(
      h(FigmaSegmentedControl, {
        value: state.scope,
        options,
        onValueChange: (value: string) => {
          state.scope = value as SyncScope;
          render();
        },
      }),
    ),
  );
  section.append(choices);
  return section;
}
function previewView(): HTMLElement {
  const node = root('preview-mode');
  const header = el('header');
  header.append(
    figmaIconButton('back-btn', h(IconNavigateBack24, null), 'Back'),
    el('h1', '', 'Preview data'),
    figmaButton('preview-settings-btn', 'Settings'),
  );
  const main = el('main');
  if (state.error) main.append(notice(state.error));
  main.append(previewControls(), tableView());
  const footer = el('footer', 'actions');
  footer.append(
    figmaButton('refresh-btn', 'Refresh'),
    figmaButton('sync-preview-btn', 'Review sync', { primary: true }),
  );
  node.append(header, main, tabsView(), footer, live());
  if (state.previewSettings) node.append(previewSettingsModal());
  return node;
}
function previewControls(): HTMLElement {
  const box = el('div', 'preview-info');
  const w = worksheet();
  const metadata = el('div', 'preview-metadata');
  metadata.append(
    el('span', 'worksheet-name', state.browsing),
    el('span', 'separator', '•'),
    el('span', '', `${w?.labels.length || 0} columns`),
    el('span', 'separator', '•'),
    el(
      'span',
      '',
      state.snapshot
        ? `Fetched ${Math.floor((Date.now() - state.snapshot.fetchedAt) / 1000)}s ago`
        : 'No snapshot',
    ),
  );
  box.append(metadata);
  return box;
}
function PreviewSettingsDialog(props: {
  initialPreferences: InterpretationPreferences;
}): ComponentChild {
  const w = worksheet();
  const [draft, setDraft] = useState(() => copyPrefs(props.initialPreferences));
  const defaultWorksheetRef = useRef<HTMLDivElement>(null);
  useEffect(() => defaultWorksheetRef.current?.focus(), []);
  const defaultOptions = (state.data?.worksheets || []).map((sheet) => ({
    value: sheet.name,
    text: sheet.name,
  }));
  const orientationValue = w
    ? draft.orientations[w.id || w.name] || w.orientation
    : 'columns';
  const content = h(
    'div',
    { className: 'settings-dialog' },
    h(
      'div',
      { className: 'settings-dialog-header' },
      h('h2', { id: 'preview-settings-title' }, 'Data settings'),
      h(FigmaIconButton, {
        id: 'preview-settings-close-btn',
        title: 'Close data settings',
        'aria-label': 'Close data settings',
        onClick: closePreviewSettings,
        children: h(IconClose24, null),
      }),
    ),
    h(
      'p',
      { className: 'settings-dialog-description' },
      'Choose how this spreadsheet is interpreted when you preview and sync it.',
    ),
    h(
      'div',
      { className: 'settings-fields' },
      h(
        'div',
        { className: 'settings-field' },
        h(
          'div',
          { className: 'field-label', id: 'default-worksheet-label' },
          'Default worksheet',
        ),
        h(FigmaDropdown, {
          id: 'default-worksheet',
          ref: defaultWorksheetRef,
          value: draft.defaultWorksheet || state.data?.activeWorksheet || null,
          options: defaultOptions,
          'aria-labelledby': 'default-worksheet-label',
          onValueChange: (value: string) =>
            setDraft({ ...draft, defaultWorksheet: value }),
        }),
      ),
      h(
        'div',
        { className: 'settings-field' },
        h(
          'div',
          { className: 'field-label', id: 'orientation-select-label' },
          `Data orientation${w ? ` · ${w.name}` : ''}`,
        ),
        h(FigmaDropdown, {
          id: 'orientation-select',
          value: orientationValue,
          options: [
            { value: 'columns', text: 'Headers in first row' },
            { value: 'rows', text: 'Headers in first column' },
          ],
          'aria-labelledby': 'orientation-select-label',
          onValueChange: (value: string) => {
            if (!w) return;
            setDraft({
              ...draft,
              orientations: {
                ...draft.orientations,
                [w.id || w.name]: value as 'columns' | 'rows',
              },
            });
          },
        }),
      ),
      h(
        'div',
        { className: 'settings-field' },
        h(
          'div',
          { className: 'field-label', id: 'blank-text-policy-label' },
          'Blank text',
        ),
        h(FigmaDropdown, {
          id: 'blank-text-policy',
          value: draft.blankText,
          options: [
            {
              value: 'clear-and-hide',
              text: 'Clear and hide blank text',
            },
            {
              value: 'leave-unchanged',
              text: 'Leave blank text unchanged',
            },
          ],
          'aria-labelledby': 'blank-text-policy-label',
          onValueChange: (value: string) =>
            setDraft({
              ...draft,
              blankText: value as InterpretationPreferences['blankText'],
            }),
        }),
      ),
    ),
    h(
      'div',
      { className: 'settings-dialog-actions' },
      h(FigmaButton, {
        id: 'preview-settings-cancel-btn',
        secondary: true,
        onClick: closePreviewSettings,
        children: 'Cancel',
      }),
      h(FigmaButton, {
        id: 'preview-settings-save-btn',
        onClick: () => savePreviewSettings(draft),
        children: 'Save settings',
      }),
    ),
  );
  return h(FigmaModal, {
    id: 'preview-settings-dialog',
    open: true,
    transition: false,
    position: 'center',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': 'preview-settings-title',
    onEscapeKeyDown: closePreviewSettings,
    onOverlayClick: closePreviewSettings,
    children: content,
  });
}
function previewSettingsModal(): HTMLElement {
  return mountFigmaUI(
    h(PreviewSettingsDialog, {
      initialPreferences: state.previewSettings || state.preferences,
    }),
  );
}
function openPreviewSettings(): void {
  state.previewSettings = copyPrefs(state.preferences);
  render();
}
function closePreviewSettings(): void {
  state.previewSettings = null;
  render();
  document.getElementById('preview-settings-btn')?.focus();
}
function savePreviewSettings(nextPreferences = state.previewSettings): void {
  if (!nextPreferences) return;
  const review = state.mode === 'preflight' ? state.preflight : null;
  const operation = state.mode === 'preflight' ? state.active : null;
  state.preferences = copyPrefs(nextPreferences);
  state.previewSettings = null;
  recompute();
  if (review && operation) {
    state.mode = 'running';
    state.progress = { value: 0, message: 'Updating review…' };
    render();
    send({
      type: 'UPDATE_PREFLIGHT_SETTINGS',
      runId: operation.id,
      payload: {
        snapshotId: review.snapshotId,
        preflightId: review.preflightId,
        preferences: state.preferences,
      },
    });
    return;
  }
  render();
  document.getElementById('preview-settings-btn')?.focus();
}
function tabsView(): HTMLElement {
  const bar = el('div', 'worksheet-bar');
  const tabs = el('div', 'worksheet-tabs');
  tabs.setAttribute('role', 'tablist');
  for (const [i, ws] of (state.data?.worksheets || []).entries()) {
    const tab = btn(
      '',
      ws.name,
      `tab ${ws.name === state.browsing ? 'active' : ''}`,
    );
    tab.dataset.worksheet = ws.name;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(ws.name === state.browsing));
    tab.tabIndex = ws.name === state.browsing ? 0 : -1;
    tab.dataset.tabIndex = String(i);
    tabs.append(tab);
  }
  bar.append(tabs);
  if (
    state.hasSelection &&
    state.browsing &&
    state.browsing !== defaultWorksheet()
  ) {
    const apply = figmaButton(
      'bind-worksheet-btn',
      `Use ${state.browsing} for selected layers`,
      {
        className: 'worksheet-bind-action',
        hostClassName: 'worksheet-bind-host',
        title: `Add an explicit ${state.browsing} worksheet binding to the selected layers`,
        onClick: () =>
          binding({ type: 'worksheet', worksheet: state.browsing }),
      },
    );
    bar.append(apply);
  }
  return bar;
}
function tableView(): HTMLElement {
  const box = el('div', 'preview-table-container');
  const w = worksheet();
  if (!w || !w.labels.length) {
    box.append(el('p', 'preview-empty', 'No columns found in this worksheet.'));
    return box;
  }
  const data = rows(w);
  const columnsPerPage = Math.max(
    1,
    Math.floor(MAX_CELLS / Math.max(1, Math.min(ROWS, data.length || 1))),
  );
  const firstColumn = state.colPage * columnsPerPage;
  const labels = w.labels.slice(firstColumn, firstColumn + columnsPerPage);
  const firstRow = state.rowPage * ROWS;
  const table = el('table', 'preview-table');
  const head = el('thead');
  const hr = el('tr');
  hr.append(el('th', 'index-header', '#'));
  for (const label of labels) {
    const cell = el('th', 'clickable-header', label);
    cell.dataset.action = 'label';
    cell.dataset.label = label;
    cell.tabIndex = 0;
    cell.title = `Apply ${label} to selected layers`;
    cell.setAttribute('role', 'button');
    hr.append(cell);
  }
  head.append(hr);
  const body = el('tbody');
  for (const [offset, values] of data
    .slice(firstRow, firstRow + ROWS)
    .entries()) {
    const index = firstRow + offset + 1;
    const tr = el('tr');
    const indexCell = el('td', 'index-cell clickable', String(index));
    indexCell.dataset.action = 'index';
    indexCell.dataset.index = String(index);
    indexCell.tabIndex = 0;
    tr.append(indexCell);
    for (const [col, label] of labels.entries()) {
      const value = values[firstColumn + col] || '';
      const cell = el('td', 'value-cell clickable', value || '—');
      cell.dataset.action = 'cell';
      cell.dataset.label = label;
      cell.dataset.index = String(index);
      cell.setAttribute(
        'aria-label',
        `${label} row ${index}: ${value || 'empty'}`,
      );
      cell.tabIndex = 0;
      tr.append(cell);
    }
    body.append(tr);
  }
  table.append(head, body);
  const scroll = el('div', 'preview-table-scroll');
  scroll.append(table);
  box.append(scroll);
  const pagination = pages(data.length, w.labels.length, columnsPerPage);
  if (pagination) box.append(pagination);
  return box;
}
function pages(
  rowCount: number,
  colCount: number,
  cols: number,
): HTMLElement | null {
  const rp = Math.max(1, Math.ceil(rowCount / ROWS));
  const cp = Math.max(1, Math.ceil(colCount / cols));
  if (rp === 1 && cp === 1) return null;

  const box = el('div', 'table-pagination');
  const addPager = (
    kind: 'row' | 'column',
    current: number,
    pages: number,
    pageSize: number,
    total: number,
  ) => {
    if (pages === 1) return;
    const group = el('div', 'pagination-group');
    const plural = kind === 'row' ? 'Rows' : 'Columns';
    const first = current * pageSize + 1;
    const last = Math.min(total, first + pageSize - 1);
    const previous = figmaIconButton(
      `${kind}-prev-btn`,
      h(IconNavigateBack24, null),
      `Previous ${plural.toLowerCase()}`,
      { disabled: current === 0 },
    );
    const next = figmaIconButton(
      `${kind}-next-btn`,
      h(IconNavigateForward24, null),
      `Next ${plural.toLowerCase()}`,
      {
        disabled: current >= pages - 1,
      },
    );
    group.append(
      previous,
      el(
        'span',
        'pagination-label',
        `${plural} ${first.toLocaleString()}–${last.toLocaleString()} of ${total.toLocaleString()}`,
      ),
      next,
    );
    box.append(group);
  };

  addPager('row', state.rowPage, rp, ROWS, rowCount);
  addPager('column', state.colPage, cp, cols, colCount);
  return box;
}
function runningView(): HTMLElement {
  const node = root('syncing');
  const main = el('main');
  const box = el('div', 'progress-container');
  const track = el('div', 'progress-track');
  const bar = el('div', 'progress-bar');
  bar.style.width = `${Math.min(100, Math.max(0, state.progress.value))}%`;
  track.append(bar);
  box.append(
    track,
    el('p', 'progress-text', state.progress.message || 'Working…'),
  );
  main.append(box);
  const footer = el('footer', 'actions');
  footer.append(figmaButton('cancel-sync-btn', 'Cancel'));
  node.append(main, footer, live());
  return node;
}
function preflightView(): HTMLElement {
  const node = root('preview-mode preflight-mode');
  const header = el('header');
  header.append(
    el('h1', '', 'Review sync'),
    figmaButton('preview-settings-btn', 'Settings'),
  );
  node.append(header);
  const main = el('main');
  const p = state.preflight;
  if (!p) main.append(notice('No proposed changes are available.'));
  else {
    const details = el('dl', 'preflight-details');
    const orientationChoices = Object.entries(p.preferences.orientations)
      .map(
        ([worksheetName, orientation]) =>
          `${worksheetName}: ${orientation === 'columns' ? 'headers in first row' : 'headers in first column'}`,
      )
      .join('; ');
    const entries: Array<[string, string, string?]> = [
      ['Source', p.sourceUrl, 'preflight-source'],
      [
        'Scope',
        `${p.scope === 'document' ? 'Entire document' : p.scope === 'page' ? 'Current page' : 'Current selection'} (${p.rootIds.length} ${p.rootIds.length === 1 ? 'root' : 'roots'})`,
      ],
      ['Default worksheet', p.defaultWorksheet],
      [
        'Data orientation',
        orientationChoices ||
          'Auto-detect headers in the first row or first column',
      ],
      [
        'Blank text',
        p.preferences.blankText === 'leave-unchanged'
          ? 'Leave blank text unchanged'
          : 'Clear and hide blank text',
      ],
    ];
    for (const [term, value, className] of entries) {
      const dt = el('dt', '', term);
      const dd = el('dd', className || '', value);
      details.append(dt, dd);
    }
    main.append(details);
    for (const r of p.repeats.filter(
      (repeat) => repeat.additions > 0 || repeat.removals > 0,
    )) {
      const layerName =
        r.layerName.replace(/\s*@#(?:\s|$)/g, ' ').trim() || 'Repeated frame';
      const count = r.removals || r.additions;
      const item = count === 1 ? 'item' : 'items';
      main.append(
        el(
          'p',
          'repeat-change',
          r.removals
            ? `${layerName} will remove ${r.removals} repeated ${item}.`
            : `${layerName} will add ${r.additions} repeated ${item}.`,
        ),
      );
    }
    for (const issue of p.issues) {
      const item = el('div', `issue ${issue.blocking ? 'blocking' : ''}`);
      item.append(
        mountFigmaUI(
          h(FigmaCheckbox, {
            id: `preflight-issue-${issue.id}`,
            value: state.excluded.has(issue.id),
            onValueChange: (checked: boolean) => {
              if (checked) state.excluded.add(issue.id);
              else state.excluded.delete(issue.id);
              render();
            },
            children: `Exclude ${issue.blocking ? 'blocking ' : ''}issue: ${issue.message}`,
          }),
        ),
      );
      main.append(item);
    }
  }
  const footer = el('footer', 'actions');
  const applyDisabled =
    !p ||
    p.issues.filter((i) => i.blocking).some((i) => !state.excluded.has(i.id));
  footer.append(
    figmaButton('preflight-back-btn', 'Back'),
    figmaButton('apply-btn', 'Sync layers', {
      primary: true,
      disabled: applyDisabled,
    }),
  );
  node.append(main, footer, live());
  if (state.previewSettings) node.append(previewSettingsModal());
  return node;
}
function resultView(): HTMLElement {
  const node = root('preview-mode');
  const header = el('header');
  header.append(el('h1', '', 'Sync result'));
  node.append(header);
  const main = el('main');
  const r = state.result;
  if (r) {
    main.append(
      el(
        'p',
        'result-summary',
        `${r.status}: ${r.counts.changed} changed, ${r.counts.unchanged} unchanged, ${r.counts.skipped} skipped, ${r.counts.failed} failed.`,
      ),
    );
    for (const outcome of r.outcomes) {
      const row = btn(
        '',
        `${outcome.layerName}: ${outcome.status}${outcome.message ? ` — ${outcome.message}` : ''}`,
        `outcome ${outcome.status}`,
      );
      row.dataset.layerId = outcome.layerId;
      row.setAttribute(
        'aria-label',
        `Select ${outcome.layerName}, ${outcome.status}${outcome.message ? `: ${outcome.message}` : ''}`,
      );
      main.append(row);
    }
    for (const warning of r.warnings) {
      main.append(el('p', 'result-warning', warning));
    }
    for (const error of r.errors) {
      main.append(
        el('p', 'result-error', `${error.layerName}: ${error.error}`),
      );
    }
  }
  const footer = el('footer', 'actions');
  footer.append(figmaButton('result-back-btn', 'Back to preview'));
  if (r && r.counts.failed)
    footer.append(figmaButton('retry-btn', 'Retry failed', { primary: true }));
  node.append(main, footer, live());
  return node;
}
function render(): void {
  const app = document.getElementById('app');
  if (!app) return;
  unmountFigmaUI();
  const view =
    state.mode === 'input'
      ? inputView()
      : state.mode === 'preview'
        ? previewView()
        : state.mode === 'running'
          ? runningView()
          : state.mode === 'preflight'
            ? preflightView()
            : resultView();
  app.replaceChildren(view);
}
function act(target: HTMLElement): void {
  if (target.dataset.action === 'label' && target.dataset.label)
    binding({ type: 'label', label: target.dataset.label });
  if (
    target.dataset.action === 'cell' &&
    target.dataset.label &&
    target.dataset.index
  )
    binding({
      type: 'label',
      label: target.dataset.label,
      row: Number(target.dataset.index),
    });
  if (target.dataset.action === 'index' && target.dataset.index)
    binding({
      type: 'index',
      index: { type: 'specific', value: Number(target.dataset.index) },
    });
}
function events(): void {
  const app = document.getElementById('app');
  if (!app) return;
  app.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>(
      '[id],[data-action],[data-worksheet],[data-layer-id]',
    );
    if (!target) return;
    if (target.dataset.action) {
      act(target);
      return;
    }
    if (target.dataset.layerId) {
      send({
        type: 'SELECT_LAYER',
        payload: { layerId: target.dataset.layerId },
      });
      return;
    }
    if (target.dataset.worksheet && target.id !== 'bind-worksheet-btn') {
      state.browsing = target.dataset.worksheet;
      state.rowPage = state.colPage = 0;
      render();
      return;
    }
    switch (target.id) {
      case 'fetch-btn':
        fetchStart(false);
        break;
      case 'sync-btn':
        fetchStart(true);
        break;
      case 'sync-preview-btn':
        syncStart();
        break;
      case 'refresh-btn':
        fetchStart(false);
        break;
      case 'cancel-sync-btn':
        if (state.active) {
          state.active.controller.abort();
          send({ type: 'CANCEL_SYNC', runId: state.active.id });
          state.progress.message = 'Cancelling…';
          render();
        }
        break;
      case 'apply-btn':
        apply();
        break;
      case 'preflight-back-btn':
        if (state.active) {
          state.active.controller.abort();
          send({ type: 'CANCEL_SYNC', runId: state.active.id });
        }
        state.mode = 'preview';
        finish(state.active?.id || '');
        render();
        break;
      case 'retry-btn':
        retry();
        break;
      case 'back-btn':
        state.mode = 'input';
        resize(720, 360);
        render();
        break;
      case 'result-back-btn':
        state.mode = 'preview';
        render();
        break;
      case 'preview-settings-btn':
        openPreviewSettings();
        break;
      case 'bind-worksheet-btn':
        if (target.dataset.worksheet)
          binding({ type: 'worksheet', worksheet: target.dataset.worksheet });
        break;
      case 'row-prev-btn':
        state.rowPage--;
        render();
        break;
      case 'row-next-btn':
        state.rowPage++;
        render();
        break;
      case 'column-prev-btn':
        state.colPage--;
        render();
        break;
      case 'column-next-btn':
        state.colPage++;
        render();
        break;
    }
  });
  app.addEventListener('change', (e) => {
    const target = e.target as HTMLInputElement | HTMLSelectElement;
    if (target.id === 'sheets-url') state.url = target.value;
  });
  app.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement;
    const actionTarget = target.closest<HTMLElement>('[data-action]');
    if (actionTarget && ['Enter', ' '].includes(e.key)) {
      e.preventDefault();
      act(actionTarget);
    }
    if (e.key === 'Enter' && target.id === 'sheets-url') fetchStart(true);
    const tab = target.closest<HTMLElement>('[role="tab"]');
    if (tab && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
      const tabs = Array.from(
        app.querySelectorAll<HTMLElement>('[role="tab"]'),
      );
      const current = tabs.indexOf(tab);
      const next =
        e.key === 'Home'
          ? 0
          : e.key === 'End'
            ? tabs.length - 1
            : Math.max(
                0,
                Math.min(
                  tabs.length - 1,
                  current + (e.key === 'ArrowLeft' ? -1 : 1),
                ),
              );
      e.preventDefault();
      tabs[next]?.click();
      tabs[next]?.focus();
    }
  });
}
function init(): void {
  window.addEventListener('message', (event) => {
    const candidate: unknown = event.data?.pluginMessage;
    if (!isPluginMessage(candidate)) return;
    if (candidate.type === 'RESYNC_MODE') receiveResync(candidate);
    else receive(candidate);
  });
  events();
  render();
  send({ type: 'UI_READY' });
}
if (document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', init);
else init();
