/**
 * Index tracking for sheet data synchronization.
 *
 * Manages which row's value to use for each label binding.
 * Handles auto-increment counters, specific indices, random selection,
 * and blank-skipping modes.
 *
 * Index Modes:
 * - specific: Use exact row number (1-based in user syntax → 0-based internally)
 * - increment: Auto-increment through all values, wrapping at end
 * - incrementNonBlank: Auto-increment but skip blank values
 * - random: Random row from all values
 * - randomNonBlank: Random row that has a non-blank value
 *
 * The tracker maintains state per label per worksheet to support independent
 * auto-increment counters for different data columns.
 */

import type { SheetData, Worksheet, IndexType } from './types';
import { normalizeLabel } from './parser';

// ============================================================================
// Types
// ============================================================================

/**
 * Result of resolving an index.
 */
export interface ResolvedIndex {
  /** The 0-based index into the values array */
  index: number;
  /** The actual value at that index */
  value: string;
  /** Whether the resolution was successful */
  success: boolean;
  /** Error message if resolution failed */
  error?: string;
}

/**
 * State for tracking auto-increment position.
 * Keyed by "worksheet:normalizedLabel"
 */
interface CounterState {
  /** Current position for 'increment' mode */
  incrementPosition: number;
  /** Current position for 'incrementNonBlank' mode (tracks non-blank indices) */
  incrementNonBlankPosition: number;
}

// ============================================================================
// Index Tracker Class
// ============================================================================

/**
 * Tracks index state during sync operations.
 *
 * Maintains auto-increment counters per label per worksheet and resolves
 * IndexType specifications to actual row indices.
 *
 * @example
 * const tracker = new IndexTracker(sheetData);
 *
 * // Auto-increment: first call gets index 0, second gets index 1, etc.
 * tracker.getValue('Title', undefined, { type: 'increment' });
 * tracker.getValue('Title', undefined, { type: 'increment' });
 *
 * // Specific index: always returns the specified row (1-based → 0-based)
 * tracker.getValue('Title', undefined, { type: 'specific', value: 3 }); // index 2
 *
 * // Random: returns random value each time
 * tracker.getValue('Title', undefined, { type: 'random' });
 */
export class IndexTracker {
  private sheetData: SheetData;
  private counters: Map<string, CounterState>;
  private randomSeed: number;

  /**
   * Create a new IndexTracker.
   *
   * @param sheetData - The sheet data to track indices for
   * @param seed - Optional seed for random number generation (for testing)
   */
  constructor(sheetData: SheetData, seed?: number) {
    this.sheetData = sheetData;
    this.counters = new Map();
    this.randomSeed = seed ?? Math.random() * 10000;
  }

  /**
   * Reset all auto-increment counters.
   * Useful when starting a new sync operation.
   */
  reset(): void {
    this.counters.clear();
  }

  /**
   * Reset counters for a specific label (all worksheets).
   *
   * @param label - The label to reset counters for
   */
  resetLabel(label: string): void {
    const normalizedLabel = normalizeLabel(label);
    for (const key of this.counters.keys()) {
      if (key.endsWith(`:${normalizedLabel}`)) {
        this.counters.delete(key);
      }
    }
  }

  /**
   * Get the worksheet to use for a binding.
   *
   * @param worksheetName - Explicit worksheet name, or undefined for active
   * @returns The worksheet or undefined if not found
   */
  getWorksheet(worksheetName?: string): Worksheet | undefined {
    if (worksheetName) {
      // Find worksheet by name (case-insensitive)
      const normalizedName = worksheetName.toLowerCase();
      return this.sheetData.worksheets.find(
        (ws) => ws.name.toLowerCase() === normalizedName
      );
    }
    // Use active worksheet
    return this.sheetData.worksheets.find(
      (ws) => ws.name === this.sheetData.activeWorksheet
    );
  }

