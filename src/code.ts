/** Main Figma thread: document authority and operation lifecycle. Network work stays in UI. */
import type { UIMessage } from './messages';
import { isUIMessage, sendToUI } from './messages';
import type {
  ClientSettings, DocumentSyncConfig, InterpretationPreferences, LayerOutcome, OperationResult,
  SheetSnapshot, SyncScope,
} from './core/types';
import { SyncOrchestrator } from './core/sync-orchestrator';
import { StalePreflightError, type PendingImageRequest, type PreparedSync } from './core/sync-engine';
import { captureScopeRoots, type ScopeRoots } from './core/traversal';
import { configRoots, createDocumentConfig, loadDocumentConfig, saveDocumentConfig } from './core/document-config';
import { reorientSheetData } from './core/sheet-structure';
import { updateLayerBinding } from './core/parser';
import { resetGlobalFontCache } from './core/performance';
import { parseGoogleSheetsUrlForMain, validateWorkerUrl } from './utils/url';

const PLUGIN_WIDTH = 720;
const PLUGIN_HEIGHT = 320;
const RESYNC_HEIGHT = 130;
const SETTINGS_KEY = 'settings';
const LEGACY_URL_KEY = 'lastUrl';
const DEFAULT_SETTINGS: ClientSettings = {
  workerUrl: 'https://sheets-proxy.spidleweb.workers.dev',
  allowThirdPartyFallback: false,
};

function normalizeWorkerUrl(value: string): string {
  const result = validateWorkerUrl(value);
  if (!result.isValid) throw new Error(result.errorMessage || 'Invalid Worker URL.');
  return result.normalizedUrl ?? '';
}

type RunPhase = 'fetching' | 'preflight' | 'applying' | 'images';
type RunMode = 'preview' | 'sync' | 'resync' | 'retry';

interface Run {
  id: string;
  snapshotId: string;
  sourceUrl: string;
  spreadsheetId: string;
  roots?: ScopeRoots;
  preferences: InterpretationPreferences;
  mode: RunMode;
  phase: RunPhase;
  signal: { aborted: boolean };
  plan?: PreparedSync;
  outcomes: LayerOutcome[];
  warnings: string[];
  fatalError?: string;
  enteredApply: boolean;
  pendingImages: Map<string, PendingImageRequest>;
  inFlightImageIds: Set<string>;
  previous?: CompletedRun;
}

interface CompletedRun {
  plan: PreparedSync;
  result: OperationResult;
}

