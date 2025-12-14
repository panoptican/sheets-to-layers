/**
 * Main plugin entry point.
 *
 * This code runs in Figma's main thread with access to the document
 * but no network access. All network requests are handled by the UI.
 */

import type { UIMessage, PluginMessage } from './messages';
import { sendToUI, isUIMessage } from './messages';
import type { SheetData, SyncScope } from './core/types';
import { runSync, runTargetedSync, applyFetchedImage } from './core/sync-engine';
import { isAppError, logError, createAppError } from './core/errors';
import { ErrorType } from './core/types';

// ============================================================================
// Constants
// ============================================================================

const PLUGIN_WIDTH = 720;
const PLUGIN_HEIGHT = 480;
const RESYNC_HEIGHT = 100;

const STORAGE_KEY_LAST_URL = 'lastUrl';
const STORAGE_KEY_LAST_SCOPE = 'lastScope';
const STORAGE_KEY_LAST_LAYER_IDS = 'lastLayerIds';

// ============================================================================
// State
// ============================================================================

/** Cached sheet data from last fetch */
let cachedSheetData: SheetData | null = null;

/** URL used for current/last sync (for saving to storage) */
let lastSyncUrl: string | null = null;

/** Pending sync scope (set when FETCH_AND_SYNC is received, cleared after sync) */
let pendingSyncScope: SyncScope | null = null;

/** Whether we're in resync mode (should close plugin after sync) */
let isResyncMode = false;

/** Count of pending images in resync mode (close when reaches 0) */
let pendingImageCount = 0;

/** Stored layer IDs from last sync (for targeted resync) */
let storedLayerIds: string[] = [];

// ============================================================================
// Main Entry Point
// ============================================================================

async function main(): Promise<void> {
  const command = figma.command;

  switch (command) {
    case 'open':
      await showMainUI();
      break;

    case 'resync':
      await handleResync();
      break;

    default:
      // First run or menu launch
      await showMainUI();
      break;
  }
}

// ============================================================================
// UI Management
// ============================================================================

/**
 * Show the main plugin UI.
 */
async function showMainUI(): Promise<void> {
  figma.showUI(__html__, {
    width: PLUGIN_WIDTH,
    height: PLUGIN_HEIGHT,
    themeColors: true,
  });

  // Wait for UI to be ready before sending init data
  setupMessageHandler();
  setupSelectionHandler();
}

/**
 * Handle the resync command from relaunch button.
 */
async function handleResync(): Promise<void> {
  const lastUrl = await figma.clientStorage.getAsync(STORAGE_KEY_LAST_URL);
  const savedLayerIds = await figma.clientStorage.getAsync(STORAGE_KEY_LAST_LAYER_IDS);

  if (!lastUrl) {
    figma.notify('No previous sync found. Please run Sheets Sync first.', {
      error: true,
    });
    await showMainUI();
    return;
  }

  // Mark that we're in resync mode (plugin should close after sync)
  isResyncMode = true;

  // Load stored layer IDs for targeted resync
  if (Array.isArray(savedLayerIds) && savedLayerIds.length > 0) {
    storedLayerIds = savedLayerIds;
  } else {
    storedLayerIds = [];
  }

  // Show minimal UI with progress
  figma.showUI(__html__, {
    width: PLUGIN_WIDTH,
    height: RESYNC_HEIGHT,
    themeColors: true,
  });

  setupMessageHandler();

  // Tell UI to start in resync mode
  sendToUI({
    type: 'RESYNC_MODE',
    payload: { url: lastUrl as string },
  });
}

// ============================================================================
// Message Handling
// ============================================================================

/**
 * Set up the message handler for UI communication.
 */
function setupMessageHandler(): void {
  figma.ui.onmessage = async (msg: unknown) => {
    if (!isUIMessage(msg)) {
      console.warn('Received invalid message from UI:', msg);
      return;
    }

    await handleUIMessage(msg);
  };
}

/**
 * Handle a message from the UI.
 */
