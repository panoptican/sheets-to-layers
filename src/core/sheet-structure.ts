/**
 * Sheet structure detection utilities.
 *
 * Handles automatic detection of sheet orientation (labels in top row vs left column)
 * and data bounds (ignoring stray content outside the main grid).
 *
 * Since CSV export doesn't include formatting (bold), we use heuristics:
 * - Check for unique values in first row vs first column
 * - Check for label-like patterns (text vs numeric)
 * - Default to column-based orientation (most common)
 */

import type { Worksheet } from './types';

// ============================================================================
// Types
// ============================================================================

/**
 * Detected sheet structure metadata.
 */
export interface SheetStructure {
  /** Whether labels are in columns (top row) or rows (left column) */
  orientation: 'columns' | 'rows';
  /** Detected labels */
  labels: string[];
  /** Number of data values per label */
  valueCount: number;
  /** Actual data bounds (excluding empty rows/columns) */
  bounds: DataBounds;
}

/**
 * Data bounds within the raw sheet data.
 */
export interface DataBounds {
  /** First row with data (0-indexed) */
  startRow: number;
  /** Last row with data (0-indexed, inclusive) */
  endRow: number;
  /** First column with data (0-indexed) */
  startCol: number;
  /** Last column with data (0-indexed, inclusive) */
  endCol: number;
  /** Total rows with data */
  rowCount: number;
  /** Total columns with data */
  colCount: number;
}

// ============================================================================
// Data Bounds Detection
// ============================================================================

/**
 * Find the bounds of actual data in the raw sheet.
 * This excludes empty rows and columns beyond the data grid.
 *
 * @param rawData - 2D array from CSV parsing
 * @returns DataBounds object with row and column ranges
 *
 * @example
 * findDataBounds([
 *   ['Name', 'Age', ''],
 *   ['Alice', '30', ''],
 *   ['', '', ''],
 * ])
 * // => { startRow: 0, endRow: 1, startCol: 0, endCol: 1, rowCount: 2, colCount: 2 }
 */
export function findDataBounds(rawData: string[][]): DataBounds {
  if (rawData.length === 0) {
    return {
      startRow: 0,
      endRow: -1,
      startCol: 0,
      endCol: -1,
      rowCount: 0,
      colCount: 0,
    };
  }

  // Find first and last row with any non-empty content
  let startRow = -1;
  let endRow = -1;

  for (let i = 0; i < rawData.length; i++) {
    const row = rawData[i];
    const hasContent = row.some((cell) => cell.trim() !== '');
    if (hasContent) {
      if (startRow === -1) {
        startRow = i;
      }
      endRow = i;
    }
  }

  // Handle completely empty sheet
  if (startRow === -1) {
    return {
      startRow: 0,
      endRow: -1,
      startCol: 0,
      endCol: -1,
      rowCount: 0,
      colCount: 0,
    };
  }

  // Find first and last column with any non-empty content
  let startCol = -1;
  let endCol = -1;

  // Get max column count
  const maxCols = Math.max(...rawData.map((row) => row.length));

  for (let col = 0; col < maxCols; col++) {
    const hasContent = rawData.some((row) => {
      const cell = row[col];
      return cell !== undefined && cell.trim() !== '';
    });
    if (hasContent) {
      if (startCol === -1) {
        startCol = col;
      }
      endCol = col;
    }
  }

  return {
    startRow,
    endRow,
    startCol,
    endCol,
    rowCount: endRow - startRow + 1,
    colCount: endCol - startCol + 1,
  };
}

/**
 * Trim raw data to only include cells within the specified bounds.
 *
 * @param rawData - 2D array from CSV parsing
 * @param bounds - Data bounds to trim to
 * @returns Trimmed 2D array
 */
export function trimToBounds(rawData: string[][], bounds: DataBounds): string[][] {
  if (bounds.rowCount === 0 || bounds.colCount === 0) {
    return [];
  }

  const trimmed: string[][] = [];

  for (let row = bounds.startRow; row <= bounds.endRow; row++) {
    const sourceRow = rawData[row] || [];
    const newRow: string[] = [];

    for (let col = bounds.startCol; col <= bounds.endCol; col++) {
      newRow.push(sourceRow[col] !== undefined ? sourceRow[col] : '');
    }

    trimmed.push(newRow);
  }

  return trimmed;
}

// ============================================================================
// Orientation Detection
// ============================================================================

