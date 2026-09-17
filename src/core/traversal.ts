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

import type { ParsedLayerName, LayerToProcess, TraversalOptions, SyncScope, ComponentCache } from './types';
import { parseLayerName, resolveInheritedParsedName } from './parser';
import { normalizeComponentName, cacheComponent } from './component-swap';

export interface RootedTraversalOptions extends TraversalOptions {
  rootIds?: readonly string[];
  pageId?: string;
  signal?: { readonly aborted: boolean };
}

export interface ScopeRoots {
  scope: SyncScope;
  rootIds: string[];
  pageId?: string;
}

function isAncestorOf(ancestor: BaseNode, node: BaseNode): boolean {
  let parent = node.parent;
  while (parent) {
    if (parent.id === ancestor.id) return true;
    parent = parent.parent;
  }
  return false;
}

/** Capture roots before fetching so later selection or page changes cannot redirect a run. */
export function captureScopeRoots(scope: SyncScope): ScopeRoots {
  if (scope === 'document') {
    return { scope, rootIds: figma.root.children.map((page) => page.id) };
  }
  if (scope === 'page') {
    return { scope, rootIds: [figma.currentPage.id], pageId: figma.currentPage.id };
  }
  const roots: SceneNode[] = [];
  for (const node of figma.currentPage.selection) {
    if (roots.some((root) => root.id === node.id || isAncestorOf(root, node))) continue;
    for (let i = roots.length - 1; i >= 0; i--) {
      if (isAncestorOf(node, roots[i])) roots.splice(i, 1);
    }
    roots.push(node);
  }
  return { scope, rootIds: roots.map((node) => node.id) };
}

async function resolveRoots(options: RootedTraversalOptions): Promise<{ roots: BaseNode[]; missingRootIds: string[] }> {
  if (options.rootIds === undefined) {
    const roots: BaseNode[] = options.scope === 'document'
      ? [...figma.root.children]
      : options.scope === 'page'
        ? [figma.currentPage]
        : [...figma.currentPage.selection];
    for (const node of roots) {
      if (node.type === 'PAGE') await (node as PageNode).loadAsync();
    }
    return { roots, missingRootIds: [] };
  }
  const ids = options.rootIds;
  const roots: BaseNode[] = [];
  const missingRootIds: string[] = [];
  for (const id of ids) {
    if (options.signal?.aborted) break;
    const node = await figma.getNodeByIdAsync(id);
    if (!node || (options.scope !== 'selection' && node.type !== 'PAGE') ||
      (options.scope === 'selection' && (node.type === 'PAGE' || node.type === 'DOCUMENT'))) {
      missingRootIds.push(id);
      continue;
    }
    if (node.type === 'PAGE') await (node as PageNode).loadAsync();
    roots.push(node);
  }
  return { roots, missingRootIds };
}