  /**
   * Get values for a label from a worksheet.
   *
   * @param label - The label to look up
   * @param worksheet - The worksheet to get values from
   * @returns Array of values, or undefined if label not found
   */
  getValuesForLabel(label: string, worksheet: Worksheet): string[] | undefined {
    // Try exact match first
    if (worksheet.rows[label] !== undefined) {
      return worksheet.rows[label];
    }

    // Try normalized match
    const normalizedLabel = normalizeLabel(label);
    for (const [sheetLabel, values] of Object.entries(worksheet.rows)) {
      if (normalizeLabel(sheetLabel) === normalizedLabel) {
        return values;
      }
    }

    return undefined;
  }

  /**
   * Get non-blank indices for a set of values.
   *
   * @param values - Array of values
   * @returns Array of indices where values are non-blank
   */
  private getNonBlankIndices(values: string[]): number[] {
    const indices: number[] = [];
    for (let i = 0; i < values.length; i++) {
      if (values[i] && values[i].trim() !== '') {
        indices.push(i);
      }
    }
    return indices;
  }

  /**
   * Get counter state for a label/worksheet combination.
   * Creates new state if it doesn't exist.
   */
  private getCounterState(worksheetName: string, label: string): CounterState {
    const key = `${worksheetName}:${normalizeLabel(label)}`;
    let state = this.counters.get(key);
    if (!state) {
      state = {
        incrementPosition: 0,
        incrementNonBlankPosition: 0,
      };
      this.counters.set(key, state);
    }
    return state;
  }

  /**
   * Generate a pseudo-random number using a simple LCG.
   * This ensures consistent random results when seeded.
   */
  private nextRandom(): number {
    // Linear congruential generator
    this.randomSeed = (this.randomSeed * 1664525 + 1013904223) % 4294967296;
    return this.randomSeed / 4294967296;
  }

  /**
   * Resolve an index type to an actual row index.
   *
   * @param label - The label to resolve index for
   * @param worksheetName - The worksheet name (undefined for active)
   * @param indexType - The index type specification
   * @returns ResolvedIndex with index, value, and success status
   *
   * @example
   * // Specific index (1-based → 0-based)
   * tracker.resolveIndex('Title', undefined, { type: 'specific', value: 1 });
   * // => { index: 0, value: 'First Title', success: true }
   *
   * @example
   * // Auto-increment
   * tracker.resolveIndex('Title', undefined, { type: 'increment' });
   * // => { index: 0, ... } (first call)
   * tracker.resolveIndex('Title', undefined, { type: 'increment' });
   * // => { index: 1, ... } (second call)
   */
  resolveIndex(
    label: string,
    worksheetName: string | undefined,
    indexType: IndexType
  ): ResolvedIndex {
    // Get worksheet
    const worksheet = this.getWorksheet(worksheetName);
    if (!worksheet) {
      return {
        index: -1,
        value: '',
        success: false,
        error: `Worksheet not found: ${worksheetName || '(active)'}`,
      };
    }

    // Get values for label
    const values = this.getValuesForLabel(label, worksheet);
    if (!values) {
      return {
        index: -1,
        value: '',
        success: false,
        error: `Label not found: ${label}`,
      };
    }

    if (values.length === 0) {
      return {
        index: -1,
        value: '',
        success: false,
        error: `No values for label: ${label}`,
      };
    }

    const state = this.getCounterState(worksheet.name, label);
    let index: number;

    switch (indexType.type) {
      case 'specific':
        // Convert 1-based to 0-based
        index = indexType.value - 1;
        // Clamp to valid range
        if (index < 0) {
          index = 0;
        } else if (index >= values.length) {
          index = values.length - 1;
        }
        break;

      case 'increment':
        // Get current position and advance
        index = state.incrementPosition % values.length;
        state.incrementPosition++;
        break;

      case 'incrementNonBlank': {
        const nonBlankIndices = this.getNonBlankIndices(values);
        if (nonBlankIndices.length === 0) {
          return {
            index: -1,
            value: '',
            success: false,
            error: `No non-blank values for label: ${label}`,
          };
        }
        // Get current position in non-blank indices and advance
        const nonBlankPosition = state.incrementNonBlankPosition % nonBlankIndices.length;
        index = nonBlankIndices[nonBlankPosition];
        state.incrementNonBlankPosition++;
        break;
      }

      case 'random':
        // Random index from all values
        index = Math.floor(this.nextRandom() * values.length);
        break;

      case 'randomNonBlank': {
        const nonBlankIndices = this.getNonBlankIndices(values);
        if (nonBlankIndices.length === 0) {
          return {
            index: -1,
            value: '',
            success: false,
            error: `No non-blank values for label: ${label}`,
          };
        }
        // Random index from non-blank values
        const randomNonBlankIdx = Math.floor(this.nextRandom() * nonBlankIndices.length);
        index = nonBlankIndices[randomNonBlankIdx];
        break;
      }

      default:
        return {
          index: -1,
          value: '',
          success: false,
          error: `Unknown index type: ${(indexType as IndexType).type}`,
        };
    }

    return {
      index,
      value: values[index],
      success: true,
    };
  }

