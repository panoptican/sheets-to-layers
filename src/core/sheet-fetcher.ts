/**
 * Google Sheets data fetching utilities.
 *
 * Handles fetching spreadsheet data from public Google Sheets URLs.
 * All network requests must be made from the UI context (iframe with network access).
 *
 * Fetching Strategy:
 * 1. Use the CSV export endpoint for worksheet data
 * 2. Use the gviz JSON endpoint to get worksheet list and metadata
 * 3. Cache fetched data for the session to prevent redundant requests
 */

import type { SheetData, Worksheet, ErrorType } from './types';
import { buildCsvExportUrl, buildJsonExportUrl } from '../utils/url';
import { rawDataToWorksheetWithDetection } from './sheet-structure';

// ============================================================================
// Constants
// ============================================================================

/** Default timeout for fetch requests (30 seconds) */
const DEFAULT_TIMEOUT = 30000;

/** Number of retries on timeout */
const MAX_RETRIES = 1;

// ============================================================================
// Types
// ============================================================================

/**
 * Result of a fetch operation.
 */
export interface FetchResult {
  success: boolean;
  data?: SheetData;
  error?: {
    type: FetchErrorType;
    message: string;
  };
}

/**
 * Categories of fetch errors.
 */
export type FetchErrorType =
  | 'NETWORK_ERROR'
  | 'NOT_PUBLIC'
  | 'NOT_FOUND'
  | 'TIMEOUT'
  | 'INVALID_FORMAT'
  | 'UNKNOWN';

/**
 * Worksheet metadata from gviz endpoint.
 */
interface WorksheetMeta {
  name: string;
  gid: string;
}

/**
 * Raw gviz response structure (partial).
 */
interface GvizResponse {
  table?: {
    cols?: Array<{ label?: string; id?: string }>;
    rows?: Array<{ c?: Array<{ v?: unknown; f?: string }> }>;
  };
  status?: string;
  errors?: Array<{ reason?: string; message?: string }>;
}

// ============================================================================
// Session Cache
// ============================================================================

/** Cache for fetched sheet data, keyed by spreadsheetId */
const sheetCache = new Map<string, SheetData>();

/** Cache for fetched worksheets, keyed by spreadsheetId:gid */
const worksheetCache = new Map<string, string[][]>();

/**
 * Clear all cached data.
 */
export function clearCache(): void {
  sheetCache.clear();
  worksheetCache.clear();
}

/**
 * Get cached sheet data if available.
 */
export function getCachedSheetData(spreadsheetId: string): SheetData | undefined {
  return sheetCache.get(spreadsheetId);
}

// ============================================================================
// CSV Parsing
// ============================================================================

/**
 * Parse CSV text into a 2D array of strings.
 *
 * Handles:
 * - Quoted fields (fields containing commas, newlines, or quotes)
 * - Escaped quotes (doubled quotes within quoted fields)
 * - Different line endings (CRLF, LF, CR)
 * - Empty fields
 *
 * @param csvText - The raw CSV text
 * @returns 2D array of cell values
 *
 * @example
 * parseCSV('Name,Age\nAlice,30\nBob,25')
 * // => [['Name', 'Age'], ['Alice', '30'], ['Bob', '25']]
 *
 * @example
 * parseCSV('"Name, Full","Age"\n"Alice ""Al""",30')
 * // => [['Name, Full', 'Age'], ['Alice "Al"', '30']]
 */
export function parseCSV(csvText: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;
  let i = 0;

  // Normalize line endings to \n
  const text = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  while (i < text.length) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          // Escaped quote - add single quote to field
          currentField += '"';
          i += 2;
        } else {
          // End of quoted field
          inQuotes = false;
          i++;
        }
      } else {
        // Regular character inside quotes (including newlines)
        currentField += char;
        i++;
      }
    } else {
      if (char === '"') {
        // Start of quoted field
        inQuotes = true;
        i++;
      } else if (char === ',') {
        // Field separator
        currentRow.push(currentField);
        currentField = '';
        i++;
      } else if (char === '\n') {
        // Row separator
        currentRow.push(currentField);
        rows.push(currentRow);
        currentRow = [];
        currentField = '';
        i++;
      } else {
        // Regular character
        currentField += char;
        i++;
      }
    }
  }

  // Don't forget the last field/row
  if (currentField || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  // Handle empty input
  if (rows.length === 0) {
    return [[]];
  }

  return rows;
}

