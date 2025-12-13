/**
 * Layer traversal engine for Sheets Sync plugin.
 *
 * Walks through the Figma document tree, respects sync scope (document/page/selection),
 * handles layer ignoring with `-` prefix, skips main components (unless `+` prefixed),
 * and builds an ordered list of layers to process.
 *
 * The traversal:
 * 1. Starts from the appropriate scope (document, page, or selection)
 * 2. Recursively walks children in depth-first order
 * 3. Skips ignored layers (-prefix) and their entire subtrees
 * 4. Skips main COMPONENT nodes unless force-included (+prefix)
 * 5. Collects layers with bindings (#Label syntax)
 * 6. Tracks ancestor context for worksheet/index inheritance
 */

import type { ParsedLayerName, LayerToProcess, TraversalOptions, SyncScope } from './types';
import { parseLayerName, resolveInheritedParsedName } from './parser';

// ============================================================================
// Types
// ============================================================================

/**
 * Context passed through the traversal for inheritance tracking.
 */
interface TraversalContext {
  /** Parsed layer names from ancestors (parent first) */
  ancestorParsed: ParsedLayerName[];
  /** Current depth in the tree */
  depth: number;
}

/**
 * Result of traversing the layer tree.
 */
export interface TraversalResult {
  /** All layers that have bindings and should be processed */
  layers: LayerToProcess[];
  /** Count of layers examined (including those without bindings) */
  layersExamined: number;
  /** Count of layers skipped due to ignore prefix */
  layersIgnored: number;
  /** Count of main components skipped (not force-included) */
  componentsSkipped: number;
}

// ============================================================================
// Main Traversal Functions
// ============================================================================

/**
 * Traverse layers based on the specified sync scope.
 *
 * This is the main entry point for layer traversal. It handles:
 * - Document scope: loads all pages and traverses entire document
 * - Page scope: traverses only the current page
 * - Selection scope: traverses only selected layers and their children
 *
 * @param options - Traversal options specifying the scope
 * @returns Promise resolving to TraversalResult with all layers to process
 *
 * @example
 * // Traverse current page
 * const result = await traverseLayers({ scope: 'page' });
 * console.log(`Found ${result.layers.length} layers with bindings`);
 *
 * @example
 * // Traverse entire document
 * const result = await traverseLayers({ scope: 'document' });
 */
export async function traverseLayers(options: TraversalOptions): Promise<TraversalResult> {
  const result: TraversalResult = {
    layers: [],
    layersExamined: 0,
    layersIgnored: 0,
    componentsSkipped: 0,
  };

  const initialContext: TraversalContext = {
    ancestorParsed: [],
    depth: 0,
  };

  switch (options.scope) {
    case 'document':
      // Load and traverse all pages
      for (const page of figma.root.children) {
        // Dynamic page loading - required before accessing children
        await page.loadAsync();
        await traverseNode(page, result, initialContext);
      }
      break;

    case 'page':
      // Traverse only current page
      await traverseNode(figma.currentPage, result, initialContext);
      break;

    case 'selection':
      // Traverse only selected layers and their children
      for (const node of figma.currentPage.selection) {
        await traverseNode(node, result, initialContext);
      }
      break;
  }

  return result;
}

/**
 * Recursively traverse a node and its children.
 *
 * This function:
 * 1. Skips ignored layers (- prefix) and their entire subtrees
 * 2. Skips main COMPONENT nodes unless force-included (+ prefix)
 * 3. Collects layers with bindings to the result
 * 4. Tracks ancestor context for inheritance
 * 5. Recursively processes children
 *
 * @param node - The node to traverse
 * @param result - The result object to populate
 * @param context - Current traversal context
 */
