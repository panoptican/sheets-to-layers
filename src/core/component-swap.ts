/**
 * Component instance swapping for Figma layers.
 *
 * Handles swapping component instances to different components based on
 * sheet values:
 * - Find components by name within sync scope
 * - Support variant syntax (Property=Value, Property=Value)
 * - Preserve overrides when swapping
 * - Case-insensitive name matching
 *
 * Components are cached during sync to avoid repeated traversals.
 */

import type { SyncError, ComponentCache, SyncScope } from './types';

// ============================================================================
// Types
// ============================================================================

/**
 * Result of swapping a component instance.
 */
export interface ComponentSwapResult {
  /** Whether the swap was successful */
  success: boolean;
  /** Whether the component was actually changed */
  componentChanged: boolean;
  /** Error if swap failed */
  error?: SyncError;
  /** Warnings (non-fatal issues) */
  warnings: string[];
}

/**
 * Options for component swap.
 */
export interface ComponentSwapOptions {
  /** Pre-built component cache (to avoid rebuilding) */
  componentCache?: ComponentCache;
}

/**
 * Parsed variant properties.
 */
export interface VariantProperties {
  /** Map of property name to value */
  properties: Map<string, string>;
  /** Original string representation */
  original: string;
}

// ============================================================================
// Name Normalization
// ============================================================================

/**
 * Normalize a component name for case-insensitive comparison.
 *
 * Preserves spaces and punctuation, only lowercases.
 *
 * @param name - The component name to normalize
 * @returns Normalized name
 *
 * @example
 * normalizeComponentName('Button/Primary')  // 'button/primary'
 * normalizeComponentName('Size=Large')      // 'size=large'
 */
export function normalizeComponentName(name: string): string {
  return name.toLowerCase().trim();
}

// ============================================================================
// Variant Syntax Detection & Parsing
// ============================================================================

/**
 * Check if a value uses variant syntax.
 *
 * Variant syntax: "Property=Value" or "Property=Value, Property=Value"
 * URLs (starting with http) are NOT variant syntax.
 *
 * @param value - The value to check
 * @returns true if the value looks like variant syntax
 *
 * @example
 * isVariantSyntax('Size=Large')                    // true
 * isVariantSyntax('Size=Large, Color=Primary')    // true
 * isVariantSyntax('https://example.com?foo=bar')  // false
 * isVariantSyntax('Button')                       // false
 */
export function isVariantSyntax(value: string): boolean {
  if (!value || typeof value !== 'string') {
    return false;
  }
  const trimmed = value.trim();
  // URLs are not variant syntax
  if (trimmed.toLowerCase().startsWith('http://') || trimmed.toLowerCase().startsWith('https://')) {
    return false;
  }
  // Must contain = and look like Property=Value
  return /^[^=]+=.+$/.test(trimmed);
}

/**
 * Parse variant properties from a string.
 *
 * Format: "Property=Value, Property=Value"
 *
 * @param value - The variant string to parse
 * @returns Parsed variant properties
 *
 * @example
 * parseVariantProperties('Size=Large, Color=Primary')
 * // { properties: Map { 'size' => 'Large', 'color' => 'Primary' }, original: '...' }
 */
export function parseVariantProperties(value: string): VariantProperties {
  const properties = new Map<string, string>();
  const original = value.trim();

  // Split by comma, handling spaces
  const pairs = original.split(',').map((p) => p.trim()).filter(Boolean);

  for (const pair of pairs) {
    const eqIndex = pair.indexOf('=');
    if (eqIndex > 0) {
      const propName = pair.slice(0, eqIndex).trim();
      const propValue = pair.slice(eqIndex + 1).trim();
      if (propName && propValue) {
        // Normalize property name (lowercase) but preserve value case
        properties.set(propName.toLowerCase(), propValue);
      }
    }
  }

  return { properties, original };
}

/**
 * Build a variant name string from properties.
 *
 * Figma variant names are typically: "Property1=Value1, Property2=Value2"
 *
 * @param properties - Map of property names to values
 * @returns Variant name string
 */
export function buildVariantName(properties: Map<string, string>): string {
  const parts: string[] = [];
  for (const [prop, value] of properties) {
    parts.push(`${prop}=${value}`);
  }
  return parts.join(', ');
}

// ============================================================================
// Component Cache Building
// ============================================================================

/**
 * Build a cache of components within the given scope.
 *
 * Traverses the node tree to find:
 * - ComponentNode instances (main components)
 * - ComponentSetNode instances (variant containers)
 * - Components from InstanceNode main components
 *
 * @param scopeNodes - The root nodes to search within
 * @returns Promise resolving to ComponentCache
 *
 * @example
 * const cache = await buildComponentCache([figma.currentPage]);
 * const button = cache.components.get('button');
 */