// ============================================================================
// Fetch with Timeout
// ============================================================================

/**
 * Fetch with timeout support.
 *
 * @param url - URL to fetch
 * @param timeout - Timeout in milliseconds
 * @returns Response object
 */
async function fetchWithTimeout(url: string, timeout: number = DEFAULT_TIMEOUT): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      // Google Sheets requires these headers for CORS
      mode: 'cors',
      credentials: 'omit',
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('TIMEOUT');
    }
    throw error;
  }
}

// ============================================================================
// Worksheet Fetching
// ============================================================================

/**
 * Fetch a single worksheet's data as a 2D array.
 *
 * @param spreadsheetId - The spreadsheet ID
 * @param gid - Worksheet gid (defaults to '0' for first sheet)
 * @returns 2D array of cell values
 */
export async function fetchWorksheetRaw(
  spreadsheetId: string,
  gid: string = '0'
): Promise<string[][]> {
  const cacheKey = `${spreadsheetId}:${gid}`;

  // Check cache
  const cached = worksheetCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const url = buildCsvExportUrl(spreadsheetId, gid);

  let lastError: Error | null = null;
  let retries = 0;

  while (retries <= MAX_RETRIES) {
    try {
      const response = await fetchWithTimeout(url);

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw createFetchError(
            'NOT_PUBLIC',
            'Sheet is not publicly accessible. Please set sharing to "Anyone with the link can view".'
          );
        }
        if (response.status === 404) {
          throw createFetchError(
            'NOT_FOUND',
            'Spreadsheet not found. Please check the URL and make sure the sheet exists.'
          );
        }
        throw createFetchError(
          'NETWORK_ERROR',
          `Failed to fetch sheet: ${response.status} ${response.statusText}`
        );
      }

      const csvText = await response.text();
      const data = parseCSV(csvText);

      // Cache the result
      worksheetCache.set(cacheKey, data);

      return data;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry on non-timeout errors
      if (lastError.message !== 'TIMEOUT') {
        throw lastError;
      }

      retries++;
      if (retries > MAX_RETRIES) {
        throw createFetchError('TIMEOUT', 'Request timed out. Please check your internet connection and try again.');
      }
    }
  }

  throw lastError || createFetchError('UNKNOWN', 'An unknown error occurred');
}

// ============================================================================
// Worksheet Metadata via gviz
// ============================================================================

/**
 * Fetch worksheet metadata using the gviz JSON endpoint.
 * This gives us access to worksheet names and can help identify structure.
 *
 * Note: The gviz endpoint returns JSONP-like format:
 * google.visualization.Query.setResponse({...})
 *
 * @param spreadsheetId - The spreadsheet ID
 * @param gid - Optional worksheet gid
 * @returns Parsed gviz response data
 */
export async function fetchGvizData(
  spreadsheetId: string,
  gid?: string
): Promise<GvizResponse> {
  const url = buildJsonExportUrl(spreadsheetId, gid);

  const response = await fetchWithTimeout(url);

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw createFetchError(
        'NOT_PUBLIC',
        'Sheet is not publicly accessible. Please set sharing to "Anyone with the link can view".'
      );
    }
    if (response.status === 404) {
      throw createFetchError(
        'NOT_FOUND',
        'Spreadsheet not found. Please check the URL.'
      );
    }
    throw createFetchError(
      'NETWORK_ERROR',
      `Failed to fetch sheet metadata: ${response.status} ${response.statusText}`
    );
  }

  const text = await response.text();

  // Parse the JSONP-like response
  // Format: google.visualization.Query.setResponse({...})
  const jsonMatch = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\);?$/);
  if (!jsonMatch || !jsonMatch[1]) {
    throw createFetchError('INVALID_FORMAT', 'Invalid response format from Google Sheets');
  }

  try {
    return JSON.parse(jsonMatch[1]) as GvizResponse;
  } catch {
    throw createFetchError('INVALID_FORMAT', 'Failed to parse response from Google Sheets');
  }
}

