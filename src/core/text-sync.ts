/**
 * Text layer content synchronization.
 *
 * Handles applying values from Google Sheets to Figma text layers:
 * - Font loading (required before text modification in Figma)
 * - Mixed font handling (text nodes with multiple fonts)
 * - Multi-label bindings (first label = content, others = properties)
 * - Empty value handling
 * - Special data type prefix (/) for property-only changes
 *
 * Figma requires fonts to be loaded before modifying text content.
 * This module handles all font loading automatically.
 */

import type { SyncError } from './types';

// ============================================================================
// Types
// ============================================================================

/**
 * Result of syncing a text layer.
 */
export interface TextSyncResult {
  /** Whether the sync was successful */
  success: boolean;
  /** Whether the text content was changed */
  contentChanged: boolean;
  /** Error if sync failed */
  error?: SyncError;
  /** Warnings (non-fatal issues) */
  warnings: string[];
}

/**
 * Options for text sync.
 */
export interface TextSyncOptions {
  /** Whether to clear text on empty values (default: true) */
  clearOnEmpty?: boolean;
  /** Additional values from other labels (for special data types) */
  additionalValues?: string[];
}

// ============================================================================
// Font Loading
// ============================================================================

/**
 * Load all fonts used in a text node.
 *
 * This handles both simple text nodes (single font) and mixed font nodes
 * (multiple fonts in different parts of the text).
 *
 * @param node - The text node to load fonts for
 * @returns Promise resolving when all fonts are loaded
 * @throws If a font cannot be loaded
 *
 * @example
 * await loadFontsForTextNode(textNode);
 * textNode.characters = "New content";
 */
export async function loadFontsForTextNode(node: TextNode): Promise<void> {
  // Handle empty text nodes
  if (node.characters.length === 0) {
    // For empty nodes, load the default font
    if (node.fontName !== figma.mixed) {
      await figma.loadFontAsync(node.fontName as FontName);
    }
    return;
  }

  // Check if node has mixed fonts
  if (node.fontName === figma.mixed) {
    // Load all unique fonts used in the text
    await loadMixedFonts(node);
  } else {
    // Single font - simple case
    await figma.loadFontAsync(node.fontName as FontName);
  }
}

/**
 * Load all fonts from a mixed-font text node.
 *
 * Iterates through each character position to find all unique fonts
 * and loads them all.
 *
 * @param node - The text node with mixed fonts
 */
async function loadMixedFonts(node: TextNode): Promise<void> {
  const loadedFonts = new Set<string>();
  const fontsToLoad: FontName[] = [];

  // Collect all unique fonts
  const len = node.characters.length;
  for (let i = 0; i < len; i++) {
    const font = node.getRangeFontName(i, i + 1) as FontName;
    const fontKey = `${font.family}:${font.style}`;

    if (!loadedFonts.has(fontKey)) {
      loadedFonts.add(fontKey);
      fontsToLoad.push(font);
    }
  }

  // Load all fonts in parallel
  await Promise.all(fontsToLoad.map((font) => figma.loadFontAsync(font)));
}

/**
 * Get all unique fonts used in a text node.
 *
 * @param node - The text node to analyze
 * @returns Array of unique FontName objects
 */
export function getFontsInTextNode(node: TextNode): FontName[] {
  if (node.characters.length === 0) {
    if (node.fontName !== figma.mixed) {
      return [node.fontName as FontName];
    }
    return [];
  }

  if (node.fontName !== figma.mixed) {
    return [node.fontName as FontName];
  }

  // Mixed fonts - collect all unique
  const fontSet = new Set<string>();
  const fonts: FontName[] = [];

  const len = node.characters.length;
  for (let i = 0; i < len; i++) {
    const font = node.getRangeFontName(i, i + 1) as FontName;
    const fontKey = `${font.family}:${font.style}`;

    if (!fontSet.has(fontKey)) {
      fontSet.add(fontKey);
      fonts.push(font);
    }
  }

  return fonts;
}

// ============================================================================
// Text Content Sync
// ============================================================================

/**
 * Sync text content to a text layer.
 *
 * This is the main entry point for text layer synchronization.
 * It handles:
 * - Font loading (always done first)
 * - Special data type prefix (/ at start skips text change)
 * - Empty value handling
 * - Multi-label additional values (for properties)
 *
 * @param node - The TextNode to sync
 * @param value - The value to apply (from sheet data)
 * @param options - Sync options
 * @returns Promise resolving to TextSyncResult
 *
 * @example
 * // Basic text sync
 * const result = await syncTextLayer(textNode, "Hello World");
 *
 * @example
 * // With additional values for properties
 * const result = await syncTextLayer(textNode, "Title", {
 *   additionalValues: ["#FF0000", "24px"]
 * });
 */