/**
 * Detect the orientation of sheet data (labels in columns vs rows).
 *
 * Uses heuristics since CSV doesn't include formatting:
 * 1. Check if first column has more unique label-like values than first row
 * 2. Check if first row looks like numeric data (suggests row-based)
 * 3. Compare data patterns for each assumed orientation
 * 4. Default to column-based (most common case)
 *
 * @param rawData - 2D array from CSV parsing (already trimmed to bounds)
 * @returns Detected orientation
 *
 * @example
 * // Column-based (labels in first row)
 * detectOrientation([
 *   ['Name', 'Age', 'City'],
 *   ['Alice', '30', 'NYC'],
 * ])
 * // => 'columns'
 *
 * @example
 * // Row-based (labels in first column)
 * detectOrientation([
 *   ['Name', 'Alice', 'Bob'],
 *   ['Age', '30', '25'],
 * ])
 * // => 'rows'
 */
export function detectOrientation(rawData: string[][]): 'columns' | 'rows' {
  // Default to columns for empty or small data
  if (rawData.length === 0 || rawData[0].length === 0) {
    return 'columns';
  }

  // Single row = must be columns
  if (rawData.length === 1) {
    return 'columns';
  }

  // Single column = must be rows
  if (rawData[0].length === 1) {
    return 'rows';
  }

  const firstRow = rawData[0];
  const firstCol = rawData.map((row) => row[0]);

  // Calculate label scores for first row and first column
  const firstRowLabelScore = calculateLabelScore(firstRow);
  const firstColLabelScore = calculateLabelScore(firstCol);

  // Key insight: In row-based data, the first column contains ALL labels,
  // and the rest of the first row contains DATA values (not labels).
  // In column-based data, the first row contains ALL labels,
  // and the rest of the first column contains DATA values (not labels).

  // Get the "data" part of first row (excluding first cell) and first column
  const firstRowData = firstRow.slice(1);
  const firstColData = firstCol.slice(1);

  // Check if "data" parts look like data vs labels
  const firstRowDataIsNumeric = countNumericValues(firstRowData);
  const firstColDataIsNumeric = countNumericValues(firstColData);

  // Check data patterns in the rest of the sheet
  const columnsDataScore = analyzeDataPattern(rawData, 'columns');
  const rowsDataScore = analyzeDataPattern(rawData, 'rows');

  // Score calculation:
  // - If first column looks like labels AND first row's data values are numeric → rows
  // - If first row looks like labels AND first column's data values are numeric → columns

  let columnsScore = firstRowLabelScore + columnsDataScore;
  let rowsScore = firstColLabelScore + rowsDataScore;

  // Boost score if the "data" portion looks numeric
  // (If first row after cell 0 is numeric, suggests first col is labels → rows)
  if (firstRowData.length > 0 && firstRowDataIsNumeric / firstRowData.length > 0.5) {
    rowsScore += 3;
  }
  // (If first col after row 0 is numeric, suggests first row is labels → columns)
  if (firstColData.length > 0 && firstColDataIsNumeric / firstColData.length > 0.5) {
    columnsScore += 3;
  }

  // Aspect ratio is a WEAK signal - only use for extreme cases
  // Most data is column-based regardless of aspect ratio
  // if (rawData.length > rawData[0].length * 3) {
  //   rowsScore += 1;
  // }
  // if (rawData[0].length > rawData.length * 3) {
  //   columnsScore += 1;
  // }

  // Compare scores
  if (rowsScore > columnsScore) {
    return 'rows';
  }

  // Default to columns (most common)
  return 'columns';
}

/**
 * Count how many values in an array are numeric.
 */
function countNumericValues(values: string[]): number {
  let count = 0;
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed && (/^-?\d*\.?\d+%?$/.test(trimmed) || /^\$[\d,]+\.?\d*$/.test(trimmed))) {
      count++;
    }
  }
  return count;
}

/**
 * Calculate a "label-likeness" score for an array of values.
 * Higher score = more likely to be labels.
 *
 * Factors that increase score:
 * - All unique values
 * - Text-like values (not purely numeric)
 * - Programmatic naming patterns (snake_case, camelCase)
 * - Shorter values (labels tend to be concise)
 *
 * Factors that decrease score:
 * - Proper names (Title Case with spaces) - suggests data, not labels
 */