/**
 * Extract column labels from gviz response.
 */
export function extractLabelsFromGviz(gviz: GvizResponse): string[] {
  if (!gviz.table?.cols) {
    return [];
  }

  return gviz.table.cols
    .map((col) => col.label || '')
    .filter((label) => label !== '');
}

/**
 * Convert gviz response to 2D string array (same format as CSV parsing).
 *
 * The gviz response has:
 * - table.cols: Array of column definitions with labels
 * - table.rows: Array of rows, each with cells (c) containing values (v) and formatted values (f)
 *
 * @param gviz - The parsed gviz response
 * @returns 2D array of cell values (first row is labels if available)
 */
export function gvizToRawData(gviz: GvizResponse): string[][] {
  const result: string[][] = [];

  if (!gviz.table) {
    return result;
  }

  const cols = gviz.table.cols || [];
  const rows = gviz.table.rows || [];

  // First row: column labels (from cols array)
  // Note: gviz uses the first row of data as labels if they exist
  const headerRow: string[] = cols.map((col) => col.label || '');

  // Only add header row if there are any non-empty labels
  const hasLabels = headerRow.some((label) => label !== '');
  if (hasLabels) {
    result.push(headerRow);
  }

  // Data rows
  for (const row of rows) {
    const cells = row.c || [];
    const rowData: string[] = [];

    for (let i = 0; i < cols.length; i++) {
      const cell = cells[i];
      if (cell === null || cell === undefined) {
        rowData.push('');
      } else {
        // Prefer formatted value (f) for display, fall back to raw value (v)
        const value = cell.f !== undefined ? cell.f : cell.v;
        rowData.push(value !== null && value !== undefined ? String(value) : '');
      }
    }

    result.push(rowData);
  }

  return result;
}

/**
 * Fetch worksheet data using the gviz endpoint.
 * This endpoint has better CORS support than the CSV export endpoint
 * since it's designed for web embedding.
 *
 * @param spreadsheetId - The spreadsheet ID
 * @param gid - Worksheet gid (defaults to '0' for first sheet)
 * @returns 2D array of cell values
 */
export async function fetchWorksheetViaGviz(
  spreadsheetId: string,
  gid: string = '0'
): Promise<string[][]> {
  const cacheKey = `${spreadsheetId}:${gid}`;

  // Check cache
  const cached = worksheetCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const gvizData = await fetchGvizData(spreadsheetId, gid);

  // Check for errors in the response
  if (gvizData.status === 'error' && gvizData.errors?.length) {
    const errorMsg = gvizData.errors[0]?.message || 'Unknown error';
    if (errorMsg.toLowerCase().includes('access denied') || errorMsg.toLowerCase().includes('permission')) {
      throw createFetchError(
        'NOT_PUBLIC',
        'Sheet is not publicly accessible. Please set sharing to "Anyone with the link can view".'
      );
    }
    throw createFetchError('NETWORK_ERROR', `Google Sheets error: ${errorMsg}`);
  }

  const rawData = gvizToRawData(gvizData);

  // Cache the result
  worksheetCache.set(cacheKey, rawData);

  return rawData;
}

// ============================================================================
// Main Sheet Data Fetching
// ============================================================================

/**
 * Fetch complete sheet data from a Google Sheets spreadsheet.
 *
 * This fetches data from the specified worksheet (or first worksheet if not specified)
 * and returns it in the normalized SheetData format.
 *
 * Note: Structure detection (determining if data is column-based or row-based)
 * will be implemented in TICKET-004. For now, we assume column-based (labels in first row).
 *
 * @param spreadsheetId - The spreadsheet ID
 * @param gid - Optional worksheet gid (defaults to '0')
 * @returns FetchResult with success status and data or error
 *
 * @example
 * const result = await fetchSheetData('abc123');
 * if (result.success) {
 *   console.log(result.data.worksheets[0].labels);
 * } else {
 *   console.error(result.error.message);
 * }
 */