export async function syncTextLayer(
  node: TextNode,
  value: string,
  options: TextSyncOptions = {}
): Promise<TextSyncResult> {
  const { clearOnEmpty = true, additionalValues = [] } = options;

  const result: TextSyncResult = {
    success: true,
    contentChanged: false,
    warnings: [],
  };

  try {
    // Load fonts first (required before any text modification)
    await loadFontsForTextNode(node);

    // Check if value is a special data type (starts with /)
    // Special data types modify properties, not text content
    if (value.startsWith('/')) {
      // TODO: Handle special data types (TICKET-012+)
      // For now, just log and skip text modification
      result.warnings.push(
        `Special data type "${value}" - property changes not yet implemented`
      );
      return result;
    }

    // Handle empty values
    if (isEmptyValue(value)) {
      if (clearOnEmpty) {
        if (node.characters !== '') {
          node.characters = '';
          result.contentChanged = true;
        }
      }
      // If not clearing on empty, leave existing content
      return result;
    }

    // Set the text content
    if (node.characters !== value) {
      node.characters = value;
      result.contentChanged = true;
    }

    // Process additional values (from multi-label bindings)
    // These are typically special data types for properties
    for (const additionalValue of additionalValues) {
      if (additionalValue && additionalValue.trim()) {
        // TODO: Apply special data types (TICKET-012+)
        result.warnings.push(
          `Additional value "${additionalValue}" - property changes not yet implemented`
        );
      }
    }

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

/**
 * Check if a value is empty or blank.
 *
 * @param value - The value to check
 * @returns true if the value is empty, null, undefined, or whitespace-only
 */
export function isEmptyValue(value: string | null | undefined): boolean {
  if (value === null || value === undefined) {
    return true;
  }
  return value.trim() === '';
}

// ============================================================================
// Batch Text Sync
// ============================================================================

/**
 * Result of a batch text sync operation.
 */
export interface BatchTextSyncResult {
  /** Total number of text layers processed */
  totalProcessed: number;
  /** Number of layers successfully updated */
  successCount: number;
  /** Number of layers that failed */
  failureCount: number;
  /** Number of layers where content actually changed */
  changedCount: number;
  /** Errors from failed syncs */
  errors: SyncError[];
  /** All warnings */
  warnings: string[];
}

/**
 * Entry for batch text sync.
 */
export interface TextSyncEntry {
  /** The text node to sync */
  node: TextNode;
  /** The value to apply */
  value: string;
  /** Additional values from multi-label bindings */
  additionalValues?: string[];
}

/**
 * Sync multiple text layers in batch.
 *
 * Processes all text layers, collecting results and errors.
 *
 * @param entries - Array of text sync entries
 * @param options - Options applying to all entries
 * @returns Promise resolving to BatchTextSyncResult
 *
 * @example
 * const entries = [
 *   { node: textNode1, value: "Title" },
 *   { node: textNode2, value: "Description" },
 * ];
 * const result = await batchSyncTextLayers(entries);
 * console.log(`Updated ${result.changedCount} layers`);
 */
export async function batchSyncTextLayers(
  entries: TextSyncEntry[],
  options: Omit<TextSyncOptions, 'additionalValues'> = {}
): Promise<BatchTextSyncResult> {
  const result: BatchTextSyncResult = {
    totalProcessed: entries.length,
    successCount: 0,
    failureCount: 0,
    changedCount: 0,
    errors: [],
    warnings: [],
  };

  for (const entry of entries) {
    const syncResult = await syncTextLayer(entry.node, entry.value, {
      ...options,
      additionalValues: entry.additionalValues,
    });

    if (syncResult.success) {
      result.successCount++;
      if (syncResult.contentChanged) {
        result.changedCount++;
      }
    } else {
      result.failureCount++;
      if (syncResult.error) {
        result.errors.push(syncResult.error);
      }
    }

    result.warnings.push(...syncResult.warnings);
  }

  return result;
}

// ============================================================================
// Font Error Handling
// ============================================================================

/**
 * Try to load a font, falling back gracefully on failure.
 *
 * @param font - The font to load
 * @returns Promise resolving to true if loaded, false if failed
 */
export async function tryLoadFont(font: FontName): Promise<boolean> {
  try {
    await figma.loadFontAsync(font);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a font is available.
 *
 * Note: This still attempts to load the font, as Figma doesn't provide
 * a way to check font availability without loading.
 *
 * @param font - The font to check
 * @returns Promise resolving to true if font is available
 */
export async function isFontAvailable(font: FontName): Promise<boolean> {
  return tryLoadFont(font);
}