export async function buildComponentCache(scopeNodes: readonly SceneNode[]): Promise<ComponentCache> {
  const cache: ComponentCache = {
    components: new Map(),
    componentSets: new Map(),
  };

  async function findComponents(node: BaseNode): Promise<void> {
    if (node.type === 'COMPONENT') {
      const comp = node as ComponentNode;
      const normalizedName = normalizeComponentName(comp.name);
      // Don't overwrite if already exists (first found wins)
      if (!cache.components.has(normalizedName)) {
        cache.components.set(normalizedName, comp);
      }
    } else if (node.type === 'COMPONENT_SET') {
      const set = node as ComponentSetNode;
      const normalizedName = normalizeComponentName(set.name);
      if (!cache.componentSets.has(normalizedName)) {
        cache.componentSets.set(normalizedName, set);
      }
      // Also cache individual variants
      for (const child of set.children) {
        if (child.type === 'COMPONENT') {
          const variantComp = child as ComponentNode;
          const variantName = normalizeComponentName(variantComp.name);
          if (!cache.components.has(variantName)) {
            cache.components.set(variantName, variantComp);
          }
        }
      }
    } else if (node.type === 'INSTANCE') {
      // Include main component from instances (so we can find used components)
      const instance = node as InstanceNode;
      const mainComponent = await instance.getMainComponentAsync();
      if (mainComponent) {
        const mainCompName = normalizeComponentName(mainComponent.name);
        if (!cache.components.has(mainCompName)) {
          cache.components.set(mainCompName, mainComponent);
        }
      }
    }

    // Recurse into children
    if ('children' in node) {
      const container = node as ChildrenMixin;
      for (const child of container.children) {
        await findComponents(child);
      }
    }
  }

  for (const node of scopeNodes) {
    await findComponents(node);
  }

  return cache;
}

/**
 * Build component cache based on sync scope.
 *
 * @param scope - The sync scope
 * @returns Promise resolving to ComponentCache
 */
export async function buildComponentCacheForScope(scope: SyncScope): Promise<ComponentCache> {
  let scopeNodes: readonly SceneNode[];

  switch (scope) {
    case 'document':
      // For document scope, we need to load all pages
      scopeNodes = [];
      for (const page of figma.root.children) {
        await page.loadAsync();
        scopeNodes = [...scopeNodes, ...page.children];
      }
      break;
    case 'page':
      scopeNodes = figma.currentPage.children;
      break;
    case 'selection':
      scopeNodes = figma.currentPage.selection;
      break;
  }

  return await buildComponentCache(scopeNodes);
}

// ============================================================================
// Component Finding
// ============================================================================

/**
 * Find a component by name in the cache.
 *
 * @param name - The component name to find
 * @param cache - The component cache
 * @returns The component if found, undefined otherwise
 */
export function findComponentByName(
  name: string,
  cache: ComponentCache
): ComponentNode | undefined {
  const normalizedName = normalizeComponentName(name);
  return cache.components.get(normalizedName);
}

/**
 * Find a component set by name in the cache.
 *
 * @param name - The component set name to find
 * @param cache - The component cache
 * @returns The component set if found, undefined otherwise
 */
export function findComponentSetByName(
  name: string,
  cache: ComponentCache
): ComponentSetNode | undefined {
  const normalizedName = normalizeComponentName(name);
  return cache.componentSets.get(normalizedName);
}

/**
 * Find a variant component by property values.
 *
 * Searches through all components in the cache to find one that matches
 * the given variant properties.
 *
 * @param properties - The variant properties to match
 * @param cache - The component cache
 * @returns The matching component if found
 */
export function findVariantComponent(
  properties: Map<string, string>,
  cache: ComponentCache
): ComponentNode | undefined {
  // Build a normalized search string
  const searchParts: string[] = [];
  for (const [prop, value] of properties) {
    searchParts.push(`${prop.toLowerCase()}=${value.toLowerCase()}`);
  }
  searchParts.sort(); // Sort for consistent matching

  // Search through all components
  for (const [normalizedName, component] of cache.components) {
    // Parse the component name as variant properties
    if (normalizedName.includes('=')) {
      const compProps = parseVariantProperties(normalizedName);
      const compParts: string[] = [];
      for (const [prop, value] of compProps.properties) {
        compParts.push(`${prop}=${value.toLowerCase()}`);
      }
      compParts.sort();

      // Check if all search properties are in the component
      const matches = searchParts.every((sp) => compParts.includes(sp));
      if (matches) {
        return component;
      }
    }
  }

  return undefined;
}

// ============================================================================
// Component Swapping
// ============================================================================

/**
 * Check if a node can have its component swapped.
 *
 * @param node - The node to check
 * @returns true if the node is an InstanceNode
 */
export function canSwapComponent(node: SceneNode): boolean {
  return node.type === 'INSTANCE';
}

/**
 * Swap a component instance to a different component.
 *
 * This function handles:
 * - Direct component name lookup
 * - Variant syntax (Property=Value)
 * - Override preservation (via swapComponent API)
 *
 * @param node - The InstanceNode to swap
 * @param componentName - The target component name or variant syntax
 * @param cache - The component cache
 * @returns ComponentSwapResult
 *
 * @example
 * // Swap to named component
 * const result = swapComponent(instanceNode, 'Button/Primary', cache);
 *
 * // Swap using variant syntax
 * const result = swapComponent(instanceNode, 'Size=Large, Color=Primary', cache);
 */