function calculateLabelScore(values: string[]): number {
  if (values.length === 0) {
    return 0;
  }

  let score = 0;

  // Check uniqueness
  const trimmed = values.map((v) => v.trim()).filter((v) => v !== '');
  const unique = new Set(trimmed);
  if (unique.size === trimmed.length && trimmed.length > 0) {
    score += 2; // All unique - moderate indicator (both labels and data can be unique)
  }

  // Check for text vs numeric values
  let textCount = 0;
  let numericCount = 0;
  let shortCount = 0;
  let programmaticCount = 0; // snake_case, camelCase patterns
  let properNameCount = 0; // "Title Case" or "Company Name" patterns

  for (const value of trimmed) {
    // Is it numeric?
    if (/^-?\d*\.?\d+%?$/.test(value) || /^\$[\d,]+\.?\d*$/.test(value)) {
      numericCount++;
    } else {
      textCount++;
    }

    // Is it short? (Labels tend to be under 30 chars)
    if (value.length > 0 && value.length <= 30) {
      shortCount++;
    }

    // Check for programmatic naming patterns (strong indicator of column headers)
    // snake_case: contains underscore with lowercase letters
    // camelCase: lowercase followed by uppercase
    if (/^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(value) || // snake_case
        /^[a-z]+[A-Z][a-zA-Z0-9]*$/.test(value)) { // camelCase
      programmaticCount++;
    }

    // Check for proper names (suggests data, not labels)
    // Pattern: Capital letter followed by lowercase, with spaces between words
    // Examples: "AbbVie", "Johnson & Johnson", "Dr. Sarah Chen"
    if (/^[A-Z][a-z]+(\s+[A-Z&][a-z]*)+$/.test(value) || // Multi-word proper names
        /^[A-Z][a-z]+$/.test(value) || // Single proper name
        /^Dr\.\s/.test(value) || // Doctor names
        /^[A-Z][a-z]+\s+(Cancer|Health|Medical|University|Hospital)/.test(value)) { // Institution names
      properNameCount++;
    }
  }

  // More text than numeric suggests labels
  if (textCount > numericCount) {
    score += 1;
  }

  // Mostly short values suggests labels
  if (trimmed.length > 0 && shortCount / trimmed.length >= 0.7) {
    score += 1;
  }

  // Programmatic naming is a STRONG indicator of column headers
  if (trimmed.length > 0 && programmaticCount / trimmed.length >= 0.5) {
    score += 5; // Strong bonus for snake_case/camelCase patterns
  }

  // Proper names suggest DATA, not labels - reduce score
  if (trimmed.length > 0 && properNameCount / trimmed.length >= 0.3) {
    score -= 2;
  }

  return Math.max(0, score);
}

/**
 * Analyze data patterns to help determine orientation.
 * Checks if data values are consistent with the assumed orientation.
 *
 * @param rawData - The raw data array
 * @param assumedOrientation - The orientation to test
 * @returns Score for how well data fits this orientation (normalized 0-3)
 */
function analyzeDataPattern(
  rawData: string[][],
  assumedOrientation: 'columns' | 'rows'
): number {
  if (rawData.length < 2 || rawData[0].length < 2) {
    return 0;
  }

  let consistentCount = 0;
  let totalCount = 0;

  if (assumedOrientation === 'columns') {
    // Check if columns have consistent data types (excluding first row which are labels)
    const numCols = rawData[0].length;
    totalCount = numCols;
    for (let col = 0; col < numCols; col++) {
      const colValues = rawData.slice(1).map((row) => row[col] || '');
      if (hasConsistentTypes(colValues)) {
        consistentCount++;
      }
    }
  } else {
    // Check if rows have consistent data types (excluding first col which are labels)
    totalCount = rawData.length - 1;
    for (let row = 1; row < rawData.length; row++) {
      const rowValues = rawData[row].slice(1);
      if (hasConsistentTypes(rowValues)) {
        consistentCount++;
      }
    }
  }

  // Normalize score to 0-3 range based on percentage of consistent items
  if (totalCount === 0) {
    return 0;
  }
  const ratio = consistentCount / totalCount;
  return ratio * 3;
}

/**
 * Check if an array of values has consistent types.
 * Values are considered consistent if they're mostly the same type (text/numeric).
 */
function hasConsistentTypes(values: string[]): boolean {
  const nonEmpty = values.filter((v) => v.trim() !== '');
  if (nonEmpty.length < 2) {
    return true;
  }

  let numericCount = 0;
  for (const value of nonEmpty) {
    if (/^-?\d*\.?\d+%?$/.test(value.trim()) || /^\$[\d,]+\.?\d*$/.test(value.trim())) {
      numericCount++;
    }
  }

  const ratio = numericCount / nonEmpty.length;
  // Consider consistent if >80% same type
  return ratio > 0.8 || ratio < 0.2;
}

