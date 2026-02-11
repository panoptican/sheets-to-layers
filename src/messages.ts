/**
 * Message type definitions for communication between UI and main plugin contexts.
 *
 * The plugin uses Figma's dual-context architecture:
 * - Main thread: Access to Figma document/nodes, no network access
 * - UI thread: iframe with network access, standard DOM APIs
 *
 * All communication happens via postMessage.
 */

import type { SheetData, SyncScope, SyncResult } from './core/types';

// ============================================================================
// UI → Plugin Messages
// ============================================================================

/**
 * Message sent from UI to request data fetch only (for preview).
 */
export interface FetchMessage {
  type: 'FETCH';
  payload: {
    url: string;
  };
}

/**
 * Message sent from UI to fetch data and immediately sync.
 */
export interface FetchAndSyncMessage {
  type: 'FETCH_AND_SYNC';
  payload: {
    url: string;
    scope: SyncScope;
  };
}

/**
 * Message sent from UI to sync with already-fetched data.
 */
export interface SyncMessage {
  type: 'SYNC';
  payload: {
    scope: SyncScope;
  };
}

/**
 * Message sent from UI to cancel an in-progress sync.
 */
export interface CancelSyncMessage {
  type: 'CANCEL_SYNC';
}

/**
 * Message sent from UI when it has finished loading.
 */
export interface UIReadyMessage {
  type: 'UI_READY';
}

/**
 * Message sent from UI to rename selected layers.
 */
export interface RenameSelectionMessage {
  type: 'RENAME_SELECTION';
  payload: {
    nameSuffix: string;
  };
}

/**
 * Message sent from UI with fetched sheet data.
 * (Network requests happen in UI, data passed to main thread)
 */
export interface SheetDataMessage {
  type: 'SHEET_DATA';
  payload: {
    data: SheetData;
  };
}

/**
 * Message sent from UI with fetched image data.
 */
export interface ImageDataMessage {
  type: 'IMAGE_DATA';
  payload: {
    nodeId: string;
    url: string;
    data: Uint8Array;
  };
}

/**
 * Message sent from UI when an image fetch operation fails.
 */
export interface ImageFetchErrorMessage {
  type: 'IMAGE_FETCH_ERROR';
  payload: {
    nodeId: string;
    url: string;
    error: string;
  };
}

/**
 * Message sent from UI when a fetch operation fails.
 */
export interface FetchErrorMessage {
  type: 'FETCH_ERROR';
  payload: {
    error: string;
  };
}

/**
 * Message sent from UI to resize the plugin window.
 */
export interface ResizeWindowMessage {
  type: 'RESIZE_WINDOW';
  payload: {
    width: number;
    height: number;
  };
}

/**
 * Union type of all messages that can be sent from UI to plugin.
 */
export type UIMessage =
  | FetchMessage
  | FetchAndSyncMessage
  | SyncMessage
  | CancelSyncMessage
  | UIReadyMessage
  | RenameSelectionMessage
  | SheetDataMessage
  | ImageDataMessage
  | ImageFetchErrorMessage
  | FetchErrorMessage
  | ResizeWindowMessage;

// ============================================================================
// Plugin → UI Messages
// ============================================================================

/**
 * Message sent to UI on plugin initialization.
 */
export interface InitMessage {
  type: 'INIT';
  payload: {
    hasSelection: boolean;
    lastUrl?: string;
  };
}

/**
 * Message sent to UI when selection changes.
 */
export interface SelectionChangedMessage {
  type: 'SELECTION_CHANGED';
  payload: {
    hasSelection: boolean;
  };
}

/**
 * Message sent to UI when data fetch succeeds.
 */
export interface FetchSuccessMessage {
  type: 'FETCH_SUCCESS';
  payload: {
    sheetData: SheetData;
  };
}

/**
 * Message sent to UI when sync completes.
 */
export interface SyncCompleteMessage {
  type: 'SYNC_COMPLETE';
  payload: SyncResult;
}

/**
 * Message sent to UI to report progress.
 */
export interface ProgressMessage {
  type: 'PROGRESS';
  payload: {
    message: string;
    progress: number; // 0-100
  };
}

/**
 * Message sent to UI when an error occurs.
 */
export interface ErrorMessage {
  type: 'ERROR';
  payload: {
    message: string;
    recoverable: boolean;
  };
}

/**
 * Message sent to UI for re-sync mode.
 */
export interface ResyncModeMessage {
  type: 'RESYNC_MODE';
  payload: {
    url: string;
  };
}

/**
 * Message sent to UI requesting an image fetch.
 */
export interface RequestImageFetchMessage {
  type: 'REQUEST_IMAGE_FETCH';
  payload: {
    url: string;
    nodeId: string;
  };
}

