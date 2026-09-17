/** The UI owns network work; the main thread owns run identity and document mutation. */
import type {
  BindingAction,
  DocumentSyncConfig,
  InterpretationPreferences,
  OperationResult,
  PreflightSummary,
  SheetData,
  SheetSnapshot,
  SyncScope,
} from "./core/types";

type Message<T extends string, P> = { type: T; payload: P };
type RunMessage<T extends string, P> = Message<T, P> & { runId: string };

export type FetchMessage = RunMessage<
  "FETCH",
  { url: string; preferences: InterpretationPreferences }
>;
export type FetchAndSyncMessage = RunMessage<
  "FETCH_AND_SYNC",
  { url: string; scope: SyncScope; preferences: InterpretationPreferences }
>;
export type SyncMessage = RunMessage<
  "SYNC",
  {
    scope: SyncScope;
    snapshotId: string;
    preferences: InterpretationPreferences;
  }
>;
export type UpdatePreflightSettingsMessage = RunMessage<
  "UPDATE_PREFLIGHT_SETTINGS",
  {
    snapshotId: string;
    preflightId: string;
    preferences: InterpretationPreferences;
  }
>;
export type ApplyMessage = RunMessage<
  "APPLY",
  { snapshotId: string; preflightId: string; excludedIssueIds: string[] }
>;
export type RetryFailedMessage = RunMessage<
  "RETRY_FAILED",
  { snapshotId: string }
>;
export type CancelSyncMessage = { type: "CANCEL_SYNC"; runId: string };
export type UIReadyMessage = { type: "UI_READY" };
export type RenameSelectionMessage = Message<
  "RENAME_SELECTION",
  { action: BindingAction }
>;
export type SheetDataMessage = RunMessage<
  "SHEET_DATA",
  { data: SheetData; fetchedAt: number }
>;
type ImageIdentity = { requestId: string; nodeId: string; url: string };
export type ImageDataMessage = RunMessage<
  "IMAGE_DATA",
  ImageIdentity & { data: Uint8Array }
>;
export type ImageFetchErrorMessage = RunMessage<
  "IMAGE_FETCH_ERROR",
  ImageIdentity & { error: string }
>;
export type FetchErrorMessage = RunMessage<"FETCH_ERROR", { error: string }>;
export type ResizeWindowMessage = Message<
  "RESIZE_WINDOW",
  { width: number; height: number }
>;
export type SelectLayerMessage = Message<"SELECT_LAYER", { layerId: string }>;

export type UIMessage =
  | FetchMessage
  | FetchAndSyncMessage
  | SyncMessage
  | UpdatePreflightSettingsMessage
  | ApplyMessage
  | RetryFailedMessage
  | CancelSyncMessage
  | UIReadyMessage
  | RenameSelectionMessage
  | SheetDataMessage
  | ImageDataMessage
  | ImageFetchErrorMessage
  | FetchErrorMessage
  | ResizeWindowMessage
  | SelectLayerMessage;

export type InitMessage = Message<
  "INIT",
  {
    hasSelection: boolean;
    lastUrl?: string;
    config?: DocumentSyncConfig;
  }
>;
export type SelectionChangedMessage = Message<
  "SELECTION_CHANGED",
  { hasSelection: boolean }
>;
export type FetchSuccessMessage = RunMessage<
  "FETCH_SUCCESS",
  { snapshot: SheetSnapshot }
>;
export type PreflightMessage = RunMessage<"PREFLIGHT", PreflightSummary>;
export type SyncCompleteMessage = RunMessage<"SYNC_COMPLETE", OperationResult>;
export type ProgressMessage = RunMessage<
  "PROGRESS",
  { message: string; progress: number }
>;
export type ErrorMessage = RunMessage<
  "ERROR",
  { message: string; recoverable: boolean }
>;
export type ResyncModeMessage = RunMessage<
  "RESYNC_MODE",
  { config: DocumentSyncConfig }
>;
export type RequestImageFetchMessage = RunMessage<
  "REQUEST_IMAGE_FETCH",
  ImageIdentity
>;
export type RequestSheetFetchMessage = RunMessage<
  "REQUEST_SHEET_FETCH",
  { url: string; snapshotId: string; preferences: InterpretationPreferences }
>;
export type CancelFetchMessage = { type: "CANCEL_FETCH"; runId: string };
export type ImageAcknowledgementMessage = RunMessage<
  "IMAGE_ACK",
  {
    requestId: string;
    nodeId: string;
    status: "changed" | "unchanged" | "skipped" | "failed";
  }