export async function fetchSheetData(
  spreadsheetId: string,
  gid: string = '0'
): Promise<FetchResult> {
  try {
    // Check cache first
    const cached = sheetCache.get(spreadsheetId);
    if (cached) {
      return { success: true, data: cached };
    }

    // Fetch the worksheet data using gviz endpoint (better CORS support)
    const rawData = await fetchWorksheetViaGviz(spreadsheetId, gid);

    // Use structure detection to determine orientation and extract data
    const worksheet = rawDataToWorksheetWithDetection(rawData, `Sheet ${parseInt(gid) + 1}`);

    const sheetData: SheetData = {
      worksheets: [worksheet],
      activeWorksheet: worksheet.name,
    };

    // Cache the result
    sheetCache.set(spreadsheetId, sheetData);

    return { success: true, data: sheetData };
  } catch (error) {
    const fetchError = error as FetchError;

    return {
      success: false,
      error: {
        type: fetchError.fetchErrorType || 'UNKNOWN',
        message: fetchError.message || 'An unknown error occurred',
      },
    };
  }
}

/**
 * Fetch sheet data and return just the data or throw on error.
 * Convenience wrapper around fetchSheetData for simpler usage.
 *
 * @param spreadsheetId - The spreadsheet ID
 * @param gid - Optional worksheet gid
 * @returns SheetData
 * @throws Error with descriptive message on failure
 */
export async function fetchSheetDataOrThrow(
  spreadsheetId: string,
  gid: string = '0'
): Promise<SheetData> {
  const result = await fetchSheetData(spreadsheetId, gid);
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to fetch sheet data');
  }
  return result.data!;
}

// ============================================================================
// Data Transformation
// ============================================================================

/**
 * Convert raw 2D array to Worksheet format.
 *
 * This is the legacy version that assumes column-based structure (labels in first row).
 * For automatic structure detection, use rawDataToWorksheetWithDetection() from sheet-structure.ts.
 *
 * @param rawData - 2D array from CSV parsing
 * @param worksheetName - Name for the worksheet
 * @returns Worksheet object
 */
export function rawDataToWorksheet(rawData: string[][], worksheetName: string): Worksheet {
  if (rawData.length === 0 || (rawData.length === 1 && rawData[0].length === 0)) {
    return {
      name: worksheetName,
      labels: [],
      rows: {},
      orientation: 'columns',
    };
  }

  // First row is labels
  const labels = rawData[0].map((label) => label.trim());

  // Rest are data rows - organize by column
  const rows: Record<string, string[]> = {};

  for (const label of labels) {
    if (label) {
      rows[label] = [];
    }
  }

  // Populate values for each column
  for (let rowIndex = 1; rowIndex < rawData.length; rowIndex++) {
    const row = rawData[rowIndex];
    for (let colIndex = 0; colIndex < labels.length; colIndex++) {
      const label = labels[colIndex];
      if (label) {
        const value = row[colIndex] !== undefined ? row[colIndex] : '';
        rows[label].push(value);
      }
    }
  }

  return {
    name: worksheetName,
    labels: labels.filter((l) => l !== ''),
    rows,
    orientation: 'columns',
  };
}

// ============================================================================
// Error Handling
// ============================================================================

/**
 * Custom error type for fetch operations.
 */
interface FetchError extends Error {
  fetchErrorType: FetchErrorType;
}

/**
 * Create a FetchError with the given type and message.
 */
function createFetchError(type: FetchErrorType, message: string): FetchError {
  const error = new Error(message) as FetchError;
  error.fetchErrorType = type;
  return error;
}

/**
 * Check if an error is a FetchError.
 */
export function isFetchError(error: unknown): error is FetchError {
  return error instanceof Error && 'fetchErrorType' in error;
}

/**
 * Map fetch error type to ErrorType enum.
 */
export function fetchErrorToErrorType(fetchError: FetchErrorType): ErrorType {
  const mapping: Record<FetchErrorType, ErrorType> = {
    NETWORK_ERROR: 'NETWORK_ERROR' as ErrorType,
    NOT_PUBLIC: 'SHEET_NOT_PUBLIC' as ErrorType,
    NOT_FOUND: 'SHEET_NOT_FOUND' as ErrorType,
    TIMEOUT: 'NETWORK_ERROR' as ErrorType,
    INVALID_FORMAT: 'PARSE_ERROR' as ErrorType,
    UNKNOWN: 'UNKNOWN_ERROR' as ErrorType,
  };
  return mapping[fetchError];
}
