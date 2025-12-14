/**
 * Sync Engine - Main Orchestration
 *
 * Coordinates the entire sync process:
 * 1. Build component cache
 * 2. Find and process repeat frames (auto-duplication)
 * 3. Re-traverse to pick up duplicated layers
 * 4. Initialize index tracker
 * 5. Process each layer (text, component swap, special types)
 * 6. Collect image URLs for UI to fetch
 * 7. Report progress and results
 */

import type {
  SheetData,
  SyncScope,
  SyncResult,
  SyncError,
  Worksheet,
  LayerToProcess,
  ComponentCache,
} from './types';
import { ErrorType } from './types';
import { traverseLayers, findRepeatFrames } from './traversal';
import { IndexTracker } from './index-tracker';
import { buildComponentCacheForScope, buildComponentCache, swapComponent } from './component-swap';
import { processRepeatFrame } from './repeat-frame';
import { syncTextLayer } from './text-sync';
import { matchLabel, normalizeLabel, parseLayerName, resolveInheritedParsedName } from './parser';
import {
  parseChainedSpecialTypes,
  applyChainedSpecialTypes,
  hasAnyParsedType,
} from './special-types';
import { isImageUrl, canHaveImageFill, convertToDirectUrl } from './image-sync';
import { createAppError, isAppError, logError, createWarning } from './errors';

// ============================================================================
// Types
// ============================================================================

/**
 * Options for running a sync.
 */
export interface SyncOptions {
  sheetData: SheetData;
  scope: SyncScope;
  onProgress?: (message: string, percent: number) => void;
}

/**
 * Pending image request for UI to fetch.
 */
export interface PendingImageRequest {
  nodeId: string;
  url: string;
}

/**
 * Extended sync result with pending images.
 */
export interface SyncEngineResult extends SyncResult {
  pendingImages: PendingImageRequest[];
  /** IDs of layers that were processed (for targeted resync) */
  processedLayerIds: string[];
}

// ============================================================================
// Main Sync Function
// ============================================================================

/**
 * Run the complete sync process.
 *
 * @param options - Sync options including sheet data and scope
 * @returns Sync result with statistics and any pending image requests
 */
export async function runSync(options: SyncOptions): Promise<SyncEngineResult> {
  const { sheetData, scope, onProgress } = options;

  const result: SyncEngineResult = {
    success: true,
    layersProcessed: 0,
    layersUpdated: 0,
    errors: [],
    warnings: [],
    pendingImages: [],
    processedLayerIds: [],
  };

  const progress = (message: string, percent: number) => {
    onProgress?.(message, percent);
  };

  try {
    // Phase 1: Build component cache
    progress('Building component cache...', 5);
    const componentCache = await buildComponentCacheForScope(scope);

    // Phase 2: Find and process repeat frames
    progress('Processing repeat frames...', 15);
    const repeatFrames = await findRepeatFrames(scope);

    if (repeatFrames.length > 0) {
      await processAllRepeatFrames(repeatFrames, sheetData, result);
    }

    // Phase 3: Re-traverse to pick up any duplicated layers
    progress('Scanning layers...', 30);
    const traversalResult = await traverseLayers({ scope });

    if (traversalResult.layers.length === 0) {
      result.warnings.push('No layers with bindings found in the selected scope');
      progress('Complete!', 100);
      return result;
    }

    // Phase 4: Initialize index tracker
    const indexTracker = new IndexTracker(sheetData);

    // Phase 5: Process each layer
    const totalLayers = traversalResult.layers.length;
    for (let i = 0; i < totalLayers; i++) {
      const layer = traversalResult.layers[i];
      const progressPercent = 30 + Math.floor((i / totalLayers) * 65);
      progress(`Processing ${truncateName(layer.node.name)}...`, progressPercent);

      result.layersProcessed++;

      try {
        const updated = await processLayer(
          layer,
          sheetData,
          indexTracker,
          componentCache,
          result.pendingImages
        );

        if (updated) {
          result.layersUpdated++;
          result.processedLayerIds.push(layer.node.id);
        }
      } catch (error) {
        const appError = isAppError(error)
          ? error
          : createAppError(ErrorType.UNKNOWN_ERROR, error instanceof Error ? error.message : String(error));

        // Log detailed error for debugging
        logError(appError);

        result.errors.push({
          layerName: layer.node.name,
          layerId: layer.node.id,
          error: appError.userMessage,
        });

        // Continue processing if error is recoverable
        if (!appError.recoverable) {
          throw appError;
        }
      }
    }

    progress('Complete!', 100);
  } catch (error) {
    result.success = false;
    const appError = isAppError(error)
      ? error
      : createAppError(ErrorType.UNKNOWN_ERROR, error instanceof Error ? error.message : String(error));

    logError(appError);

    result.errors.push({
      layerName: '',
      layerId: '',
      error: appError.userMessage,
    });
  }

  // Mark as partial success if there were errors but some layers updated
  if (result.errors.length > 0 && result.layersUpdated > 0) {
    result.success = true; // Partial success
  } else if (result.errors.length > 0 && result.layersUpdated === 0) {
    result.success = false;
  }

  return result;
}

