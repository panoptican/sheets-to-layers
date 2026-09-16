import {
  isPluginMessage,
  sendToPlugin as send,
  type PluginMessage,
} from '../messages';
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
import { fetchSheet, fetchImage, finishImageRequests } from './transport';
type Mode = 'input' | 'preview' | 'running' | 'preflight' | 'result';
type Kind = 'fetch' | 'fetch-and-sync' | 'sync' | 'retry' | 'resync';
type Active = { id: string; kind: Kind; controller: AbortController };
export type UIState = {
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
export const state: UIState = {
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

export function copyPrefs(
  p: InterpretationPreferences,
): InterpretationPreferences {
  return {
    orientations: { ...p.orientations },
    blankText: p.blankText,
    ...(p.defaultWorksheet ? { defaultWorksheet: p.defaultWorksheet } : {}),
  };
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
  finishImageRequests(run);
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
export function worksheet(): Worksheet | null {
  return state.data?.worksheets.find((w) => w.name === state.browsing) || null;
}
export function defaultWorksheet(): string {
  return (
    state.preferences.defaultWorksheet || state.data?.activeWorksheet || ''
  );
}

function receive(message: PluginMessage): void {
  if (message.type === 'INIT') {
    state.hasSelection = message.payload.hasSelection;
    if (message.payload.config) applyConfig(message.payload.config);
    else state.url = message.payload.lastUrl || '';
    notify();
    return;
  }
  if (message.type === 'SELECTION_CHANGED') {
    state.hasSelection = message.payload.hasSelection;
    notify();
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
    if (state.active)
      void fetchSheet(state.active, message.payload.url, () =>
        active(message.runId),
      );
    return;
  }
  if (message.type === 'REQUEST_IMAGE_FETCH') {
    if (state.active)
      void fetchImage(state.active, message.payload, () =>
        active(message.runId),
      );
    return;
  }
  if (message.type === 'FETCH_SUCCESS') {
    setSnapshot(message.payload.snapshot);
    state.mode = state.active?.kind === 'fetch' ? 'preview' : 'running';
    resize(
      state.mode === 'preview' ? 960 : 720,
      state.mode === 'preview' ? 600 : 360,
    );
    notify();
    return;
  }
  if (message.type === 'PREFLIGHT') {
    if (state.preflight?.preflightId !== message.payload.preflightId)
      state.excluded.clear();
    state.preflight = message.payload;
    state.mode = 'preflight';
    resize(960, 600);
    notify();
    return;
  }
  if (message.type === 'PROGRESS') {
    state.progress = {
      value: message.payload.progress,
      message: message.payload.message,
    };
    notify();
    return;
  }
  if (message.type === 'ERROR') {
    state.error = message.payload.message;
    state.mode = state.snapshot ? 'preview' : 'input';
    finish(message.runId);
    notify();
    return;
  }
  if (message.type === 'SYNC_COMPLETE') {
    state.result = message.payload;
    state.mode = 'result';
    finish(message.runId);
    notify();
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
  notify();
}

export function fetchStart(andSync: boolean): void {
  if (!state.url.trim()) {
    state.error = 'Enter a Google Sheets URL.';
    notify();
    return;
  }
  const operation = begin(andSync ? 'fetch-and-sync' : 'fetch');
  state.mode = 'running';
  notify();
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
export function syncStart(): void {
  if (!state.snapshot) return;
  const operation = begin('sync');
  state.mode = 'running';
  notify();
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
export function apply(): void {
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
  notify();
}
export function retry(): void {
  if (!state.result) return;
  const operation = begin('retry');
  state.mode = 'running';
  notify();
  send({
    type: 'RETRY_FAILED',
    runId: operation.id,
    payload: { snapshotId: state.result.snapshotId },
  });
}
export function binding(action: BindingAction): void {
  send({ type: 'RENAME_SELECTION', payload: { action } });
}

export function openPreviewSettings(): void {
  state.previewSettings = copyPrefs(state.preferences);
  notify();
}
export function closePreviewSettings(): void {
  state.previewSettings = null;
  notify();
}
export function savePreviewSettings(
  nextPreferences = state.previewSettings,
): void {
  if (!nextPreferences) return;
  const review = state.mode === 'preflight' ? state.preflight : null;
  const operation = state.mode === 'preflight' ? state.active : null;
  state.preferences = copyPrefs(nextPreferences);
  state.previewSettings = null;
  recompute();
  if (review && operation) {
    state.mode = 'running';
    state.progress = { value: 0, message: 'Updating review…' };
    notify();
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
  notify();
}

const subscribers = new Set<() => void>();
function notify(): void {
  for (const subscriber of subscribers) subscriber();
}
export function subscribe(listener: () => void): () => void {
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
}
export function connect(): () => void {
  const receiveMessage = (event: MessageEvent) => {
    const candidate: unknown = event.data?.pluginMessage;
    if (!isPluginMessage(candidate)) return;
    if (candidate.type === 'RESYNC_MODE') receiveResync(candidate);
    else receive(candidate);
  };
  window.addEventListener('message', receiveMessage);
  send({ type: 'UI_READY' });
  return () => window.removeEventListener('message', receiveMessage);
}
export function setUrl(url: string): void {
  state.url = url;
  notify();
}
export function setScope(scope: SyncScope): void {
  state.scope = scope;
  notify();
}
export function browse(name: string): void {
  state.browsing = name;
  state.rowPage = state.colPage = 0;
  notify();
}
export function changePage(kind: 'row' | 'column', page: number): void {
  if (kind === 'row') state.rowPage = page;
  else state.colPage = page;
  notify();
}
export function excludeIssue(id: string, excluded: boolean): void {
  if (excluded) state.excluded.add(id);
  else state.excluded.delete(id);
  notify();
}
export function cancel(): void {
  if (!state.active) return;
  state.active.controller.abort();
  send({ type: 'CANCEL_SYNC', runId: state.active.id });
  state.progress.message = 'Cancelling…';
  notify();
}
export function backFromReview(): void {
  cancel();
  finish(state.active?.id || '');
  backToPreview();
}
export function backToPreview(): void {
  state.mode = 'preview';
  notify();
}
export function backToInput(): void {
  state.mode = 'input';
  resize(720, 360);
  notify();
}
export function selectLayer(layerId: string): void {
  send({ type: 'SELECT_LAYER', payload: { layerId } });
}
