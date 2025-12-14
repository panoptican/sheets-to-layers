/**
 * Main plugin entry point.
 *
 * This code runs in Figma's main thread with access to the document
 * but no network access. All network requests are handled by the UI.
 */

import type { UIMessage, PluginMessage } from './messages';
import { sendToUI, isUIMessage } from './messages';
import type { SheetData, SyncScope } from './core/types';
import { runSync, applyFetchedImage } from './core/sync-engine';

// ============================================================================
// Constants
// ============================================================================

const PLUGIN_WIDTH = 400;
const PLUGIN_HEIGHT = 500;
const RESYNC_HEIGHT = 100;

const STORAGE_KEY_LAST_URL = 'lastUrl';

// ============================================================================
// State
// ============================================================================

/** Cached sheet data from last fetch */
let cachedSheetData: SheetData | null = null;

/** URL used for current/last sync (for saving to storage) */
let lastSyncUrl: string | null = null;

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

  if (!lastUrl) {
    figma.notify('No previous sync found. Please run Sheets Sync first.', {
      error: true,
    });
    await showMainUI();
    return;
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
      // UI will fetch, then send SHEET_DATA, then we sync
      // Store URL for later use when saving after sync
      lastSyncUrl = msg.payload.url;
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
      break;

    case 'SYNC':
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
    const result = await runSync({
      sheetData: cachedSheetData,
      scope,
      onProgress: (message, percent) => {
        sendToUI({
          type: 'PROGRESS',
          payload: {
            message,
            progress: percent,
          },
        });
      },
    });

    // Send any pending image requests to UI for fetching
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

    // Save URL and set relaunch data on success
    if (result.success && lastSyncUrl) {
      await setRelaunchData(lastSyncUrl);
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
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    sendToUI({
      type: 'ERROR',
      payload: {
        message: `Sync failed: ${errorMessage}`,
        recoverable: true,
      },
    });
    figma.notify('Sync failed. Check the console for details.', { error: true });
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

  for (const node of selection) {
    // Append suffix to existing name
    node.name = `${node.name} ${nameSuffix}`;
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
  console.error('Plugin error:', error);
  figma.notify('An error occurred. Check the console for details.', {
    error: true,
  });
});