async function handleUIMessage(msg: UIMessage): Promise<void> {
  switch (msg.type) {
    case 'UI_READY':
      await handleUIReady();
      break;

    case 'FETCH':
      // UI will handle the actual fetch, this is just for tracking
      sendToUI({
        type: 'REQUEST_SHEET_FETCH',
        payload: { url: msg.payload.url },
      });
      break;

    case 'FETCH_AND_SYNC':
      // Store URL and scope for use after fetch completes
      lastSyncUrl = msg.payload.url;
      pendingSyncScope = msg.payload.scope;
      sendToUI({
        type: 'REQUEST_SHEET_FETCH',
        payload: { url: msg.payload.url },
      });
      break;

    case 'SHEET_DATA':
      cachedSheetData = msg.payload.data;
      sendToUI({
        type: 'FETCH_SUCCESS',
        payload: { sheetData: msg.payload.data },
      });
      // If there's a pending sync (from FETCH_AND_SYNC), run it now
      if (pendingSyncScope) {
        const scope = pendingSyncScope;
        pendingSyncScope = null;
        await handleSync(scope);
      }
      // In resync mode, auto-trigger sync when data arrives
      else if (isResyncMode) {
        await handleSync('page'); // scope doesn't matter, we use stored layer IDs
      }
      break;

    case 'SYNC':
      // Skip if already handled by resync mode auto-trigger
      if (isResyncMode) {
        break;
      }
      await handleSync(msg.payload.scope);
      break;

    case 'RENAME_SELECTION':
      handleRenameSelection(msg.payload.nameSuffix);
      break;

    case 'FETCH_ERROR':
      sendToUI({
        type: 'ERROR',
        payload: {
          message: msg.payload.error,
          recoverable: false,
        },
      });
      break;

    case 'IMAGE_DATA':
      await handleImageData(msg.payload.nodeId, msg.payload.data);
      break;

    default:
      console.warn('Unhandled UI message type:', (msg as UIMessage).type);
  }
}

/**
 * Handle UI ready event - send initialization data.
 */
async function handleUIReady(): Promise<void> {
  const lastUrl = await figma.clientStorage.getAsync(STORAGE_KEY_LAST_URL);
  const hasSelection = figma.currentPage.selection.length > 0;

  sendToUI({
    type: 'INIT',
    payload: {
      hasSelection,
      lastUrl: lastUrl as string | undefined,
    },
  });
}

/**
 * Handle sync request.
 */
async function handleSync(scope: SyncScope): Promise<void> {
  if (!cachedSheetData) {
    sendToUI({
      type: 'ERROR',
      payload: {
        message: 'No sheet data available. Please fetch data first.',
        recoverable: true,
      },
    });
    return;
  }

  sendToUI({
    type: 'PROGRESS',
    payload: {
      message: 'Starting sync...',
      progress: 0,
    },
  });

  try {
    // Use targeted sync for resync mode if we have stored layer IDs
    const useTargetedSync = isResyncMode && storedLayerIds.length > 0;

    const progressCallback = (message: string, percent: number) => {
      sendToUI({
        type: 'PROGRESS',
        payload: {
          message,
          progress: percent,
        },
      });
    };

    const result = useTargetedSync
      ? await runTargetedSync({
          sheetData: cachedSheetData,
          layerIds: storedLayerIds,
          onProgress: progressCallback,
        })
      : await runSync({
          sheetData: cachedSheetData,
          scope,
          onProgress: progressCallback,
        });

    // Send any pending image requests to UI for fetching
    if (isResyncMode) {
      pendingImageCount = result.pendingImages.length;
    }
    for (const imageRequest of result.pendingImages) {
      sendToUI({
        type: 'REQUEST_IMAGE_FETCH',
        payload: {
          nodeId: imageRequest.nodeId,
          url: imageRequest.url,
        },
      });
    }

    // Send completion message
    sendToUI({
      type: 'SYNC_COMPLETE',
      payload: {
        success: result.success,
        layersProcessed: result.layersProcessed,
        layersUpdated: result.layersUpdated,
        errors: result.errors,
        warnings: result.warnings,
      },
    });

    // Save URL, layer IDs, and set relaunch data on success
    if (result.success && lastSyncUrl) {
      await setRelaunchData(lastSyncUrl);
      // Save layer IDs for future targeted resync
      if (result.processedLayerIds.length > 0) {
        await figma.clientStorage.setAsync(STORAGE_KEY_LAST_LAYER_IDS, result.processedLayerIds);
      }
    }

    // Show notification
    if (result.success) {
      const imageNote = result.pendingImages.length > 0
        ? ` (${result.pendingImages.length} images loading...)`
        : '';
      figma.notify(`Synced ${result.layersUpdated} layers${imageNote}`);
    } else {
      figma.notify('Sync completed with errors. Check the results.', { error: true });
    }

    // Close plugin after resync mode completes (unless there are pending images)
    if (isResyncMode && result.pendingImages.length === 0) {
      isResyncMode = false;
      figma.closePlugin();
    }
  } catch (error) {
    const appError = isAppError(error)
      ? error
      : createAppError(ErrorType.UNKNOWN_ERROR, error instanceof Error ? error.message : String(error));

    logError(appError);

    sendToUI({
      type: 'ERROR',
      payload: {
        message: appError.userMessage,
        recoverable: appError.recoverable,
      },
    });
    figma.notify(appError.userMessage, { error: true, timeout: 5000 });
  }
}