const orchestrator = new SyncOrchestrator();
let activeRun: Run | null = null;
let cachedSnapshot: SheetSnapshot | null = null;
let completedRun: CompletedRun | null = null;
let resyncConfig: DocumentSyncConfig | null = null;
let resyncStarted = false;
let nextId = 0;
const usedRunIds = new Set<string>();
let selectionTimer: ReturnType<typeof setTimeout> | null = null;

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${++nextId}`;
}

function isCurrent(run: Run): boolean {
  return activeRun === run && !run.signal.aborted;
}

function sendError(runId: string, message: string, recoverable = true): void {
  sendToUI({ type: 'ERROR', runId, payload: { message, recoverable } });
}

function rejectOverlap(runId: string): boolean {
  if (usedRunIds.has(runId)) {
    sendError(runId, 'This operation ID has already been used. Start a new operation.');
    return true;
  }
  if (!activeRun) return false;
  sendError(runId, 'Another sync is still running. Wait for it to finish or cancel it.');
  return true;
}

function createRun(
  runId: string, sourceUrl: string, spreadsheetId: string,
  mode: RunMode, preferences: InterpretationPreferences, roots?: ScopeRoots,
  snapshotId = newId('snapshot')
): Run {
  return {
    id: runId, snapshotId, sourceUrl, spreadsheetId, mode, preferences,
    roots, phase: 'fetching', signal: { aborted: false }, outcomes: [], warnings: [], enteredApply: false,
    pendingImages: new Map(),
    inFlightImageIds: new Set(),
  };
}

function beginFetch(
  runId: string, url: string, mode: RunMode,
  preferences: InterpretationPreferences, scope?: SyncScope
): void {
  if (rejectOverlap(runId)) return;
  const parsed = parseGoogleSheetsUrlForMain(url);
  if (!parsed.isValid) {
    sendError(runId, parsed.errorMessage || 'Invalid spreadsheet URL.', false);
    return;
  }
  const roots = scope ? captureScopeRoots(scope) : undefined;
  const run = createRun(runId, url.trim(), parsed.spreadsheetId, mode, preferences, roots);
  usedRunIds.add(runId);
  activeRun = run;
  sendToUI({ type: 'PROGRESS', runId, payload: { message: 'Fetching worksheet data...', progress: 0 } });
  sendToUI({ type: 'REQUEST_SHEET_FETCH', runId, payload: {
    url: run.sourceUrl, snapshotId: run.snapshotId, preferences,
  } });
}

function snapshotFor(run: Run, data: SheetSnapshot['data'], fetchedAt: number): SheetSnapshot {
  const interpreted = reorientSheetData(data, run.preferences);
  return {
    id: run.snapshotId,
    sourceUrl: run.sourceUrl,
    spreadsheetId: run.spreadsheetId,
    fetchedAt,
    data: interpreted,
    preferences: {
      orientations: { ...run.preferences.orientations },
      blankText: run.preferences.blankText,
      ...(run.preferences.defaultWorksheet ? { defaultWorksheet: run.preferences.defaultWorksheet } : {}),
    },
  };
}

async function acceptSheetData(runId: string, data: SheetSnapshot['data'], fetchedAt: number): Promise<void> {
  const run = activeRun;
  if (!run || run.id !== runId || run.phase !== 'fetching' || !isCurrent(run)) return;
  const snapshot = snapshotFor(run, data, fetchedAt);
  cachedSnapshot = snapshot;
  sendToUI({ type: 'FETCH_SUCCESS', runId, payload: { snapshot } });
  if (run.mode === 'preview') {
    activeRun = null;
    return;
  }
  await buildPreflight(run, snapshot);
}

async function beginSync(
  runId: string, scope: SyncScope, snapshotId: string, preferences: InterpretationPreferences
): Promise<void> {
  if (rejectOverlap(runId)) return;
  if (!cachedSnapshot || cachedSnapshot.id !== snapshotId) {
    sendError(runId, 'The preview is no longer current. Refresh the sheet before syncing.');
    return;
  }
  const run = createRun(runId, cachedSnapshot.sourceUrl, cachedSnapshot.spreadsheetId,
    'sync', preferences, captureScopeRoots(scope), cachedSnapshot.id);
  usedRunIds.add(runId);
  activeRun = run;
  const snapshot = snapshotFor(run, cachedSnapshot.data, cachedSnapshot.fetchedAt);
  await buildPreflight(run, snapshot, true);
}

async function buildPreflight(run: Run, snapshot: SheetSnapshot, forceReview = false, attempt = 0): Promise<void> {
  if (!run.roots || !isCurrent(run)) return;
  run.phase = 'preflight';
  try {
    const plan = await orchestrator.prepare({
      snapshot, roots: run.roots, preferences: run.preferences, signal: run.signal,
      onProgress: (message, progress) => {
        if (isCurrent(run)) sendToUI({ type: 'PROGRESS', runId: run.id, payload: { message, progress } });
      },
    });
    if (!isCurrent(run)) return;
    run.plan = plan;
    if (forceReview) plan.summary.requiresConfirmation = true;
    if (plan.summary.requiresConfirmation) {
      sendToUI({ type: 'PREFLIGHT', runId: run.id, payload: plan.summary });
    } else {
      await applyRun(run, []);
    }
  } catch (error) {
    if (run.signal.aborted) return;
    if (attempt === 0 && error instanceof Error &&
      error.message === 'The document changed during preflight. Refresh the proposed changes.') {
      await buildPreflight(run, snapshot, true, 1);
      return;
    }
    failRun(run, error);
  }
}

async function applyRun(run: Run, excludedIssueIds: string[], retryBindingIds?: ReadonlySet<string>): Promise<void> {
  if (!run.plan || !isCurrent(run)) return;
  run.phase = 'applying';
  run.enteredApply = true;
  try {
    const applied = await orchestrator.apply(run.plan, excludedIssueIds, run.signal,
      (message, progress) => {
        if (isCurrent(run)) sendToUI({ type: 'PROGRESS', runId: run.id, payload: { message, progress } });
      }, retryBindingIds);
    if (activeRun !== run) return;
    run.outcomes = applied.outcomes;
    run.warnings.push(...applied.warnings);
    run.fatalError = applied.fatalError;
    if (run.signal.aborted || applied.cancelled) {
      for (const pending of applied.pendingImages) run.outcomes.push(imageOutcome(pending, 'skipped', 'Cancelled before image fetch.'));
      await finishRun(run, true);
      return;
    }
    if (applied.pendingImages.length === 0) {
      await finishRun(run);
      return;
    }
    run.phase = 'images';
    for (const request of applied.pendingImages) {
      if (!request.requestId) continue;
      run.pendingImages.set(request.requestId, request);
      sendToUI({ type: 'REQUEST_IMAGE_FETCH', runId: run.id, payload: {
        requestId: request.requestId, nodeId: request.nodeId, url: request.url,
      } });
    }
    sendToUI({ type: 'PROGRESS', runId: run.id, payload: {
      message: `Loading ${run.pendingImages.size} image(s)...`, progress: 85,
    } });
  } catch (error) {
    if (run.signal.aborted) {
      await finishRun(run, true);
      return;
    }
    if (error instanceof StalePreflightError && run.plan) {
      await buildPreflight(run, run.plan.snapshot, true);
      return;
    }
    failRun(run, error);
  }
}

function imageOutcome(request: PendingImageRequest, status: LayerOutcome['status'], message?: string): LayerOutcome {
  return {
    bindingId: request.bindingId || request.requestId || request.nodeId,
    layerId: request.nodeId, layerName: request.layerName || request.nodeId, status,
    worksheet: request.worksheet, label: request.label, resolvedRow: request.resolvedRow,
    ...(message ? { message } : {}),
  };
}

async function acceptImage(
  runId: string, requestId: string, nodeId: string, url: string,
  data?: Uint8Array, error?: string
): Promise<void> {
  const run = activeRun;
  if (!run || run.id !== runId || run.phase !== 'images' || run.signal.aborted) return;
  const request = run.pendingImages.get(requestId);
  if (!request || run.inFlightImageIds.has(requestId) || request.nodeId !== nodeId || request.url !== url) return;
  // Reserve before awaiting a host call; keep the request pending until its outcome settles.
  run.inFlightImageIds.add(requestId);
  let outcome: LayerOutcome;
  if (error) {
    outcome = imageOutcome(request, 'failed', error);
  } else if (!data) {
    outcome = imageOutcome(request, 'failed', 'Image response contained no data.');
  } else {
    outcome = await orchestrator.applyPendingImage(request, data, run.signal);
  }
  if (activeRun !== run) return;
  run.pendingImages.delete(requestId);
  run.inFlightImageIds.delete(requestId);
  run.outcomes.push(outcome);
  sendToUI({ type: 'IMAGE_ACK', runId, payload: {
    requestId, nodeId, status: outcome.status,
  } });
  if (run.pendingImages.size === 0) await finishRun(run);
}

function emptyResult(run: Run, status: 'failed' | 'cancelled', message?: string): OperationResult {
  return {
    status, snapshotId: run.snapshotId, counts: { changed: 0, unchanged: 0, skipped: 0, failed: 0 },
    outcomes: [], success: false, cancelled: status === 'cancelled',
    layersProcessed: 0, layersUpdated: 0,
    errors: message ? [{ layerId: '', layerName: '', error: message }] : [], warnings: [],
  };
}

function finishRun(run: Run, cancelled = false): void {
  if (activeRun !== run) return;
  const plan = run.plan;
  let result: OperationResult;
  if (!plan) {
    result = emptyResult(run, cancelled ? 'cancelled' : 'failed', run.fatalError);
  } else {
    let outcomes = run.outcomes;
    if (run.previous) {
      const merged = new Map(run.previous.result.outcomes.map((outcome) => [outcome.bindingId, outcome]));
      for (const outcome of outcomes) merged.set(outcome.bindingId, outcome);
      outcomes = [...merged.values()];
    }
    result = orchestrator.finalize(plan, outcomes, run.warnings, cancelled, run.fatalError);
  }
  if (!cancelled && plan && (result.status === 'success' || result.status === 'partial') && isCurrent(run)) {
    try {
      const config = createDocumentConfig(plan.snapshot, run.roots!, plan.summary.defaultWorksheet, run.preferences);
      saveDocumentConfig(config);
      void figma.clientStorage.setAsync(LEGACY_URL_KEY, config.sourceUrl).catch(() => {
        console.warn('Recent URL suggestion could not be stored.');
      });
    } catch (error) {
      result.warnings.push(`Sync completed, but document settings could not be saved: ${error instanceof Error ? error.message : String(error)}`);
      result.status = 'partial';
    }
  }
  if (run.enteredApply) {
    try {
      figma.commitUndo();
    } catch (error) {
      result.warnings.push(`Undo history could not be committed: ${error instanceof Error ? error.message : String(error)}`);
      if (result.status === 'success') result.status = 'partial';
    }
  }
  if (plan && !cancelled) completedRun = { plan, result };
  sendToUI({ type: 'SYNC_COMPLETE', runId: run.id, payload: result });
  activeRun = null;
  if (run.mode === 'resync' && result.status === 'success' && result.counts.skipped === 0 &&
    result.warnings.length === 0) figma.closePlugin();
}

function failRun(run: Run, error: unknown): void {
  if (activeRun !== run) return;
  run.fatalError = error instanceof Error ? error.message : String(error);
  for (const request of run.pendingImages.values()) {
    run.outcomes.push(imageOutcome(request, 'skipped', 'Operation stopped before image completion.'));
  }
  run.pendingImages.clear();
  run.inFlightImageIds.clear();
  finishRun(run);
}

async function cancelRun(runId: string): Promise<void> {
  const run = activeRun;
  if (!run || run.id !== runId || run.signal.aborted) return;
  run.signal.aborted = true;
  sendToUI({ type: 'CANCEL_FETCH', runId });
  if (run.phase === 'fetching' || run.phase === 'preflight') {
    await finishRun(run, true);
  } else if (run.phase === 'images') {
    for (const pending of run.pendingImages.values()) {
      run.outcomes.push(imageOutcome(pending, 'skipped', 'Cancelled while loading image.'));
    }
    run.pendingImages.clear();
    run.inFlightImageIds.clear();
    await finishRun(run, true);
  }
}

async function beginRetry(runId: string, snapshotId: string): Promise<void> {
  if (rejectOverlap(runId)) return;
  const previous = completedRun;
  if (!previous || previous.plan.snapshot.id !== snapshotId) {
    sendError(runId, 'The failed values are no longer available. Refresh to start a new run.');
    return;
  }
  const bindingIds = new Set(previous.plan.bindings.map((entry) => entry.bindingId));
  const failed = new Set(previous.result.outcomes.filter((outcome) =>
    outcome.status === 'failed' && bindingIds.has(outcome.bindingId)).map((outcome) => outcome.bindingId));
  if (failed.size === 0) {
    sendError(runId, 'No failed layers are available to retry.');
    return;
  }
  const plan = previous.plan;
  const run = createRun(runId, plan.snapshot.sourceUrl, plan.snapshot.spreadsheetId,
    'retry', plan.preferences, plan.roots, plan.snapshot.id);
  usedRunIds.add(runId);
  run.previous = previous;
  run.plan = plan;
  run.phase = 'applying';
  activeRun = run;
  resetGlobalFontCache();
  await applyRun(run, [], failed);
}

async function loadSettings(): Promise<ClientSettings> {
  const stored = await figma.clientStorage.getAsync(SETTINGS_KEY);
  if (!stored || typeof stored !== 'object') return DEFAULT_SETTINGS;
  const value = stored as Partial<ClientSettings>;
  if (typeof value.workerUrl !== 'string' || typeof value.allowThirdPartyFallback !== 'boolean') return DEFAULT_SETTINGS;
  try {
    return { workerUrl: normalizeWorkerUrl(value.workerUrl), allowThirdPartyFallback: value.allowThirdPartyFallback };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

async function handleUIReady(): Promise<void> {
  const lastUrl = await figma.clientStorage.getAsync(LEGACY_URL_KEY);
  const settings = await loadSettings();
  const config = loadDocumentConfig();
  sendToUI({ type: 'INIT', payload: {
    hasSelection: figma.currentPage.selection.length > 0,
    ...(typeof lastUrl === 'string' ? { lastUrl } : {}),
    ...(config ? { config } : {}),
    settings,
  } });
  if (resyncConfig && !resyncStarted) {
    resyncStarted = true;
    const runId = newId('resync');
    const run = createRun(runId, resyncConfig.sourceUrl, resyncConfig.spreadsheetId,
      'resync', { ...resyncConfig.preferences, defaultWorksheet: resyncConfig.defaultWorksheet },
      configRoots(resyncConfig));
    usedRunIds.add(runId);
    activeRun = run;
    sendToUI({ type: 'RESYNC_MODE', runId, payload: { config: resyncConfig } });
    sendToUI({ type: 'REQUEST_SHEET_FETCH', runId, payload: {
      url: run.sourceUrl, snapshotId: run.snapshotId, preferences: run.preferences,
    } });
  }
}

async function handleMessage(message: UIMessage): Promise<void> {
  switch (message.type) {
    case 'UI_READY':
      await handleUIReady();
      break;
    case 'FETCH':
      beginFetch(message.runId, message.payload.url, 'preview', message.payload.preferences);
      break;
    case 'FETCH_AND_SYNC':
      beginFetch(message.runId, message.payload.url, 'sync', message.payload.preferences, message.payload.scope);
      break;
    case 'SHEET_DATA':
      await acceptSheetData(message.runId, message.payload.data, message.payload.fetchedAt);
      break;
    case 'FETCH_ERROR': {
      const run = activeRun;
      if (!run || run.id !== message.runId || run.phase !== 'fetching') break;
      if (run.mode === 'preview') activeRun = null;
      else failRun(run, new Error(message.payload.error));
      if (run.mode === 'preview') sendError(run.id, message.payload.error, true);
      break;
    }
    case 'SYNC':
      await beginSync(message.runId, message.payload.scope, message.payload.snapshotId, message.payload.preferences);
      break;
    case 'APPLY': {
      const run = activeRun;
      if (!run || run.id !== message.runId || run.phase !== 'preflight' || !run.plan ||
        run.plan.snapshot.id !== message.payload.snapshotId ||
        run.plan.summary.preflightId !== message.payload.preflightId) break;
      const issueIds = new Set(run.plan.summary.issues.map((entry) => entry.id));
      if (message.payload.excludedIssueIds.some((id) => !issueIds.has(id))) {
        sendError(run.id, 'Preflight changed. Review the current issues before applying.');
        break;
      }
      await applyRun(run, message.payload.excludedIssueIds);
      break;
    }
    case 'RETRY_FAILED':
      await beginRetry(message.runId, message.payload.snapshotId);
      break;
    case 'CANCEL_SYNC':
      await cancelRun(message.runId);
      break;
    case 'IMAGE_DATA':
      await acceptImage(message.runId, message.payload.requestId, message.payload.nodeId,
        message.payload.url, message.payload.data);
      break;
    case 'IMAGE_FETCH_ERROR':
      await acceptImage(message.runId, message.payload.requestId, message.payload.nodeId,
        message.payload.url, undefined, message.payload.error);
      break;
    case 'RENAME_SELECTION': {
      if (activeRun) {
        figma.notify('Finish or cancel the current sync before editing layer bindings.', { error: true });
        break;
      }
      const selected = figma.currentPage.selection;
      for (const node of selected) node.name = updateLayerBinding(node.name, message.payload.action);
      figma.notify(`Updated ${selected.length} layer binding(s).`);
      break;
    }
    case 'SELECT_LAYER': {
      const node = await figma.getNodeByIdAsync(message.payload.layerId);
      if (node && node.type !== 'PAGE' && node.type !== 'DOCUMENT') {
        let parent = node.parent;
        while (parent && parent.type !== 'PAGE') parent = parent.parent;
        if (parent?.type === 'PAGE') {
          if (parent.id !== figma.currentPage.id) await figma.setCurrentPageAsync(parent as PageNode);
          figma.currentPage.selection = [node as SceneNode];
        }
      }
      break;
    }
    case 'SAVE_SETTINGS': {
      try {
        const workerUrl = normalizeWorkerUrl(message.payload.settings.workerUrl);
        const settings = { ...message.payload.settings, workerUrl };
        await figma.clientStorage.setAsync(SETTINGS_KEY, settings);
        sendToUI({ type: 'SETTINGS_SAVED', payload: { settings } });
      } catch (error) {
        sendToUI({ type: 'SETTINGS_ERROR', payload: {
          message: error instanceof Error ? error.message : String(error),
        } });
      }
      break;
    }
    case 'RESIZE_WINDOW':
      figma.ui.resize(message.payload.width, message.payload.height);
      break;
  }
}

function setup(): void {
  figma.ui.onmessage = async (unknownMessage: unknown) => {
    if (!isUIMessage(unknownMessage)) return;
    try {
      await handleMessage(unknownMessage);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (activeRun) failRun(activeRun, error);
      else figma.notify(message, { error: true });
    }
  };
  figma.on('selectionchange', () => {
    if (selectionTimer) clearTimeout(selectionTimer);
    selectionTimer = setTimeout(() => {
      sendToUI({ type: 'SELECTION_CHANGED', payload: {
        hasSelection: figma.currentPage.selection.length > 0,
      } });
      selectionTimer = null;
    }, 100);
  });
}

async function main(): Promise<void> {
  resyncConfig = figma.command === 'resync' ? loadDocumentConfig() : null;
  figma.showUI(__html__, {
    width: PLUGIN_WIDTH,
    height: resyncConfig ? RESYNC_HEIGHT : PLUGIN_HEIGHT,
    themeColors: true,
  });
  setup();
  if (figma.command === 'resync' && !resyncConfig) {
    figma.notify('This file has no completed sync configuration. Choose a source and scope to sync.');
  }
}

main().catch((error) => {
  figma.notify(error instanceof Error ? error.message : String(error), { error: true });
});