// ============================================================================
// Main Structure Detection
// ============================================================================

/**
 * Detect the complete structure of sheet data.
 *
 * @param rawData - 2D array from CSV parsing
 * @returns SheetStructure with orientation, labels, and bounds
 *
 * @example
 * const structure = detectSheetStructure([
 *   ['Name', 'Age', 'City'],
 *   ['Alice', '30', 'NYC'],
 *   ['Bob', '25', 'LA'],
 * ]);
 * // => {
 * //   orientation: 'columns',
 * //   labels: ['Name', 'Age', 'City'],
 * //   valueCount: 2,
 * //   bounds: { startRow: 0, endRow: 2, ... }
 * // }
 */
export function detectSheetStructure(rawData: string[][]): SheetStructure {
  // Find data bounds first
  const bounds = findDataBounds(rawData);

  // Handle empty sheet
  if (bounds.rowCount === 0 || bounds.colCount === 0) {
    return {
      orientation: 'columns',
      labels: [],
      valueCount: 0,
      bounds,
    };
  }

  // Trim to bounds for orientation detection
  const trimmedData = trimToBounds(rawData, bounds);

  // Detect orientation
  const orientation = detectOrientation(trimmedData);

  // Extract labels based on orientation
  let labels: string[];
  let valueCount: number;

  if (orientation === 'columns') {
    // Labels are in first row
    labels = trimmedData[0].map((l) => l.trim()).filter((l) => l !== '');
    valueCount = trimmedData.length - 1;
  } else {
    // Labels are in first column
    labels = trimmedData.map((row) => row[0].trim()).filter((l) => l !== '');
    valueCount = trimmedData[0].length - 1;
  }

  return {
    orientation,
    labels,
    valueCount,
    bounds,
  };
}

// ============================================================================
// Data Normalization
// ============================================================================

/**
 * Normalize raw sheet data into a Label -> Values map.
 *
 * @param rawData - 2D array from CSV parsing
 * @param orientation - The detected or specified orientation
 * @returns Record mapping labels to arrays of values
 *
 * @example
 * // Column-based
 * normalizeSheetData([
 *   ['Name', 'Age'],
 *   ['Alice', '30'],
 *   ['Bob', '25'],
 * ], 'columns')
 * // => { 'Name': ['Alice', 'Bob'], 'Age': ['30', '25'] }
 *
 * @example
 * // Row-based
 * normalizeSheetData([
 *   ['Name', 'Alice', 'Bob'],
 *   ['Age', '30', '25'],
 * ], 'rows')
 * // => { 'Name': ['Alice', 'Bob'], 'Age': ['30', '25'] }
 */
export function normalizeSheetData(
  rawData: string[][],
  orientation: 'columns' | 'rows'
): Record<string, string[]> {
  const normalized: Record<string, string[]> = {};

  if (rawData.length === 0) {
    return normalized;
  }

  if (orientation === 'columns') {
    // First row = labels, subsequent rows = values
    const labels = rawData[0];

    for (let colIndex = 0; colIndex < labels.length; colIndex++) {
      const label = labels[colIndex].trim();
      if (label) {
        normalized[label] = [];
        for (let rowIndex = 1; rowIndex < rawData.length; rowIndex++) {
          const value = rawData[rowIndex]?.[colIndex] ?? '';
          normalized[label].push(value);
        }
      }
    }
  } else {
    // First column = labels, subsequent columns = values
    for (let rowIndex = 0; rowIndex < rawData.length; rowIndex++) {
      const row = rawData[rowIndex];
      const label = row[0]?.trim();
      if (label) {
        normalized[label] = row.slice(1);
      }
    }
  }

  return normalized;
}

/**
 * Convert raw data to a Worksheet with automatic structure detection.
 *
 * @param rawData - 2D array from CSV parsing
 * @param worksheetName - Name for the worksheet
 * @returns Worksheet object with detected structure
 */
export function rawDataToWorksheetWithDetection(
  rawData: string[][],
  worksheetName: string
): Worksheet {
  const structure = detectSheetStructure(rawData);

  // Handle empty sheet
  if (structure.labels.length === 0) {
    return {
      name: worksheetName,
      labels: [],
      rows: {},
      orientation: 'columns',
    };
  }

  // Trim to bounds
  const trimmedData = trimToBounds(rawData, structure.bounds);

  // Normalize data based on detected orientation
  const rows = normalizeSheetData(trimmedData, structure.orientation);

  return {
    name: worksheetName,
    labels: structure.labels,
    rows,
    orientation: structure.orientation,
  };
}
