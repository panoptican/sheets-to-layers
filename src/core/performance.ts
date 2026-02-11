/**
 * Performance optimization utilities for Sheets Sync plugin.
 *
 * Provides:
 * - Batched font loading with deduplication
 * - Chunked processing with UI thread yielding
 * - Progress reporting utilities
 */

import type { LayerToProcess } from './types';

// ============================================================================
// Types
// ============================================================================

/**
 * Font key for deduplication (family::style format).
 */
type FontKey = string;

/** Global cache of fonts loaded during the current sync session. */
const globalLoadedFontCache = new Set<FontKey>();

/**
 * Progress callback function type.
 */
export type ProgressCallback = (message: string, percent: number) => void;

/**
 * Options for chunked processing.
 */
export interface ChunkProcessingOptions {
  /** Number of items to process per chunk (default: 50) */
  chunkSize?: number;
  /** Callback for progress updates */
  onProgress?: ProgressCallback;
  /** Base progress percentage to start from (default: 0) */
  progressStart?: number;
  /** Progress percentage range to use (default: 100) */
  progressRange?: number;
  /** Label for progress messages (default: 'Processing') */
  progressLabel?: string;
}

/**
 * Result of batched font loading.
 */
export interface FontLoadResult {
  /** Successfully loaded font keys */
  loaded: Set<FontKey>;
  /** Font keys that failed to load */
  failed: Set<FontKey>;
  /** Total fonts attempted */
  total: number;
  /** Layer IDs that have missing fonts (cannot be modified) */
  layersWithMissingFonts: string[];
}

// ============================================================================
// Font Loading
// ============================================================================

/**
 * Reset global font cache between sync sessions.
 */
export function resetGlobalFontCache(): void {
  globalLoadedFontCache.clear();
}

/**
 * Create a font key from family and style.
 */
function createFontKey(family: string, style: string): FontKey {
  return `${family}::${style}`;
}

/**
 * Parse a font key into family and style.
 */
function parseFontKey(key: FontKey): { family: string; style: string } {
  const [family, style] = key.split('::');
  return { family, style };
}

/**
 * Result of collecting fonts from layers.
 */
interface CollectFontsResult {
  /** Unique font keys needed */
  fonts: Set<FontKey>;
  /** Layer IDs that have missing fonts */
  layersWithMissingFonts: string[];
}

/**
 * Collect all unique fonts needed for a set of text layers.
 *
 * Also identifies layers with missing fonts (fonts not installed on the
 * user's system). These layers cannot be modified - Figma stores a path
 * for rendering but the font cannot be loaded.
 *
 * @param layers - Layers to process (filters to TEXT nodes internally)
 * @returns Object with fonts to load and layers with missing fonts
 */
export function collectFontsFromLayers(layers: LayerToProcess[]): CollectFontsResult {
  const fonts = new Set<FontKey>();
  const layersWithMissingFonts: string[] = [];

  for (const layer of layers) {
    if (layer.node.type !== 'TEXT') continue;

    const textNode = layer.node as TextNode;

    // Check for missing fonts first (per Figma docs)
    // Missing fonts are fonts the user doesn't have installed
    if (textNode.hasMissingFont) {
      layersWithMissingFonts.push(textNode.id);
      // Don't try to collect fonts from this node - they can't be loaded
      continue;
    }

    // Handle empty text nodes
    if (textNode.characters.length === 0) {
      if (textNode.fontName !== figma.mixed) {
        const font = textNode.fontName as FontName;
        fonts.add(createFontKey(font.family, font.style));
      }
      continue;
    }

    // Check if node has mixed fonts
    if (textNode.fontName === figma.mixed) {
      // Collect all unique fonts from mixed-font text
      const len = textNode.characters.length;
      for (let i = 0; i < len; i++) {
        const font = textNode.getRangeFontName(i, i + 1) as FontName;
        fonts.add(createFontKey(font.family, font.style));
      }
    } else {
      // Single font
      const font = textNode.fontName as FontName;
      fonts.add(createFontKey(font.family, font.style));
    }
  }

  return { fonts, layersWithMissingFonts };
}

/**
 * Load all fonts in parallel with deduplication.
 *
 * This is more efficient than loading fonts per-layer because:
 * 1. Each unique font is loaded only once
 * 2. All loads happen in parallel
 * 3. Failed fonts don't block other fonts
 *
 * Also identifies layers with missing fonts (fonts not installed on user's
 * system) - these layers cannot be modified during sync.
 *
 * @param layers - Layers to load fonts for
 * @param onProgress - Optional progress callback
 * @returns Result with loaded fonts, failed fonts, and layers with missing fonts
 */