>;
export type PluginMessage =
  | InitMessage
  | SelectionChangedMessage
  | FetchSuccessMessage
  | PreflightMessage
  | SyncCompleteMessage
  | ProgressMessage
  | ErrorMessage
  | ResyncModeMessage
  | RequestImageFetchMessage
  | RequestSheetFetchMessage
  | CancelFetchMessage
  | ImageAcknowledgementMessage;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isString(value: unknown): value is string {
  return typeof value === "string";
}
function isId(value: unknown): value is string {
  return isString(value) && value.length > 0 && value.length <= 16384;
}
function isRunId(value: unknown): value is string {
  return isId(value) && value.length <= 256;
}
function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
function isCount(value: unknown): value is number {
  return isNumber(value) && Number.isInteger(value) && value >= 0;
}
function isStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}
function isSyncScope(value: unknown): value is SyncScope {
  return value === "document" || value === "page" || value === "selection";
}

export function isInterpretationPreferences(
  value: unknown,
): value is InterpretationPreferences {
  return (
    isRecord(value) &&
    isRecord(value.orientations) &&
    Object.keys(value.orientations).every(
      (key) => !["__proto__", "constructor", "prototype"].includes(key),
    ) &&
    Object.values(value.orientations).every(
      (v) => v === "columns" || v === "rows",
    ) &&
    (value.blankText === "clear-and-hide" ||
      value.blankText === "leave-unchanged") &&
    (value.defaultWorksheet === undefined || isString(value.defaultWorksheet))
  );
}
export function isDocumentSyncConfig(
  value: unknown,
): value is DocumentSyncConfig {
  return (
    isRecord(value) &&
    value.version === 1 &&
    isString(value.sourceUrl) &&
    isId(value.spreadsheetId) &&
    isString(value.defaultWorksheet) &&
    isSyncScope(value.scope) &&
    isStrings(value.rootIds) &&
    value.rootIds.length > 0 &&
    value.rootIds.every(isId) &&
    new Set(value.rootIds).size === value.rootIds.length &&
    (value.pageId === undefined || isId(value.pageId)) &&
    (value.scope !== "page" ||
      (isId(value.pageId) &&
        value.rootIds.length === 1 &&
        value.rootIds[0] === value.pageId)) &&
    isInterpretationPreferences(value.preferences) &&
    isCount(value.completedAt)
  );
}
function isDiagnostics(value: unknown): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.every(
        (d) =>
          isRecord(d) &&
          [
            "duplicate-header",
            "normalized-header-collision",
            "missing-worksheet",
            "limit-exceeded",
            "empty-data",
          ].includes(String(d.code)) &&
          isString(d.message) &&
          (d.severity === "warning" || d.severity === "error") &&
          (d.worksheet === undefined || isString(d.worksheet)) &&
          (d.labels === undefined || isStrings(d.labels)),
      ))
  );
}
export function isSheetData(value: unknown): value is SheetData {
  if (
    !isRecord(value) ||
    !isString(value.activeWorksheet) ||
    !Array.isArray(value.worksheets) ||
    value.worksheets.length > 200 ||
    !isDiagnostics(value.diagnostics)
  )
    return false;
  let cells = 0;
  let rawCells = 0;
  return value.worksheets.every((ws) => {
    if (
      !isRecord(ws) ||
      !isString(ws.name) ||
      !isStrings(ws.labels) ||
      !isRecord(ws.rows) ||
      (ws.orientation !== "columns" && ws.orientation !== "rows") ||
      (ws.id !== undefined && !isString(ws.id)) ||
      !isDiagnostics(ws.diagnostics)
    )
      return false;
    let worksheetCells = ws.labels.length;
    let worksheetRawCells = 0;
    cells += worksheetCells;
    if (worksheetCells > 100000 || cells > 500000) return false;
    if (
      !Object.values(ws.rows).every((column) => {
        if (!isStrings(column)) return false;
        cells += column.length;
        worksheetCells += column.length;
        return worksheetCells <= 100000 && cells <= 500000;
      })
    )
      return false;
    if (
      ws.rawData !== undefined &&
      (!Array.isArray(ws.rawData) ||
        !ws.rawData.every((row) => {
          if (!isStrings(row)) return false;
          rawCells += row.length;
          worksheetRawCells += row.length;
          return worksheetRawCells <= 100000 && rawCells <= 500000;
        }))
    )
      return false;
    if (
      ws.boldInfo !== undefined &&
      (!isRecord(ws.boldInfo) ||
        !Array.isArray(ws.boldInfo.firstRowBold) ||
        !Array.isArray(ws.boldInfo.firstColBold) ||
        !ws.boldInfo.firstRowBold.every((v) => typeof v === "boolean") ||
        !ws.boldInfo.firstColBold.every((v) => typeof v === "boolean"))
    )
      return false;
    return ws.labels.every((label) =>
      Object.prototype.hasOwnProperty.call(ws.rows, label),
    );
  });
}
function isSnapshot(value: unknown): value is SheetSnapshot {
  return (
    isRecord(value) &&
    isId(value.id) &&
    isString(value.sourceUrl) &&
    isId(value.spreadsheetId) &&
    isCount(value.fetchedAt) &&
    isSheetData(value.data) &&
    isInterpretationPreferences(value.preferences)
  );
}
function isAction(value: unknown): value is BindingAction {
  if (!isRecord(value)) return false;
  if (value.type === "label")
    return (
      isString(value.label) &&
      value.label.length > 0 &&
      (value.row === undefined || (isCount(value.row) && value.row > 0))
    );
  if (value.type === "worksheet")
    return isString(value.worksheet) && value.worksheet.length > 0;
  if (value.type !== "index" || !isRecord(value.index)) return false;
  return value.index.type === "specific"
    ? isCount(value.index.value) && value.index.value > 0
    : ["increment", "incrementNonBlank", "random", "randomNonBlank"].includes(
        String(value.index.type),
      );
}
function isImageIdentity(value: Record<string, unknown>): boolean {
  return isId(value.requestId) && isId(value.nodeId) && isString(value.url);
}
function isPreflight(value: unknown): value is PreflightSummary {
  return (
    isRecord(value) &&
    isId(value.preflightId) &&
    isId(value.snapshotId) &&
    isString(value.sourceUrl) &&
    isSyncScope(value.scope) &&
    isStrings(value.rootIds) &&
    isString(value.defaultWorksheet) &&
    isInterpretationPreferences(value.preferences) &&
    isCount(value.totalBindings) &&
    isCount(value.matchedBindings) &&
    typeof value.requiresConfirmation === "boolean" &&
    Array.isArray(value.issues) &&
    value.issues.every(
      (issue) =>
        isRecord(issue) &&
        isId(issue.id) &&
        isString(issue.code) &&
        isString(issue.message) &&
        (issue.severity === "warning" || issue.severity === "error") &&
        typeof issue.blocking === "boolean" &&
        (issue.layerId === undefined || isId(issue.layerId)) &&
        (issue.layerName === undefined || isString(issue.layerName)),
    ) &&
    Array.isArray(value.repeats) &&
    value.repeats.every(
      (repeat) =>
        isRecord(repeat) &&
        isId(repeat.layerId) &&
        isString(repeat.layerName) &&
        (repeat.parentName === undefined || isString(repeat.parentName)) &&
        isString(repeat.worksheet) &&
        isCount(repeat.currentCount) &&
        isCount(repeat.targetCount) &&
        isCount(repeat.additions) &&
        isCount(repeat.removals) &&
        isStrings(repeat.removeIds),
    )
  );
}
function isOperationResult(value: unknown): value is OperationResult {
  if (
    !isRecord(value) ||
    !["success", "partial", "failed", "cancelled"].includes(
      String(value.status),
    ) ||
    !isString(value.snapshotId) ||
    !isRecord(value.counts) ||
    !Array.isArray(value.outcomes) ||
    typeof value.success !== "boolean" ||
    (value.cancelled !== undefined && typeof value.cancelled !== "boolean") ||
    !isCount(value.layersProcessed) ||
    !isCount(value.layersUpdated) ||
    !isStrings(value.warnings) ||
    !Array.isArray(value.errors)
  )
    return false;
  const counts = value.counts;
  return (
    ["changed", "unchanged", "skipped", "failed"].every((key) =>
      isCount(counts[key]),
    ) &&
    value.errors.every(
      (error) =>
        isRecord(error) &&
        isString(error.layerId) &&
        isString(error.layerName) &&
        isString(error.error),
    ) &&
    value.outcomes.every(
      (outcome) =>
        isRecord(outcome) &&
        isId(outcome.bindingId) &&
        isId(outcome.layerId) &&
        isString(outcome.layerName) &&
        ["changed", "unchanged", "skipped", "failed"].includes(
          String(outcome.status),
        ) &&
        (outcome.message === undefined || isString(outcome.message)) &&
        (outcome.worksheet === undefined || isString(outcome.worksheet)) &&
        (outcome.label === undefined || isString(outcome.label)) &&
        (outcome.resolvedRow === undefined ||
          (isCount(outcome.resolvedRow) && outcome.resolvedRow > 0)),
    )
  );
}

