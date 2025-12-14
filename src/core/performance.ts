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
}

// ============================================================================
// Font Loading
// ============================================================================

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
 * Collect all unique fonts needed for a set of text layers.
 *
 * @param layers - Layers to process (filters to TEXT nodes internally)
 * @returns Set of font keys needed
 */
export function collectFontsFromLayers(layers: LayerToProcess[]): Set<FontKey> {
  const fonts = new Set<FontKey>();

  for (const layer of layers) {
    if (layer.node.type !== 'TEXT') continue;

    const textNode = layer.node as TextNode;

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

  return fonts;
}

/**
 * Load all fonts in parallel with deduplication.
 *
 * This is more efficient than loading fonts per-layer because:
 * 1. Each unique font is loaded only once
 * 2. All loads happen in parallel
 * 3. Failed fonts don't block other fonts
 *
 * @param layers - Layers to load fonts for
 * @param onProgress - Optional progress callback
 * @returns Result with loaded and failed font sets
 */
export async function loadFontsForLayers(
  layers: LayerToProcess[],
  onProgress?: ProgressCallback
): Promise<FontLoadResult> {
  const fontsNeeded = collectFontsFromLayers(layers);
  const loaded = new Set<FontKey>();
  const failed = new Set<FontKey>();

  if (fontsNeeded.size === 0) {
    return { loaded, failed, total: 0 };
  }

  onProgress?.(`Loading ${fontsNeeded.size} fonts...`, 0);

  // Load all fonts in parallel
  const loadPromises: Promise<void>[] = [];
  let completed = 0;

  for (const fontKey of fontsNeeded) {
    const { family, style } = parseFontKey(fontKey);

    const loadPromise = figma
      .loadFontAsync({ family, style })
      .then(() => {
        loaded.add(fontKey);
      })
      .catch((err) => {
        console.warn(`[Performance] Failed to load font: ${fontKey}`, err);
        failed.add(fontKey);
      })
      .finally(() => {
        completed++;
        if (onProgress && fontsNeeded.size > 0) {
          const percent = Math.floor((completed / fontsNeeded.size) * 100);
          onProgress(`Loading fonts (${completed}/${fontsNeeded.size})...`, percent);
        }
      });

    loadPromises.push(loadPromise);
  }

  await Promise.all(loadPromises);

  return { loaded, failed, total: fontsNeeded.size };
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