export async function swapComponent(
  node: SceneNode,
  componentName: string,
  cache: ComponentCache
): Promise<ComponentSwapResult> {
  const result: ComponentSwapResult = {
    success: true,
    componentChanged: false,
    warnings: [],
  };

  // Validate node type
  if (!canSwapComponent(node)) {
    result.success = false;
    result.error = {
      layerName: node.name,
      layerId: node.id,
      error: `Cannot swap component on ${node.type} layer. Only INSTANCE nodes can be swapped.`,
    };
    return result;
  }

  const instance = node as InstanceNode;
  const trimmedName = componentName.trim();

  if (!trimmedName) {
    result.success = false;
    result.error = {
      layerName: node.name,
      layerId: node.id,
      error: 'Component name is empty',
    };
    return result;
  }

  try {
    let targetComponent: ComponentNode | undefined;

    // Check if using variant syntax
    if (isVariantSyntax(trimmedName)) {
      const variantProps = parseVariantProperties(trimmedName);
      targetComponent = findVariantComponent(variantProps.properties, cache);

      if (!targetComponent) {
        // Try direct name lookup as fallback
        targetComponent = findComponentByName(trimmedName, cache);
      }

      if (!targetComponent) {
        result.success = false;
        result.error = {
          layerName: node.name,
          layerId: node.id,
          error: `Variant not found: "${trimmedName}"`,
        };
        return result;
      }
    } else {
      // Direct component name lookup
      targetComponent = findComponentByName(trimmedName, cache);

      if (!targetComponent) {
        result.success = false;
        result.error = {
          layerName: node.name,
          layerId: node.id,
          error: `Component not found: "${trimmedName}"`,
        };
        return result;
      }
    }

    // Check if already using this component
    const currentMainComponent = await instance.getMainComponentAsync();
    if (currentMainComponent?.id === targetComponent.id) {
      // No change needed
      return result;
    }

    // Perform the swap (preserves overrides)
    instance.swapComponent(targetComponent);
    result.componentChanged = true;

    return result;
  } catch (error) {
    result.success = false;
    result.error = {
      layerName: node.name,
      layerId: node.id,
      error: error instanceof Error ? error.message : String(error),
    };
    return result;
  }
}

// ============================================================================
// Batch Processing
// ============================================================================

/**
 * Result of a batch component swap operation.
 */
export interface BatchComponentSwapResult {
  /** Total number of instances processed */
  totalProcessed: number;
  /** Number of instances successfully swapped */
  successCount: number;
  /** Number of instances that failed */
  failureCount: number;
  /** Number of instances where component actually changed */
  changedCount: number;
  /** Errors from failed swaps */
  errors: SyncError[];
  /** All warnings */
  warnings: string[];
}

/**
 * Entry for batch component swap.
 */
export interface ComponentSwapEntry {
  /** The instance node to swap */
  node: SceneNode;
  /** The target component name or variant syntax */
  componentName: string;
}

/**
 * Swap multiple component instances in batch.
 *
 * @param entries - Array of swap entries
 * @param cache - The component cache
 * @returns BatchComponentSwapResult
 */
export async function batchSwapComponents(
  entries: ComponentSwapEntry[],
  cache: ComponentCache
): Promise<BatchComponentSwapResult> {
  const result: BatchComponentSwapResult = {
    totalProcessed: entries.length,
    successCount: 0,
    failureCount: 0,
    changedCount: 0,
    errors: [],
    warnings: [],
  };

  for (const entry of entries) {
    const swapResult = await swapComponent(entry.node, entry.componentName, cache);

    if (swapResult.success) {
      result.successCount++;
      if (swapResult.componentChanged) {
        result.changedCount++;
      }
    } else {
      result.failureCount++;
      if (swapResult.error) {
        result.errors.push(swapResult.error);
      }
    }

    result.warnings.push(...swapResult.warnings);
  }

  return result;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get the current component name for an instance.
 *
 * @param instance - The instance node
 * @returns The main component name or undefined
 */
export async function getCurrentComponentName(instance: InstanceNode): Promise<string | undefined> {
  const mainComponent = await instance.getMainComponentAsync();
  return mainComponent?.name;
}

/**
 * Check if two component names match (case-insensitive).
 *
 * @param name1 - First component name
 * @param name2 - Second component name
 * @returns true if the names match
 */
export function componentNamesMatch(name1: string, name2: string): boolean {
  return normalizeComponentName(name1) === normalizeComponentName(name2);
}

/**
 * Get statistics about the component cache.
 *
 * @param cache - The component cache
 * @returns Object with counts
 */
export function getComponentCacheStats(cache: ComponentCache): {
  componentCount: number;
  componentSetCount: number;
} {
  return {
    componentCount: cache.components.size,
    componentSetCount: cache.componentSets.size,
  };
}