/**
 * Options for running a targeted resync.
 */
export interface TargetedSyncOptions {
  sheetData: SheetData;
  layerIds: string[];
  onProgress?: (message: string, percent: number) => void;
}

/**
 * Run a targeted resync on specific layers by ID.
 * This is much faster than full page traversal for resync operations.
 *
 * @param options - Targeted sync options including layer IDs
 * @returns Sync result
 */
export async function runTargetedSync(options: TargetedSyncOptions): Promise<SyncEngineResult> {
  const { sheetData, layerIds, onProgress } = options;

  const result: SyncEngineResult = {
    success: true,
    layersProcessed: 0,
    layersUpdated: 0,
    errors: [],
    warnings: [],
    pendingImages: [],
    processedLayerIds: [],
  };

  const progress = (message: string, percent: number) => {
    onProgress?.(message, percent);
  };

  if (layerIds.length === 0) {
    result.warnings.push('No layer IDs provided for targeted sync');
    return result;
  }

  try {
    progress('Fetching layers...', 10);

    // Fetch all nodes by ID (fast, no traversal)
    const nodes: SceneNode[] = [];
    for (const id of layerIds) {
      const node = await figma.getNodeByIdAsync(id);
      if (node && 'type' in node && node.type !== 'DOCUMENT' && node.type !== 'PAGE') {
        nodes.push(node as SceneNode);
      }
    }

    if (nodes.length === 0) {
      result.warnings.push('No valid layers found from saved IDs');
      return result;
    }

    // Build minimal component cache from just these nodes' context
    progress('Building component cache...', 20);
    const componentCache = buildComponentCache(nodes);

    // Initialize index tracker
    const indexTracker = new IndexTracker(sheetData);

    // Process each layer
    progress('Processing layers...', 30);
    const totalLayers = nodes.length;

    for (let i = 0; i < totalLayers; i++) {
      const node = nodes[i];
      const progressPercent = 30 + Math.floor((i / totalLayers) * 65);
      progress(`Processing ${truncateName(node.name)}...`, progressPercent);

      result.layersProcessed++;

      try {
        // Re-parse the layer name to get binding info
        const parsed = parseLayerName(node.name);
        if (!parsed.hasBinding || parsed.labels.length === 0) {
          continue;
        }

        // Build a minimal layer info object
        const layer: LayerToProcess = {
          node,
          resolvedBinding: resolveInheritedParsedName(parsed, []),
          depth: 0,
        };

        const updated = await processLayer(
          layer,
          sheetData,
          indexTracker,
          componentCache,
          result.pendingImages
        );

        if (updated) {
          result.layersUpdated++;
          result.processedLayerIds.push(node.id);
        }
      } catch (error) {
        const appError = isAppError(error)
          ? error
          : createAppError(ErrorType.UNKNOWN_ERROR, error instanceof Error ? error.message : String(error));

        logError(appError);

        result.errors.push({
          layerName: node.name,
          layerId: node.id,
          error: appError.userMessage,
        });

        // Continue processing if error is recoverable
        if (!appError.recoverable) {
          throw appError;
        }
      }
    }

    progress('Complete!', 100);
  } catch (error) {
    result.success = false;
    const appError = isAppError(error)
      ? error
      : createAppError(ErrorType.UNKNOWN_ERROR, error instanceof Error ? error.message : String(error));

    logError(appError);

    result.errors.push({
      layerName: '',
      layerId: '',
      error: appError.userMessage,
    });
  }

  if (result.errors.length > 0 && result.layersUpdated > 0) {
    result.success = true;
  } else if (result.errors.length > 0 && result.layersUpdated === 0) {
    result.success = false;
  }

  return result;
}