export function isUIMessage(msg: unknown): msg is UIMessage {
  if (!isRecord(msg) || !isString(msg.type)) return false;
  const p = isRecord(msg.payload) ? msg.payload : undefined;
  switch (msg.type) {
    case "UI_READY":
      return true;
    case "RENAME_SELECTION":
      return !!p && isAction(p.action);
    case "SELECT_LAYER":
      return !!p && isId(p.layerId);
    case "RESIZE_WINDOW":
      return (
        !!p &&
        isNumber(p.width) &&
        isNumber(p.height) &&
        p.width >= 320 &&
        p.width <= 1600 &&
        p.height >= 100 &&
        p.height <= 1200
      );
    default:
      if (!isRunId(msg.runId)) return false;
  }
  switch (msg.type) {
    case "CANCEL_SYNC":
      return true;
    case "FETCH":
      return (
        !!p && isString(p.url) && isInterpretationPreferences(p.preferences)
      );
    case "FETCH_AND_SYNC":
      return (
        !!p &&
        isString(p.url) &&
        isSyncScope(p.scope) &&
        isInterpretationPreferences(p.preferences)
      );
    case "SYNC":
      return (
        !!p &&
        isSyncScope(p.scope) &&
        isId(p.snapshotId) &&
        isInterpretationPreferences(p.preferences)
      );
    case "UPDATE_PREFLIGHT_SETTINGS":
      return (
        !!p &&
        isId(p.snapshotId) &&
        isId(p.preflightId) &&
        isInterpretationPreferences(p.preferences)
      );
    case "APPLY":
      return (
        !!p &&
        isId(p.snapshotId) &&
        isId(p.preflightId) &&
        isStrings(p.excludedIssueIds)
      );
    case "RETRY_FAILED":
      return !!p && isId(p.snapshotId);
    case "SHEET_DATA":
      return !!p && isSheetData(p.data) && isCount(p.fetchedAt);
    case "IMAGE_DATA":
      return (
        !!p &&
        isImageIdentity(p) &&
        p.data instanceof Uint8Array &&
        p.data.byteLength > 0 &&
        p.data.byteLength <= 20 * 1024 * 1024
      );
    case "IMAGE_FETCH_ERROR":
      return !!p && isImageIdentity(p) && isString(p.error);
    case "FETCH_ERROR":
      return !!p && isString(p.error);
    default:
      return false;
  }
}

