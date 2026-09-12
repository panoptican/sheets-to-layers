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

import type { SheetData, Worksheet, ErrorType, BoldInfo, DataDiagnostic } from './types';
import { buildCsvExportUrl, buildJsonpUrl } from '../utils/url';
import { buildWorksheet } from './sheet-structure';
import {
  FetchRequestOptions,
  SHEET_FETCH_DEADLINE_MS,
  MAX_SOURCE_CELLS,
  MAX_SHEET_RESPONSE_BYTES,
  MAX_WORKSHEETS,
  countWorksheetCells,
  REQUEST_DEADLINE_MS,
  retryTransient,
  runUpstreamRequest,
  runWorksheetTask,
  readResponseTextBounded,
  throwIfAborted,
  TransportError,
  withRequestDeadline,
} from './transport';

// ============================================================================
// Constants
// ============================================================================

/** Every individual JSONP/fetch request, including its body, gets this budget. */
const DEFAULT_TIMEOUT = REQUEST_DEADLINE_MS;

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

interface WorksheetDiscovery {
  worksheets: WorksheetMeta[];
  /** JSONP can only probe a bounded list of gids, not enumerate every tab. */
  limited: boolean;
}

/**
 * Raw gviz response structure.
 * Google's visualization API returns various fields depending on the query.
 */
interface GvizResponse {
  table?: {
    cols?: Array<{ label?: string; id?: string; type?: string }>;
    rows?: Array<{ c?: Array<{ v?: unknown; f?: string }> }>;
  };
  status?: string;
  errors?: Array<{ reason?: string; message?: string }>;
  // Additional fields that Google might return
  version?: string;
  reqId?: string;
  sig?: string;
  // Some responses include sheet name in parsedNumHeaders or other fields
  parsedNumHeaders?: number;
  [key: string]: unknown; // Capture any other fields
}

// ============================================================================
// Session Cache
// ============================================================================

/** Cache for fetched sheet snapshots, keyed by spreadsheet ID and requested gid. */
const sheetCache = new Map<string, SheetData>();

/** Cache for fetched worksheets, keyed by spreadsheetId:gid */
const worksheetCache = new Map<string, string[][]>();

/** JSONP metadata probes depend on the requested gid hint as well as the source. */
const worksheetMetaCache = new Map<string, WorksheetMeta[]>();
const worksheetDiscoveryLimitedCache = new Map<string, boolean>();

/** Cache for bold info, keyed by spreadsheetId:sheetName */
const boldInfoCache = new Map<string, BoldInfo>();

/** Completed snapshots are never shared across fresh runs; only active calls are. */
const inFlightSheetFetches = new Map<string, Promise<FetchResult>>();

/**
 * Clear all cached data.
 */
export function clearCache(): void {
  sheetCache.clear();
  worksheetCache.clear();
  worksheetMetaCache.clear();
  worksheetDiscoveryLimitedCache.clear();
  boldInfoCache.clear();
}

/**
 * Get cached sheet data if available.
 */
export function getCachedSheetData(spreadsheetId: string, gid?: string): SheetData | undefined {
  return sheetCache.get(sheetDataCacheKey(spreadsheetId, gid));
}