  /**
   * Get the value for a label with the specified index type.
   * Convenience method that returns just the value string.
   *
   * @param label - The label to get value for
   * @param worksheetName - The worksheet name (undefined for active)
   * @param indexType - The index type specification
   * @returns The value string, or empty string if not found
   */
  getValue(
    label: string,
    worksheetName: string | undefined,
    indexType: IndexType
  ): string {
    const result = this.resolveIndex(label, worksheetName, indexType);
    return result.value;
  }

  /**
   * Check if a label exists in a worksheet.
   *
   * @param label - The label to check
   * @param worksheetName - The worksheet name (undefined for active)
   * @returns true if the label exists
   */
  hasLabel(label: string, worksheetName?: string): boolean {
    const worksheet = this.getWorksheet(worksheetName);
    if (!worksheet) {
      return false;
    }
    return this.getValuesForLabel(label, worksheet) !== undefined;
  }

  /**
   * Get the total number of values for a label.
   *
   * @param label - The label to get count for
   * @param worksheetName - The worksheet name (undefined for active)
   * @returns Number of values, or 0 if label not found
   */
  getValueCount(label: string, worksheetName?: string): number {
    const worksheet = this.getWorksheet(worksheetName);
    if (!worksheet) {
      return 0;
    }
    const values = this.getValuesForLabel(label, worksheet);
    return values ? values.length : 0;
  }

  /**
   * Get the number of non-blank values for a label.
   *
   * @param label - The label to get count for
   * @param worksheetName - The worksheet name (undefined for active)
   * @returns Number of non-blank values, or 0 if label not found
   */
  getNonBlankValueCount(label: string, worksheetName?: string): number {
    const worksheet = this.getWorksheet(worksheetName);
    if (!worksheet) {
      return 0;
    }
    const values = this.getValuesForLabel(label, worksheet);
    if (!values) {
      return 0;
    }
    return this.getNonBlankIndices(values).length;
  }

  /**
   * Get all labels available in a worksheet.
   *
   * @param worksheetName - The worksheet name (undefined for active)
   * @returns Array of label names
   */
  getLabels(worksheetName?: string): string[] {
    const worksheet = this.getWorksheet(worksheetName);
    if (!worksheet) {
      return [];
    }
    return worksheet.labels;
  }

  /**
   * Get all worksheet names.
   *
   * @returns Array of worksheet names
   */
  getWorksheetNames(): string[] {
    return this.sheetData.worksheets.map((ws) => ws.name);
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new IndexTracker instance.
 *
 * @param sheetData - The sheet data to track indices for
 * @param seed - Optional seed for random number generation (for testing)
 * @returns New IndexTracker instance
 *
 * @example
 * const tracker = createIndexTracker(sheetData);
 * const value = tracker.getValue('Title', undefined, { type: 'increment' });
 */
export function createIndexTracker(sheetData: SheetData, seed?: number): IndexTracker {
  return new IndexTracker(sheetData, seed);
}

// ============================================================================
// Default Index
// ============================================================================

/**
 * The default index type used when no index is specified.
 * Auto-increment is the default behavior.
 */
export const DEFAULT_INDEX_TYPE: IndexType = { type: 'increment' };
