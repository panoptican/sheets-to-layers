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
    url: string;
    data: Uint8Array;
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
 * Union type of all messages that can be sent from UI to plugin.
 */
export type UIMessage =
  | FetchMessage
  | FetchAndSyncMessage
  | SyncMessage
  | UIReadyMessage
  | RenameSelectionMessage
  | SheetDataMessage
  | ImageDataMessage
  | FetchErrorMessage;

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

/**
 * Type guard for UI messages.
 */
export function isUIMessage(msg: unknown): msg is UIMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    'type' in msg &&
    typeof (msg as UIMessage).type === 'string'
  );
}

/**
 * Type guard for Plugin messages.
 */
export function isPluginMessage(msg: unknown): msg is PluginMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    'type' in msg &&
    typeof (msg as PluginMessage).type === 'string'
  );
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