export async function loadFontsForLayers(
  layers: LayerToProcess[],
  onProgress?: ProgressCallback
): Promise<FontLoadResult> {
  const { fonts: fontsNeeded, layersWithMissingFonts } = collectFontsFromLayers(layers);
  const fontsToLoad = new Set(
    Array.from(fontsNeeded).filter((fontKey) => !globalLoadedFontCache.has(fontKey))
  );
  const loaded = new Set<FontKey>();
  const failed = new Set<FontKey>();

  // Log warning about missing fonts
  if (layersWithMissingFonts.length > 0) {
    console.warn(
      `[Performance] ${layersWithMissingFonts.length} text layer(s) have missing fonts and will be skipped`
    );
  }

  if (fontsToLoad.size === 0) {
    return { loaded, failed, total: 0, layersWithMissingFonts };
  }

  onProgress?.(`Loading ${fontsToLoad.size} fonts...`, 0);

  // Load all fonts in parallel
  const loadPromises: Promise<void>[] = [];
  let completed = 0;

  for (const fontKey of fontsToLoad) {
    const { family, style } = parseFontKey(fontKey);

    const loadPromise = figma
      .loadFontAsync({ family, style })
      .then(() => {
        loaded.add(fontKey);
        globalLoadedFontCache.add(fontKey);
      })
      .catch((err) => {
        console.warn(`[Performance] Failed to load font: ${fontKey}`, err);
        failed.add(fontKey);
      })
      .finally(() => {
        completed++;
        if (onProgress && fontsToLoad.size > 0) {
          const percent = Math.floor((completed / fontsToLoad.size) * 100);
          onProgress(`Loading fonts (${completed}/${fontsToLoad.size})...`, percent);
        }
      });

    loadPromises.push(loadPromise);
  }

  await Promise.all(loadPromises);

  return { loaded, failed, total: fontsToLoad.size, layersWithMissingFonts };
}

// ============================================================================
// Chunked Processing
// ============================================================================

/**
 * Yield to the UI thread to prevent freezing.
 *
 * This uses setTimeout(0) which allows the browser event loop
 * to process other events (like progress updates).
 */
export function yieldToUI(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Process items in chunks with progress reporting and UI yielding.
 *
 * This prevents the UI from freezing during long operations by:
 * 1. Processing in batches of chunkSize items
 * 2. Yielding to the UI thread between chunks
 * 3. Reporting progress after each chunk
 *
 * @param items - Items to process
 * @param processor - Async function to process each item
 * @param options - Processing options
 * @returns Promise resolving when all items are processed
 */
export async function processInChunks<T, R>(
  items: T[],
  processor: (item: T, index: number) => Promise<R>,
  options: ChunkProcessingOptions = {}
): Promise<R[]> {
  const {
    chunkSize = 50,
    onProgress,
    progressStart = 0,
    progressRange = 100,
    progressLabel = 'Processing',
  } = options;

  const total = items.length;
  const results: R[] = [];

  if (total === 0) {
    return results;
  }

  for (let i = 0; i < total; i += chunkSize) {
    const chunkEnd = Math.min(i + chunkSize, total);
    const chunk = items.slice(i, chunkEnd);

    // Process chunk items sequentially (to maintain order and handle errors gracefully)
    for (let j = 0; j < chunk.length; j++) {
      const globalIndex = i + j;
      const result = await processor(chunk[j], globalIndex);
      results.push(result);
    }

    // Report progress
    if (onProgress) {
      const chunkProgress = chunkEnd / total;
      const percent = progressStart + Math.floor(chunkProgress * progressRange);
      onProgress(`${progressLabel} (${chunkEnd}/${total})...`, percent);
    }

    // Yield to UI thread between chunks (but not after the last chunk)
    if (chunkEnd < total) {
      await yieldToUI();
    }
  }

  return results;
}

/**
 * Process items in parallel chunks with progress reporting.
 *
 * Similar to processInChunks but processes items within each chunk
 * in parallel for better performance when items are independent.
 *
 * @param items - Items to process
 * @param processor - Async function to process each item
 * @param options - Processing options
 * @returns Promise resolving when all items are processed
 */
export async function processInParallelChunks<T, R>(
  items: T[],
  processor: (item: T, index: number) => Promise<R>,
  options: ChunkProcessingOptions = {}
): Promise<R[]> {
  const {
    chunkSize = 50,
    onProgress,
    progressStart = 0,
    progressRange = 100,
    progressLabel = 'Processing',
  } = options;

  const total = items.length;
  const results: R[] = new Array(total);

  if (total === 0) {
    return results;
  }

  for (let i = 0; i < total; i += chunkSize) {
    const chunkEnd = Math.min(i + chunkSize, total);
    const chunk = items.slice(i, chunkEnd);

    // Process chunk items in parallel
    const chunkResults = await Promise.all(
      chunk.map((item, j) => processor(item, i + j))
    );

    // Store results in correct positions
    for (let j = 0; j < chunkResults.length; j++) {
      results[i + j] = chunkResults[j];
    }

    // Report progress
    if (onProgress) {
      const chunkProgress = chunkEnd / total;
      const percent = progressStart + Math.floor(chunkProgress * progressRange);
      onProgress(`${progressLabel} (${chunkEnd}/${total})...`, percent);
    }

    // Yield to UI thread between chunks
    if (chunkEnd < total) {
      await yieldToUI();
    }
  }

  return results;
}

// ============================================================================
// Performance Measurement
// ============================================================================

/**
 * Simple performance timer for debugging.
 */
export class PerfTimer {
  private startTime: number;
  private marks: Map<string, number> = new Map();

  constructor() {
    this.startTime = Date.now();
  }

  /**
   * Mark a checkpoint.
   */
  mark(name: string): void {
    this.marks.set(name, Date.now() - this.startTime);
  }

  /**
   * Get time since start in milliseconds.
   */
  elapsed(): number {
    return Date.now() - this.startTime;
  }

  /**
   * Get all marks as a formatted string.
   */
  report(): string {
    const lines: string[] = [];
    for (const [name, time] of this.marks) {
      lines.push(`${name}: ${time}ms`);
    }
    lines.push(`Total: ${this.elapsed()}ms`);
    return lines.join('\n');
  }

  /**
   * Log the report to console.
   */
  log(label: string = 'Performance'): void {
    console.log(`[${label}]\n${this.report()}`);
  }
}