// ============================================================================
// Repeat Frame Processing
// ============================================================================

/**
 * Process all repeat frames before main sync.
 */
async function processAllRepeatFrames(
  repeatFrames: SceneNode[],
  sheetData: SheetData,
  result: SyncEngineResult
): Promise<void> {
  for (const frame of repeatFrames) {
    if (frame.type !== 'FRAME') continue;

    try {
      // Determine which worksheet to use
      const worksheet = getWorksheetForNode(frame, sheetData);
      if (!worksheet) {
        result.warnings.push(
          createWarning('Could not determine worksheet', frame.name)
        );
        continue;
      }

      const repeatResult = await processRepeatFrame(frame as FrameNode, worksheet);

      if (!repeatResult.success && repeatResult.error) {
        result.warnings.push(
          createWarning(repeatResult.error.error, frame.name)
        );
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.warnings.push(createWarning(errorMessage, frame.name));
    }
  }
}

// ============================================================================
// Layer Processing
// ============================================================================

/**
 * Process a single layer.
 *
 * @returns true if the layer was updated
 */
async function processLayer(
  layer: LayerToProcess,
  sheetData: SheetData,
  indexTracker: IndexTracker,
  componentCache: ComponentCache,
  pendingImages: PendingImageRequest[]
): Promise<boolean> {
  const { node, resolvedBinding } = layer;

  // Skip layers without bindings
  if (!resolvedBinding.hasBinding || resolvedBinding.labels.length === 0) {
    return false;
  }

  // Get the worksheet
  const worksheet = resolvedBinding.worksheet
    ? sheetData.worksheets.find(
        (w) => normalizeLabel(w.name) === normalizeLabel(resolvedBinding.worksheet!)
      )
    : sheetData.worksheets[0];

  if (!worksheet) {
    throw createAppError(
      ErrorType.WORKSHEET_NOT_FOUND,
      `Worksheet "${resolvedBinding.worksheet || 'default'}" not found`
    );
  }

  // Get the primary label and match it to sheet labels
  const primaryLabel = resolvedBinding.labels[0];
  const matchedLabel = matchLabel(primaryLabel, Object.keys(worksheet.rows));

  if (!matchedLabel) {
    // No matching label in sheet - this is not necessarily an error
    return false;
  }

  // Resolve the index
  const indexType = resolvedBinding.index ?? { type: 'increment' as const };
  const resolved = indexTracker.resolveIndex(matchedLabel, worksheet.name, indexType);

  if (!resolved.success || resolved.index < 0) {
    return false;
  }

  const value = resolved.value;

  // Get additional values for multi-label layers
  const additionalValues: string[] = [];
  for (let i = 1; i < resolvedBinding.labels.length; i++) {
    const addLabel = resolvedBinding.labels[i];
    const addMatchedLabel = matchLabel(addLabel, Object.keys(worksheet.rows));
    if (addMatchedLabel) {
      const addValue = worksheet.rows[addMatchedLabel][resolved.index];
      if (addValue) additionalValues.push(addValue);
    }
  }

  // Apply value based on node type and value content
  return await applyValue(node, value, additionalValues, componentCache, pendingImages);
}

/**
 * Apply a value to a node based on its type and the value content.
 */
async function applyValue(
  node: SceneNode,
  value: string,
  additionalValues: string[],
  componentCache: ComponentCache,
  pendingImages: PendingImageRequest[]
): Promise<boolean> {
  // Skip empty values
  if (!value && additionalValues.length === 0) {
    return false;
  }

  // Check for special data type prefix (/) for text/instance nodes
  const hasSpecialPrefix = value.startsWith('/');
  const cleanValue = hasSpecialPrefix ? value.substring(1) : value;

  // Handle TEXT nodes
  if (node.type === 'TEXT') {
    if (hasSpecialPrefix) {
      // Special data type on text node
      const parsed = parseChainedSpecialTypes(cleanValue);
      if (hasAnyParsedType(parsed)) {
        await applyChainedSpecialTypes(node, parsed);
        return true;
      }
    }
    // Regular text sync
    const result = await syncTextLayer(node, value, { additionalValues });
    return result.success && result.contentChanged;
  }

  // Handle INSTANCE nodes
  if (node.type === 'INSTANCE') {
    if (hasSpecialPrefix) {
      // Special data type on instance node
      const parsed = parseChainedSpecialTypes(cleanValue);
      if (hasAnyParsedType(parsed)) {
        await applyChainedSpecialTypes(node, parsed);
        return true;
      }
    }
    // Component swap
    const result = swapComponent(node, value, componentCache);
    return result.success && result.componentChanged;
  }

  // Handle image URLs for nodes that can have image fills
  if (isImageUrl(value) && canHaveImageFill(node)) {
    // Queue image for fetching by UI
    const directUrl = convertToDirectUrl(value);
    pendingImages.push({
      nodeId: node.id,
      url: directUrl,
    });
    return true; // Will be updated when image is fetched
  }

  // Try special data types for any node type
  const parsed = parseChainedSpecialTypes(value);
  if (hasAnyParsedType(parsed)) {
    await applyChainedSpecialTypes(node, parsed);
    return true;
  }

  // Value couldn't be applied to this node type
  return false;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get the worksheet for a node based on its binding or default.
 */
function getWorksheetForNode(node: SceneNode, sheetData: SheetData): Worksheet | undefined {
  // Try to extract worksheet from node name
  const worksheetMatch = node.name.match(/\/\/\s*([^\s]+)/);
  if (worksheetMatch) {
    const worksheetName = worksheetMatch[1];
    return sheetData.worksheets.find(
      (w) => normalizeLabel(w.name) === normalizeLabel(worksheetName)
    );
  }

  // Default to first worksheet
  return sheetData.worksheets[0];
}

/**
 * Truncate a layer name for display in progress messages.
 */
function truncateName(name: string, maxLength: number = 30): string {
  if (name.length <= maxLength) return name;
  return name.substring(0, maxLength - 3) + '...';
}

// ============================================================================
// Image Application (called after UI fetches images)
// ============================================================================

/**
 * Apply fetched image data to a node.
 * This is called by code.ts when the UI sends IMAGE_DATA messages.
 */
export async function applyFetchedImage(
  nodeId: string,
  imageData: Uint8Array
): Promise<boolean> {
  const node = await figma.getNodeByIdAsync(nodeId);

  if (!node || !canHaveImageFill(node as SceneNode)) {
    return false;
  }

  try {
    const image = figma.createImage(imageData);
    const fills: ImagePaint[] = [
      {
        type: 'IMAGE',
        imageHash: image.hash,
        scaleMode: 'FILL',
      },
    ];

    if ('fills' in node) {
      (node as GeometryMixin).fills = fills;
      return true;
    }
  } catch (error) {
    const appError = createAppError(
      ErrorType.IMAGE_LOAD_FAILED,
      `Node ${nodeId}: ${error instanceof Error ? error.message : String(error)}`
    );
    logError(appError);
  }

  return false;
}