/**
 * Handle image data received from UI.
 */
async function handleImageData(nodeId: string, imageData: Uint8Array): Promise<void> {
  const success = await applyFetchedImage(nodeId, imageData);
  if (!success) {
    console.warn(`Failed to apply image to node ${nodeId}`);
  }

  // In resync mode, track pending images and close when done
  if (isResyncMode && pendingImageCount > 0) {
    pendingImageCount--;
    if (pendingImageCount === 0) {
      isResyncMode = false;
      figma.closePlugin();
    }
  }
}

/**
 * Handle rename selection request from UI.
 */
function handleRenameSelection(nameSuffix: string): void {
  const selection = figma.currentPage.selection;

  if (selection.length === 0) {
    figma.notify('No layers selected', { error: true });
    return;
  }

  // Pattern to match existing #Label or #Label.index bindings
  const labelPattern = /#[a-zA-Z][a-zA-Z0-9_-]*(?:\.[a-zA-Z0-9]+)?/g;
  // Pattern to match // WorksheetName
  const worksheetPattern = /\/\/\s*[^\s]+/g;

  for (const node of selection) {
    let newName = node.name;

    if (nameSuffix.startsWith('#')) {
      // Replacing a label binding - remove existing #Label patterns
      if (labelPattern.test(newName)) {
        // Reset pattern lastIndex
        labelPattern.lastIndex = 0;
        newName = newName.replace(labelPattern, '').trim();
        // Clean up any double spaces
        newName = newName.replace(/\s+/g, ' ').trim();
      }
      // Add the new binding
      newName = newName ? `${newName} ${nameSuffix}` : nameSuffix;
    } else if (nameSuffix.startsWith('//')) {
      // Replacing a worksheet reference - remove existing // patterns
      if (worksheetPattern.test(newName)) {
        worksheetPattern.lastIndex = 0;
        newName = newName.replace(worksheetPattern, '').trim();
        newName = newName.replace(/\s+/g, ' ').trim();
      }
      newName = newName ? `${newName} ${nameSuffix}` : nameSuffix;
    } else if (nameSuffix.startsWith('.')) {
      // Adding an index - replace existing index on any #Label
      // Match #Label.index or #Label and replace/add the index
      const indexPattern = /(#[a-zA-Z][a-zA-Z0-9_-]*)(?:\.[a-zA-Z0-9]+)?/g;
      if (indexPattern.test(newName)) {
        indexPattern.lastIndex = 0;
        newName = newName.replace(indexPattern, `$1${nameSuffix}`);
      } else {
        // No existing label, just append
        newName = `${newName} ${nameSuffix}`;
      }
    } else {
      // Default: append
      newName = `${newName} ${nameSuffix}`;
    }

    node.name = newName;
  }

  figma.notify(`Renamed ${selection.length} layer(s)`);
}

// ============================================================================
// Selection Handling
// ============================================================================

/**
 * Set up selection change handler.
 */
function setupSelectionHandler(): void {
  figma.on('selectionchange', () => {
    const hasSelection = figma.currentPage.selection.length > 0;
    sendToUI({
      type: 'SELECTION_CHANGED',
      payload: { hasSelection },
    });
  });
}

// ============================================================================
// Relaunch Data
// ============================================================================

/**
 * Set relaunch data on the document after successful sync.
 */
export async function setRelaunchData(url: string): Promise<void> {
  // Store URL for later retrieval
  await figma.clientStorage.setAsync(STORAGE_KEY_LAST_URL, url);

  // Set relaunch buttons on document root
  figma.root.setRelaunchData({
    open: '',
    resync: `Last synced from: ${truncateUrl(url, 50)}`,
  });
}

/**
 * Truncate a URL for display.
 */
function truncateUrl(url: string, maxLength: number): string {
  if (url.length <= maxLength) return url;
  return url.substring(0, maxLength - 3) + '...';
}

// ============================================================================
// Run
// ============================================================================

main().catch((error) => {
  const appError = isAppError(error)
    ? error
    : createAppError(ErrorType.UNKNOWN_ERROR, error instanceof Error ? error.message : String(error));

  logError(appError);
  figma.notify(appError.userMessage, { error: true, timeout: 5000 });
});