function ancestorContext(node: BaseNode): TraversalContext {
  const ancestorParsed: ParsedLayerName[] = [];
  let parent = node.parent;
  while (parent && parent.type !== 'DOCUMENT') {
    if (parent.type !== 'PAGE') ancestorParsed.push(parseLayerName(parent.name));
    parent = parent.parent;
  }
  return { ancestorParsed, depth: ancestorParsed.length };
}

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
  missingRootIds?: string[];
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
export async function traverseLayers(options: RootedTraversalOptions): Promise<TraversalResult> {
  const result: TraversalResult = {
    layers: [],
    layersExamined: 0,
    layersIgnored: 0,
    componentsSkipped: 0,
  };

  const resolved = await resolveRoots(options);
  result.missingRootIds = resolved.missingRootIds;
  for (const node of resolved.roots) {
    const context = ancestorContext(node);
    if (!context.ancestorParsed.some((parsed) => parsed.isIgnored)) {
      await traverseNode(node, result, context);
    }
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

// ============================================================================
// Single-Pass Traversal (Performance Optimized)
// ============================================================================

/**
 * Result of single-pass traversal.
 * Collects all needed data in one traversal for better performance.
 */
export interface SinglePassTraversalResult extends TraversalResult {
  /** Frames with @# marker for repeat processing */
  repeatFrames: FrameNode[];
  /** Inherited worksheet/index context for each repeat frame. */
  repeatBindings: Map<string, ParsedLayerName>;
  /** Pre-built component cache */
  componentCache: ComponentCache;
  /** Set of unique labels referenced */
  referencedLabels: Set<string>;
  /** Set of unique worksheets referenced */
  referencedWorksheets: Set<string>;
}

/**
 * Perform a single-pass traversal that collects everything needed for sync.
 *
 * This is more efficient than multiple traversals because:
 * 1. Only walks the tree once
 * 2. Collects layers, repeat frames, and component cache simultaneously
 * 3. Builds label/worksheet sets for validation
 *
 * Use this instead of separate calls to:
 * - traverseLayers()
 * - findRepeatFrames()
 * - buildComponentCacheForScope()
 * - getReferencedLabels()
 * - getReferencedWorksheets()
 *
 * @param options - Traversal options specifying the scope
 * @returns Promise resolving to SinglePassTraversalResult
 */
export async function singlePassTraversal(options: RootedTraversalOptions): Promise<SinglePassTraversalResult> {
  const result: SinglePassTraversalResult = {
    layers: [],
    layersExamined: 0,
    layersIgnored: 0,
    componentsSkipped: 0,
    repeatFrames: [],
    repeatBindings: new Map(),
    componentCache: {
      components: new Map(),
      componentSets: new Map(),
    },
    referencedLabels: new Set(),
    referencedWorksheets: new Set(),
  };

  const resolved = await resolveRoots(options);
  result.missingRootIds = resolved.missingRootIds;
  for (const node of resolved.roots) {
    const context = ancestorContext(node);
    if (!context.ancestorParsed.some((parsed) => parsed.isIgnored)) {
      await singlePassTraverseNode(node, result, context);
    }
  }

  return result;
}

/**
 * Single-pass recursive traversal that collects all data.
 */
async function singlePassTraverseNode(
  node: BaseNode,
  result: SinglePassTraversalResult,
  context: TraversalContext
): Promise<void> {
  // Skip document nodes - just process their children
  if (node.type === 'DOCUMENT') {
    for (const child of (node as DocumentNode).children) {
      await singlePassTraverseNode(child, result, context);
    }
    return;
  }

  // Skip page nodes - just process their children
  if (node.type === 'PAGE') {
    for (const child of (node as PageNode).children) {
      await singlePassTraverseNode(child, result, context);
    }
    return;
  }

  // Collect component cache entries
  if (node.type === 'COMPONENT') {
    const comp = node as ComponentNode;
    cacheComponent(result.componentCache, comp);
  } else if (node.type === 'COMPONENT_SET') {
    const set = node as ComponentSetNode;
    const normalizedName = normalizeComponentName(set.name);
    if (!result.componentCache.componentSets.has(normalizedName)) {
      result.componentCache.componentSets.set(normalizedName, set);
    }
    // Also cache individual variants
    for (const child of set.children) {
      if (child.type === 'COMPONENT') {
        const variantComp = child as ComponentNode;
        cacheComponent(result.componentCache, variantComp);
      }
    }
  } else if (node.type === 'INSTANCE') {
    // Include main component from instances
    const instance = node as InstanceNode;
    const mainComponent = await instance.getMainComponentAsync();
    if (mainComponent) {
      cacheComponent(result.componentCache, mainComponent);
    }
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

  if (node.type === 'FRAME' && parsed.isRepeatFrame) {
    result.repeatFrames.push(node as FrameNode);
    result.repeatBindings.set(node.id, resolvedBinding);
  }

  // If this layer has a binding, add it to the result
  if (parsed.hasBinding) {
    result.layers.push({
      node: node as SceneNode,
      resolvedBinding,
      depth: context.depth,
    });

    // Collect referenced labels and worksheets
    for (const label of resolvedBinding.labels) {
      result.referencedLabels.add(label);
    }
    if (resolvedBinding.worksheet) {
      result.referencedWorksheets.add(resolvedBinding.worksheet);
    }
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
      await singlePassTraverseNode(child, result, childContext);
    }
  }
}