/**
 * Message sent to UI requesting sheet data fetch.
 */
export interface RequestSheetFetchMessage {
  type: 'REQUEST_SHEET_FETCH';
  payload: {
    url: string;
  };
}

/**
 * Union type of all messages that can be sent from plugin to UI.
 */
export type PluginMessage =
  | InitMessage
  | SelectionChangedMessage
  | FetchSuccessMessage
  | SyncCompleteMessage
  | ProgressMessage
  | ErrorMessage
  | ResyncModeMessage
  | RequestImageFetchMessage
  | RequestSheetFetchMessage;

// ============================================================================
// Type Guards
// ============================================================================

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasStringField(value: Record<string, unknown>, key: string): boolean {
  return typeof value[key] === 'string';
}

function hasBooleanField(value: Record<string, unknown>, key: string): boolean {
  return typeof value[key] === 'boolean';
}

function hasNumberField(value: Record<string, unknown>, key: string): boolean {
  return typeof value[key] === 'number';
}

function isSyncScope(value: unknown): value is SyncScope {
  return value === 'document' || value === 'page' || value === 'selection';
}

/**
 * Type guard for UI messages.
 */
export function isUIMessage(msg: unknown): msg is UIMessage {
  if (!isRecord(msg) || typeof msg.type !== 'string') {
    return false;
  }

  const payload = isRecord(msg.payload) ? msg.payload : undefined;

  switch (msg.type) {
    case 'UI_READY':
    case 'CANCEL_SYNC':
      return true;
    case 'FETCH':
      return !!payload && hasStringField(payload, 'url');
    case 'FETCH_AND_SYNC':
      return !!payload && hasStringField(payload, 'url') && isSyncScope(payload.scope);
    case 'SYNC':
      return !!payload && isSyncScope(payload.scope);
    case 'RENAME_SELECTION':
      return !!payload && hasStringField(payload, 'nameSuffix');
    case 'SHEET_DATA':
      return !!payload && isRecord(payload.data);
    case 'IMAGE_DATA':
      return (
        !!payload &&
        hasStringField(payload, 'nodeId') &&
        hasStringField(payload, 'url') &&
        payload.data instanceof Uint8Array
      );
    case 'IMAGE_FETCH_ERROR':
      return (
        !!payload &&
        hasStringField(payload, 'nodeId') &&
        hasStringField(payload, 'url') &&
        hasStringField(payload, 'error')
      );
    case 'FETCH_ERROR':
      return !!payload && hasStringField(payload, 'error');
    case 'RESIZE_WINDOW':
      return !!payload && hasNumberField(payload, 'width') && hasNumberField(payload, 'height');
    default:
      return false;
  }
}

/**
 * Type guard for Plugin messages.
 */
export function isPluginMessage(msg: unknown): msg is PluginMessage {
  if (!isRecord(msg) || typeof msg.type !== 'string') {
    return false;
  }

  const payload = isRecord(msg.payload) ? msg.payload : undefined;

  switch (msg.type) {
    case 'INIT':
      return (
        !!payload &&
        hasBooleanField(payload, 'hasSelection') &&
        (payload.lastUrl === undefined || typeof payload.lastUrl === 'string')
      );
    case 'SELECTION_CHANGED':
      return !!payload && hasBooleanField(payload, 'hasSelection');
    case 'FETCH_SUCCESS':
      return !!payload && isRecord(payload.sheetData);
    case 'SYNC_COMPLETE':
      return (
        !!payload &&
        hasBooleanField(payload, 'success') &&
        hasNumberField(payload, 'layersProcessed') &&
        hasNumberField(payload, 'layersUpdated') &&
        Array.isArray(payload.errors) &&
        Array.isArray(payload.warnings)
      );
    case 'PROGRESS':
      return !!payload && hasStringField(payload, 'message') && hasNumberField(payload, 'progress');
    case 'ERROR':
      return !!payload && hasStringField(payload, 'message') && hasBooleanField(payload, 'recoverable');
    case 'RESYNC_MODE':
      return !!payload && hasStringField(payload, 'url');
    case 'REQUEST_IMAGE_FETCH':
      return !!payload && hasStringField(payload, 'url') && hasStringField(payload, 'nodeId');
    case 'REQUEST_SHEET_FETCH':
      return !!payload && hasStringField(payload, 'url');
    default:
      return false;
  }
}

// ============================================================================
// Message Helpers
// ============================================================================

/**
 * Send a message from the main plugin to the UI.
 */
export function sendToUI(message: PluginMessage): void {
  figma.ui.postMessage(message);
}

/**
 * Send a message from the UI to the main plugin.
 * (Use in UI context only)
 */
export function sendToPlugin(message: UIMessage): void {
  parent.postMessage({ pluginMessage: message }, '*');
}