export function isPluginMessage(msg: unknown): msg is PluginMessage {
  if (!isRecord(msg) || !isString(msg.type)) return false;
  const p = isRecord(msg.payload) ? msg.payload : undefined;
  switch (msg.type) {
    case "INIT":
      return (
        !!p &&
        typeof p.hasSelection === "boolean" &&
        (p.lastUrl === undefined || isString(p.lastUrl)) &&
        (p.config === undefined || isDocumentSyncConfig(p.config))
      );
    case "SELECTION_CHANGED":
      return !!p && typeof p.hasSelection === "boolean";
    default:
      if (!isRunId(msg.runId)) return false;
  }
  switch (msg.type) {
    case "CANCEL_FETCH":
      return true;
    case "FETCH_SUCCESS":
      return !!p && isSnapshot(p.snapshot);
    case "PREFLIGHT":
      return isPreflight(p);
    case "SYNC_COMPLETE":
      return isOperationResult(p);
    case "PROGRESS":
      return (
        !!p &&
        isString(p.message) &&
        isNumber(p.progress) &&
        p.progress >= 0 &&
        p.progress <= 100
      );
    case "ERROR":
      return !!p && isString(p.message) && typeof p.recoverable === "boolean";
    case "RESYNC_MODE":
      return !!p && isDocumentSyncConfig(p.config);
    case "REQUEST_IMAGE_FETCH":
      return !!p && isImageIdentity(p);
    case "REQUEST_SHEET_FETCH":
      return (
        !!p &&
        isString(p.url) &&
        isId(p.snapshotId) &&
        isInterpretationPreferences(p.preferences)
      );
    case "IMAGE_ACK":
      return (
        !!p &&
        isId(p.requestId) &&
        isId(p.nodeId) &&
        ["changed", "unchanged", "skipped", "failed"].includes(String(p.status))
      );
    default:
      return false;
  }
}

export function sendToUI(message: PluginMessage): void {
  figma.ui.postMessage(message);
}
export function sendToPlugin(message: UIMessage): void {
  parent.postMessage({ pluginMessage: message }, "*");
}