function sheetDataCacheKey(spreadsheetId: string, gid?: string): string {
  return `${spreadsheetId}:${gid || ''}`;
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
// Fetch with Timeout and CORS Proxy
// ============================================================================

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
  gid: string = '0',
  options: FetchRequestOptions = {}
): Promise<string[][]> {
  const cacheKey = `${spreadsheetId}:${gid}`;

  // Check cache
  const cached = worksheetCache.get(cacheKey);
  if (options.refresh === false && cached) {
    return cached;
  }

  const url = buildCsvExportUrl(spreadsheetId, gid);

  try {
    return await retryTransient(() => runUpstreamRequest(() => withRequestDeadline(async (signal) => {
      throwIfAborted(options.signal);
      const response = await fetch(url, {
        signal,
        mode: 'cors',
        credentials: 'omit',
      });

      if (!response.ok) {
        throw new TransportError(`Failed to fetch sheet: ${response.status} ${response.statusText}`, 'HTTP', response.status);
      }

      const csvText = await readResponseTextBounded(response, MAX_SHEET_RESPONSE_BYTES, signal);
      const data = parseCSV(csvText);
      countWorksheetCells(data);

      // Cache the result
      worksheetCache.set(cacheKey, data);

      return data;
    }, options), options.signal), options.signal);
  } catch (error) {
    if (error instanceof TransportError && error.kind === 'ABORTED') throw error;
    if (error instanceof TransportError && error.kind === 'TIMEOUT') {
      throw createFetchError('TIMEOUT', 'Request timed out. Please check your internet connection and try again.');
    }
    if (error instanceof TransportError && error.kind === 'HTTP') {
      if (error.status === 401 || error.status === 403) {
        throw createFetchError('NOT_PUBLIC', 'Sheet is not publicly accessible. Please set sharing to "Anyone with the link can view".');
      }
      if (error.status === 404) {
        throw createFetchError('NOT_FOUND', 'Spreadsheet not found. Please check the URL and make sure the sheet exists.');
      }
      throw createFetchError('NETWORK_ERROR', error.message);
    }
    if (error instanceof TransportError && error.kind === 'LIMIT') {
      throw createFetchError('INVALID_FORMAT', error.message);
    }
    throw error;
  }
}

// ============================================================================
// JSONP Fetching (bypasses CORS)
// ============================================================================

/** Counter for generating unique callback names */
let jsonpCallbackCounter = 0;

/**
 * Fetch data using JSONP (script tag injection).
 * This bypasses CORS restrictions entirely by loading data as a script.
 *
 * The gviz endpoint supports a responseHandler parameter that specifies
 * the callback function name to invoke with the data.
 *
 * @param spreadsheetId - The spreadsheet ID
 * @param gid - Optional worksheet gid
 * @param timeout - Timeout in milliseconds
 * @returns Parsed gviz response data
 */