async function traverseNode(
  node: BaseNode,
  result: TraversalResult,
  context: TraversalContext
): Promise<void> {
  // Skip document nodes - just process their children
  if (node.type === 'DOCUMENT') {
    for (const child of (node as DocumentNode).children) {
      await traverseNode(child, result, context);
    }
    return;
  }

  // Skip page nodes - just process their children
  if (node.type === 'PAGE') {
    for (const child of (node as PageNode).children) {
      await traverseNode(child, result, context);
    }
    return;
  }

  // Parse the layer name
  const parsed = parseLayerName(node.name);
  result.layersExamined++;

  // Check if layer should be ignored (- prefix)
  if (parsed.isIgnored) {
    result.layersIgnored++;
    return; // Skip this layer and all children
  }

  // Check if this is a main component (skip unless force-included)
  if (node.type === 'COMPONENT' && !parsed.forceInclude) {
    result.componentsSkipped++;
    return; // Skip main components by default
  }

  // Resolve inheritance from ancestors
  const resolvedBinding = resolveInheritedParsedName(parsed, context.ancestorParsed);

  // If this layer has a binding, add it to the result
  if (parsed.hasBinding) {
    result.layers.push({
      node: node as SceneNode,
      resolvedBinding,
      depth: context.depth,
    });
  }

  // Traverse children if this node has them
  if ('children' in node) {
    const containerNode = node as ChildrenMixin & BaseNode;

    // Build new context with this node's parsed data prepended to ancestors
    const childContext: TraversalContext = {
      ancestorParsed: [parsed, ...context.ancestorParsed],
      depth: context.depth + 1,
    };

    for (const child of containerNode.children) {
      await traverseNode(child, result, childContext);
    }
  }
}

// ============================================================================
// Scope Detection Utilities
// ============================================================================

/**
 * Check if there are currently selected layers.
 *
 * @returns true if at least one layer is selected
 */
export function hasSelection(): boolean {
  return figma.currentPage.selection.length > 0;
}

/**
 * Get the count of currently selected layers.
 *
 * @returns Number of selected layers
 */
export function getSelectionCount(): number {
  return figma.currentPage.selection.length;
}

/**
 * Determine the most appropriate sync scope based on current state.
 *
 * - If layers are selected, suggest 'selection'
 * - Otherwise, default to 'page'
 *
 * @returns Suggested sync scope
 */
export function suggestSyncScope(): SyncScope {
  return hasSelection() ? 'selection' : 'page';
}

// ============================================================================
// Layer Counting Utilities
// ============================================================================

/**
 * Quick count of layers with bindings in a scope.
 * Useful for showing preview counts in UI without full traversal.
 *
 * @param scope - The scope to count in
 * @returns Promise resolving to count of layers with bindings
 */
export async function countBoundLayers(scope: SyncScope): Promise<number> {
  const result = await traverseLayers({ scope });
  return result.layers.length;
}

/**
 * Get layer statistics for a scope.
 * Returns counts of total layers, bound layers, ignored, and skipped components.
 *
 * @param scope - The scope to analyze
 * @returns Promise resolving to TraversalResult with statistics
 */
export async function getLayerStats(scope: SyncScope): Promise<TraversalResult> {
  return traverseLayers({ scope });
}

// ============================================================================
// Traversal Helpers
// ============================================================================

/**
 * Find all repeat frames in a scope.
 * Repeat frames (@# marker) need special handling for layer duplication.
 *
 * @param scope - The scope to search in
 * @returns Promise resolving to array of repeat frame nodes
 */
export async function findRepeatFrames(scope: SyncScope): Promise<SceneNode[]> {
  const result = await traverseLayers({ scope });

  // Filter to layers that are repeat frames
  return result.layers
    .filter(layer => layer.resolvedBinding.isRepeatFrame)
    .map(layer => layer.node);
}

/**
 * Get all unique labels referenced in a scope.
 * Useful for validating that sheet data has all required labels.
 *
 * @param scope - The scope to search in
 * @returns Promise resolving to Set of label names
 */
export async function getReferencedLabels(scope: SyncScope): Promise<Set<string>> {
  const result = await traverseLayers({ scope });
  const labels = new Set<string>();

  for (const layer of result.layers) {
    for (const label of layer.resolvedBinding.labels) {
      labels.add(label);
    }
  }

  return labels;
}

/**
 * Get all unique worksheets referenced in a scope.
 * Useful for validating that sheet data has all required worksheets.
 *
 * @param scope - The scope to search in
 * @returns Promise resolving to Set of worksheet names
 */
export async function getReferencedWorksheets(scope: SyncScope): Promise<Set<string>> {
  const result = await traverseLayers({ scope });
  const worksheets = new Set<string>();

  for (const layer of result.layers) {
    if (layer.resolvedBinding.worksheet) {
      worksheets.add(layer.resolvedBinding.worksheet);
    }
  }

  return worksheets;
}