export async function fetchViaJsonp(
  spreadsheetId: string,
  gid?: string,
  timeout: number = DEFAULT_TIMEOUT,
  options: FetchRequestOptions = {}
): Promise<GvizResponse> {
  return runUpstreamRequest(() => new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new TransportError('Request cancelled', 'ABORTED'));
      return;
    }
    // Generate unique callback name (simple name, no dots)
    const callbackName = `__sheetsCb${Date.now()}${jsonpCallbackCounter++}`;

    // Create script element
    const script = document.createElement('script');
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let resolved = false;
    const onAbort = () => {
      if (resolved) return;
      resolved = true;
      cleanup();
      reject(new TransportError('Request cancelled', 'ABORTED'));
    };

    // Cleanup function
    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      // Remove script from DOM
      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
      // Remove callback from window
      try {
        delete (window as unknown as Record<string, unknown>)[callbackName];
      } catch {
        // Ignore errors during cleanup
      }
      options.signal?.removeEventListener('abort', onAbort);
    };

    // Register callback directly on window (simpler path for Google to call)
    (window as unknown as Record<string, unknown>)[callbackName] = (data: GvizResponse) => {
      if (resolved) return;
      try {
        assertGvizPayloadLimits(data);
        resolved = true;
        cleanup();
        resolve(data);
      } catch (error) {
        resolved = true;
        cleanup();
        reject(error);
      }
    };

    // Set up timeout
    timeoutId = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      cleanup();
      reject(createFetchError('TIMEOUT', 'Request timed out. Please check your internet connection and try again.'));
    }, timeout);
    options.signal?.addEventListener('abort', onAbort, { once: true });

    // Handle script load errors
    script.onerror = (event) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      console.error('JSONP script error:', event);
      reject(createFetchError('NETWORK_ERROR', 'Failed to load sheet data. The sheet may not be publicly accessible.'));
    };

    // Build JSONP URL with our callback (just the function name, Google will call it directly)
    const url = buildJsonpUrl(spreadsheetId, callbackName, gid);

    script.src = url;
    script.async = true;

    // Inject script into page
    document.head.appendChild(script);
  }), options.signal);
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
  gid?: string,
  options: FetchRequestOptions = {}
): Promise<GvizResponse> {
  const gvizData = await retryTransient(
    () => fetchViaJsonp(spreadsheetId, gid, DEFAULT_TIMEOUT, options),
    options.signal
  );

  // Check for errors in the response
  if (gvizData.status === 'error' && gvizData.errors?.length) {
    const errorMsg = gvizData.errors[0]?.message || 'Unknown error';
    const reason = gvizData.errors[0]?.reason || '';

    if (reason === 'access_denied' || errorMsg.toLowerCase().includes('access denied') || errorMsg.toLowerCase().includes('permission')) {
      throw createFetchError(
        'NOT_PUBLIC',
        'Sheet is not publicly accessible. Please set sharing to "Anyone with the link can view".'
      );
    }
    throw createFetchError('NETWORK_ERROR', `Google Sheets error: ${errorMsg}`);
  }

  return gvizData;
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
 * JSONP executes before the callback receives an object, so browser APIs cannot
 * stream-cap the response. Limit the received callback payload immediately and
 * bound the rectangular raw-data footprint before converting it.
 */
function assertGvizPayloadLimits(gviz: GvizResponse): void {
  let serialized: string;
  try {
    serialized = JSON.stringify(gviz);
  } catch {
    throw createNonRetryableFetchError('INVALID_FORMAT', 'Google Sheets returned an invalid JSONP payload');
  }
  if (new TextEncoder().encode(serialized).byteLength > MAX_SHEET_RESPONSE_BYTES) {
    throw createNonRetryableFetchError('INVALID_FORMAT', 'Sheet response exceeds the 5 MiB size limit');
  }

  const columns = gviz.table?.cols?.length || 0;
  const rows = gviz.table?.rows?.length || 0;
  // gvizToRawData writes each data row to the declared column width, even if
  // a sparse row omits cells. Include the potential header row conservatively.
  if (columns * (rows + 1) > 100_000) {
    throw createNonRetryableFetchError('INVALID_FORMAT', 'Sheet exceeds the 100,000-cell import limit');
  }
}

/**
 * Fetch worksheet data using the gviz endpoint via JSONP.
 * Uses script tag injection to bypass CORS restrictions.
 *
 * @param spreadsheetId - The spreadsheet ID
 * @param gid - Worksheet gid (defaults to '0' for first sheet)
 * @returns 2D array of cell values
 */
export async function fetchWorksheetViaGviz(
  spreadsheetId: string,
  gid: string = '0',
  options: FetchRequestOptions = {}
): Promise<string[][]> {
  const cacheKey = `${spreadsheetId}:${gid}`;

  // Check cache
  const cached = worksheetCache.get(cacheKey);
  if (options.refresh === false && cached) {
    return cached;
  }

  // fetchGvizData now uses JSONP internally and handles error checking
  const gvizData = await fetchGvizData(spreadsheetId, gid, options);

  assertGvizPayloadLimits(gvizData);

  const rawData = gvizToRawData(gvizData);
  countWorksheetCells(rawData);

  // Cache the result
  worksheetCache.set(cacheKey, rawData);

  return rawData;
}

// ============================================================================
// Worksheet Discovery
// ============================================================================

/**
 * Google Sheets API response for spreadsheet metadata.
 */
interface SheetsApiMetadataResponse {
  sheets?: Array<{
    properties?: {
      sheetId?: number;
      title?: string;
    };
  }>;
  error?: {
    code?: number;
    message?: string;
  };
}

/**
 * Fetch worksheet metadata using the Google Sheets API.
 * This provides actual sheet names unlike the gviz endpoint.
 *
 * Note: Requires an API key for most sheets. Public sheets may work without one.
 *
 * @param spreadsheetId - The spreadsheet ID
 * @param apiKey - Optional Google Sheets API key
 * @returns Array of worksheet metadata with actual names
 */
async function fetchSheetMetadataViaApi(
  spreadsheetId: string,
  apiKey?: string,
  options: FetchRequestOptions = {}
): Promise<WorksheetMeta[] | null> {
  try {
    // Build the API URL - only request the fields we need
    let url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties(sheetId,title)`;

    if (apiKey) {
      url += `&key=${apiKey}`;
    }

    console.log('Fetching sheet metadata via Sheets API...');

    const data = await runUpstreamRequest(() => withRequestDeadline(async (signal) => {
      const response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal,
      });
      if (!response.ok) {
        console.warn(`Sheets API returned ${response.status}: ${response.statusText}`);
        return null;
      }
      return JSON.parse(await readResponseTextBounded(response, MAX_SHEET_RESPONSE_BYTES, signal)) as SheetsApiMetadataResponse;
    }, options), options.signal);
    if (!data) return null;

    if (data.error) {
      console.warn('Sheets API error:', data.error.message);
      return null;
    }

    if (!data.sheets || data.sheets.length === 0) {
      console.warn('Sheets API returned no sheets');
      return null;
    }

    if (data.sheets.length > MAX_WORKSHEETS) {
      throw createNonRetryableFetchError('INVALID_FORMAT', 'Spreadsheet exceeds the 200-worksheet import limit');
    }

    // Convert to our WorksheetMeta format
    const worksheets: WorksheetMeta[] = data.sheets
      .filter(sheet => sheet.properties?.title && sheet.properties?.sheetId !== undefined)
      .map(sheet => ({
        gid: String(sheet.properties!.sheetId),
        name: sheet.properties!.title!,
      }));

    console.log('Got sheet metadata from API:', worksheets);
    return worksheets;
  } catch (error) {
    if (error instanceof TransportError && (error.kind === 'ABORTED' || error.kind === 'LIMIT')) throw error;
    console.warn('Failed to fetch sheet metadata via API:', error);
    return null;
  }
}

/**
 * Try to extract sheet name from gviz response.
 * The gviz API doesn't directly provide sheet names, but we can try to infer it.
 *
 * @param _response - The gviz API response (unused, kept for future expansion)
 * @returns Sheet name if found, empty string otherwise
 */
function extractSheetNameFromGviz(_response: GvizResponse): string {
  // The gviz response doesn't typically include sheet names,
  // so we return empty string and let the caller handle naming
  // This is a fallback - the Sheets API metadata fetch is preferred
  return '';
}

/**
 * Probe a single gid to see if it exists.
 * Returns worksheet metadata if found, null otherwise.
 */
async function probeGid(
  spreadsheetId: string,
  gid: string,
  options: FetchRequestOptions = {}
): Promise<WorksheetMeta | null> {
  try {
    // Use a short timeout for probing
    const response = await fetchViaJsonp(spreadsheetId, gid, 5000, options);

    // Check if we got valid data (has table with rows or cols)
    if (response.table && (response.table.cols?.length || response.table.rows?.length)) {
      // Try to extract sheet name from response
      const name = extractSheetNameFromGviz(response);
      return { gid, name: name || '' }; // Name will be assigned later if empty
    }
  } catch (error) {
    if (error instanceof TransportError && (error.kind === 'ABORTED' || error.kind === 'LIMIT')) throw error;
    // This gid doesn't exist or isn't accessible
  }
  return null;
}

/** Google Sheets API key for fetching worksheet metadata (optional, only needed for fallback mode) */
let googleSheetsApiKey: string | undefined;

/**
 * Set the Google Sheets API key for fetching worksheet metadata.
 * Get a free API key from Google Cloud Console.
 */
export function setGoogleSheetsApiKey(apiKey: string | undefined): void {
  googleSheetsApiKey = apiKey;
}

/**
 * Fetch bold formatting info for a worksheet.
 *
 * Uses the Google Sheets API to get text formatting for the first row and first column,
 * which is used to determine sheet orientation (bold = labels).
 *
 * @param spreadsheetId - The spreadsheet ID
 * @param sheetName - The worksheet name
 * @returns BoldInfo or null if unable to fetch
 */
export async function fetchBoldInfo(
  spreadsheetId: string,
  sheetName: string,
  options: FetchRequestOptions = {}
): Promise<BoldInfo | null> {
  const cacheKey = `${spreadsheetId}:${sheetName}`;
  const cached = boldInfoCache.get(cacheKey);
  if (options.refresh === false && cached) {
    return cached;
  }

  if (!googleSheetsApiKey) {
    return null;
  }

  try {
    // Fetch formatting for first row (A1:Z1) and first column (A1:A100)
    const quotedSheetName = `'${sheetName.replace(/'/g, "''")}'`;
    const firstRowRange = encodeURIComponent(`${quotedSheetName}!1:1`);
    const firstColumnRange = encodeURIComponent(`${quotedSheetName}!A1:A100`);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?ranges=${firstRowRange}&ranges=${firstColumnRange}&fields=sheets.data.rowData.values.effectiveFormat.textFormat.bold&key=${googleSheetsApiKey}`;

    const json = await runUpstreamRequest(() => withRequestDeadline(async (signal) => {
      const response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal,
      });
      if (!response.ok) {
        console.warn(`Sheets API formatting request returned ${response.status}`);
        return null;
      }
      return JSON.parse(await readResponseTextBounded(response, MAX_SHEET_RESPONSE_BYTES, signal));
    }, options), options.signal);
    if (!json) return null;
    if (json.error) {
      console.warn('Sheets API formatting error:', json.error.message);
      return null;
    }

    const sheets = json.sheets || [];
    if (sheets.length === 0 || !sheets[0].data) {
      return null;
    }

    const dataRanges = sheets[0].data;

    // Extract first row bold info
    const firstRowBold: boolean[] = [];
    if (dataRanges[0]?.rowData?.[0]?.values) {
      for (const cell of dataRanges[0].rowData[0].values) {
        firstRowBold.push(cell?.effectiveFormat?.textFormat?.bold === true);
      }
    }

    // Extract first column bold info
    const firstColBold: boolean[] = [];
    if (dataRanges[1]?.rowData) {
      for (const row of dataRanges[1].rowData) {
        const cell = row.values?.[0];
        firstColBold.push(cell?.effectiveFormat?.textFormat?.bold === true);
      }
    }

    const boldInfo: BoldInfo = { firstRowBold, firstColBold };
    boldInfoCache.set(cacheKey, boldInfo);
    return boldInfo;
  } catch (error) {
    if (error instanceof TransportError && error.kind === 'ABORTED') throw error;
    console.warn('Failed to fetch bold formatting:', error);
    return null;
  }
}

/**
 * Discover all worksheets in a spreadsheet.
 *
 * Strategy:
 * 1. Try the Google Sheets API first (provides actual sheet names)
 * 2. Fall back to probing gids via JSONP if API fails
 *
 * @param spreadsheetId - The spreadsheet ID
 * @param gidHint - Optional gid from URL to include in probing
 * @returns Array of worksheet metadata
 */
export async function discoverWorksheets(
  spreadsheetId: string,
  gidHint?: string,
  options: FetchRequestOptions = {}
): Promise<WorksheetDiscovery> {
  // Check cache
  const cacheKey = sheetDataCacheKey(spreadsheetId, gidHint);
  const cached = worksheetMetaCache.get(cacheKey);
  if (options.refresh === false && cached) {
    return { worksheets: cached, limited: worksheetDiscoveryLimitedCache.get(cacheKey) === true };
  }

  // Strategy 1: Try the Google Sheets API (provides actual sheet names)
  const apiMetadata = await fetchSheetMetadataViaApi(spreadsheetId, googleSheetsApiKey, options);
  if (apiMetadata && apiMetadata.length > 0) {
    worksheetMetaCache.set(cacheKey, apiMetadata);
    worksheetDiscoveryLimitedCache.set(cacheKey, false);
    return { worksheets: apiMetadata, limited: false };
  }

  // Strategy 2: Fall back to probing gids via JSONP
  console.log('Falling back to JSONP probing for worksheet discovery...');

  // Common gids to probe - first sheet is always 0, others vary
  const gidsToProbe = new Set(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);

  // Add the gid hint if provided (in case it's a non-sequential gid)
  if (gidHint) {
    gidsToProbe.add(gidHint);
  }

  const results: Array<WorksheetMeta | null> = [];
  const probeIds = Array.from(gidsToProbe);
  for (let start = 0; start < probeIds.length; start += 3) {
    const batch = await Promise.all(probeIds.slice(start, start + 3).map((probeId) =>
      runWorksheetTask(() => probeGid(spreadsheetId, probeId, options), options.signal)
    ));
    results.push(...batch);
  }

  // Collect found worksheets
  const foundGids = results
    .filter((result): result is WorksheetMeta => result !== null)
    .map(ws => ws.gid);

  console.log(`Found ${foundGids.length} worksheets with gids:`, foundGids);

  // If no worksheets found, return default
  if (foundGids.length === 0) {
    console.log('No worksheets found via probing, using fallback');
    const worksheets = [{ name: 'Sheet1', gid: '0' }];
    worksheetMetaCache.set(cacheKey, worksheets);
    worksheetDiscoveryLimitedCache.set(cacheKey, true);
    return { worksheets, limited: true };
  }

  // Sort by gid numerically and assign placeholder names
  const worksheets: WorksheetMeta[] = foundGids
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
    .map((gid, index) => ({
      gid,
      name: index === 0 ? 'Sheet1' : `Sheet${index + 1}`,
    }));

  // Cache and return
  worksheetMetaCache.set(cacheKey, worksheets);
  worksheetDiscoveryLimitedCache.set(cacheKey, true);
  console.log(`Discovered ${worksheets.length} worksheets:`, worksheets);
  return { worksheets, limited: true };
}

// ============================================================================
// Main Sheet Data Fetching
// ============================================================================

/**
 * Fetch complete sheet data from a Google Sheets spreadsheet.
 *
 * This discovers all worksheets and fetches data from each one,
 * returning the complete SheetData with all worksheets.
 *
 * @param spreadsheetId - The spreadsheet ID
 * @param gid - Optional worksheet gid (used to set activeWorksheet)
 * @returns FetchResult with success status and data or error
 *
 * @example
 * const result = await fetchSheetData('abc123');
 * if (result.success) {
 *   console.log(result.data.worksheets.map(w => w.name));
 * } else {
 *   console.error(result.error.message);
 * }
 */
export async function fetchSheetData(
  spreadsheetId: string,
  gid?: string,
  options: FetchRequestOptions = {}
): Promise<FetchResult> {
  const cacheKey = sheetDataCacheKey(spreadsheetId, gid);
  if (!options.signal && inFlightSheetFetches.has(cacheKey)) {
    return inFlightSheetFetches.get(cacheKey)!;
  }

  const operation = withRequestDeadline(
    (signal) => fetchSheetDataFresh(spreadsheetId, gid, { ...options, signal }),
    options,
    SHEET_FETCH_DEADLINE_MS
  );
  if (!options.signal) {
    inFlightSheetFetches.set(cacheKey, operation);
    void operation.then(
      () => inFlightSheetFetches.delete(cacheKey),
      () => inFlightSheetFetches.delete(cacheKey)
    );
  }
  return operation;
}

async function fetchSheetDataFresh(
  spreadsheetId: string,
  gid: string | undefined,
  options: FetchRequestOptions
): Promise<FetchResult> {
  try {
    throwIfAborted(options.signal);
    // A completed snapshot is used only when a caller explicitly asks for it.
    const cacheKey = sheetDataCacheKey(spreadsheetId, gid);
    const cached = sheetCache.get(cacheKey);
    if (options.refresh === false && cached) {
      return { success: true, data: cached };
    }

    // Discover all worksheets in the spreadsheet
    // Pass gid as hint in case it's a non-sequential gid
    const discovery = await discoverWorksheets(spreadsheetId, gid, options);
    const worksheetMetas = discovery.worksheets;
    if (gid && !worksheetMetas.some((worksheet) => worksheet.gid === gid)) {
      return {
        success: false,
        error: {
          type: 'NOT_FOUND',
          message: `Requested worksheet gid ${gid} could not be discovered. JSONP probing is limited; use the Worker or a Sheets API key for complete discovery.`,
        },
      };
    }

    // Fetch data for each worksheet (with bold info for orientation detection)
    const worksheets: Worksheet[] = [];
    const diagnostics: DataDiagnostic[] = [];
    if (discovery.limited) {
      diagnostics.push({
        code: 'missing-worksheet',
        severity: 'warning',
        message: 'JSONP discovery probes a limited set of worksheet IDs; tabs with other IDs may be missing. Use the Worker or a Sheets API key for complete discovery.',
      });
    }

    const fetchWorksheet = async (meta: WorksheetMeta): Promise<Worksheet | null> => {
      try {
        const [rawData, boldInfo] = await Promise.all([
          fetchWorksheetViaGviz(spreadsheetId, meta.gid, options),
          fetchBoldInfo(spreadsheetId, meta.name, options),
        ]);
        countWorksheetCells(rawData);
        return buildWorksheet(rawData, meta.name, {
          boldInfo: boldInfo || undefined,
          id: meta.gid,
        });
      } catch (error) {
        if (error instanceof TransportError && error.kind === 'ABORTED') throw error;
        diagnostics.push({
          code: 'missing-worksheet',
          worksheet: meta.name,
          severity: 'error',
          message: error instanceof Error ? error.message : 'Worksheet fetch failed',
        });
        return null;
      }
    };

    for (let start = 0; start < worksheetMetas.length; start += 3) {
      const batch = await Promise.all(worksheetMetas.slice(start, start + 3).map((meta) =>
        runWorksheetTask(() => fetchWorksheet(meta), options.signal)
      ));
      for (const worksheet of batch) {
        if (worksheet) worksheets.push(worksheet);
      }
    }

    if (worksheets.length === 0) {
      return { success: false, error: { type: 'UNKNOWN', message: 'Failed to fetch any worksheet data' } };
    }

    // Determine active worksheet
    let activeWorksheet = worksheets[0]?.name || '';
    if (gid && worksheetMetas.length > 0) {
      const matchingMeta = worksheetMetas.find(m => m.gid === gid);
      if (matchingMeta) {
        activeWorksheet = matchingMeta.name;
      }
    }

    let totalCells = 0;
    for (const worksheet of worksheets) {
      totalCells += countWorksheetCells(worksheet.rawData || []);
      if (totalCells > MAX_SOURCE_CELLS) {
        throw createFetchError('INVALID_FORMAT', 'Spreadsheet exceeds the 500,000-cell import limit');
      }
    }
    const sheetData: SheetData = {
      worksheets,
      activeWorksheet,
      diagnostics,
    };

    // Cache the result
    sheetCache.set(cacheKey, sheetData);

    return { success: true, data: sheetData };
  } catch (error) {
    if (error instanceof TransportError && error.kind === 'ABORTED') throw error;
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
  gid: string = '0',
  options: FetchRequestOptions = {}
): Promise<SheetData> {
  const result = await fetchSheetData(spreadsheetId, gid, options);
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

/** A validation failure must not use retryTransient's network retry path. */
function createNonRetryableFetchError(type: FetchErrorType, message: string): TransportError & FetchError {
  const error = new TransportError(message, 'LIMIT') as TransportError & FetchError;
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
