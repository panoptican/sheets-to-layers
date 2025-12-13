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
import { buildCsvExportUrl, buildJsonExportUrl, buildJsonpUrl } from '../utils/url';
import { rawDataToWorksheetWithDetection } from './sheet-structure';

// ============================================================================
// Constants
// ============================================================================

/** Default timeout for fetch requests (30 seconds) */
const DEFAULT_TIMEOUT = 30000;

/** Number of retries on timeout */
const MAX_RETRIES = 1;

/** CORS proxy URL - used when direct fetch fails due to CORS */
const CORS_PROXY_URL = 'https://corsproxy.io/?';

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
 * Pattern to extract sheet metadata from Google Sheets HTML page.
 * Matches the embedded JSON structure containing sheet names and IDs.
 */
const SHEET_METADATA_PATTERN = /"sheets":\s*(\[[\s\S]*?\])/;

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
  worksheetMetaCache.clear();
  boldInfoCache.clear();
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
// Fetch with Timeout and CORS Proxy
// ============================================================================

/**
 * Check if an error is likely a CORS error.
 */
function isCorsError(error: unknown): boolean {
  if (error instanceof TypeError) {
    // TypeError: Failed to fetch is the typical CORS error
    const message = error.message.toLowerCase();
    return message.includes('failed to fetch') || message.includes('network');
  }
  return false;
}

/**
 * Fetch with timeout support.
 *
 * @param url - URL to fetch
 * @param timeout - Timeout in milliseconds
 * @param useProxy - Whether to use CORS proxy
 * @returns Response object
 */
async function fetchWithTimeout(
  url: string,
  timeout: number = DEFAULT_TIMEOUT,
  useProxy: boolean = false
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  const fetchUrl = useProxy ? `${CORS_PROXY_URL}${encodeURIComponent(url)}` : url;

  try {
    const response = await fetch(fetchUrl, {
      signal: controller.signal,
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

/**
 * Fetch with automatic CORS proxy fallback.
 * Tries direct fetch first, falls back to CORS proxy if CORS error occurs.
 *
 * @param url - URL to fetch
 * @param timeout - Timeout in milliseconds
 * @returns Response object
 */
async function fetchWithCorsProxy(url: string, timeout: number = DEFAULT_TIMEOUT): Promise<Response> {
  try {
    // Try direct fetch first
    return await fetchWithTimeout(url, timeout, false);
  } catch (error) {
    // If it's a CORS error, retry with proxy
    if (isCorsError(error)) {
      console.log('Direct fetch failed due to CORS, retrying with proxy...');
      return await fetchWithTimeout(url, timeout, true);
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
      const response = await fetchWithCorsProxy(url);

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
  timeout: number = DEFAULT_TIMEOUT
): Promise<GvizResponse> {
  return new Promise((resolve, reject) => {
    // Generate unique callback name (simple name, no dots)
    const callbackName = `__sheetsCb${Date.now()}${jsonpCallbackCounter++}`;
    jsonpCallbackCounter++;

    // Create script element
    const script = document.createElement('script');
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let resolved = false;

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
    };

    // Register callback directly on window (simpler path for Google to call)
    (window as unknown as Record<string, unknown>)[callbackName] = (data: GvizResponse) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(data);
    };

    // Set up timeout
    timeoutId = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      cleanup();
      reject(createFetchError('TIMEOUT', 'Request timed out. Please check your internet connection and try again.'));
    }, timeout);

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

    console.log('JSONP fetching from:', url);

    script.src = url;
    script.async = true;

    // Inject script into page
    document.head.appendChild(script);
  });
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
  // Use JSONP to bypass CORS restrictions
  const gvizData = await fetchViaJsonp(spreadsheetId, gid);

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
 * Fetch worksheet data using the gviz endpoint via JSONP.
 * Uses script tag injection to bypass CORS restrictions.
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

  // fetchGvizData now uses JSONP internally and handles error checking
  const gvizData = await fetchGvizData(spreadsheetId, gid);

  const rawData = gvizToRawData(gvizData);

  // Cache the result
  worksheetCache.set(cacheKey, rawData);

  return rawData;
}

// ============================================================================
// Worksheet Discovery
// ============================================================================

/** Cache for worksheet metadata, keyed by spreadsheetId */
const worksheetMetaCache = new Map<string, WorksheetMeta[]>();

/**
 * Extract worksheet metadata from Google Sheets HTML page.
 * Parses the embedded JSON that contains sheet names and IDs.
 *
 * @param html - The HTML content of the spreadsheet page
 * @returns Array of worksheet metadata (name and gid)
 */
function parseWorksheetMetadata(html: string): WorksheetMeta[] {
  const worksheets: WorksheetMeta[] = [];

  try {
    let match;

    // Pattern 1: pubhtml sheet menu links
    // Format: <li id="sheet-menu-0">...</li> with data attributes or href containing gid
    // <li class="sheet-tab-menu..." id="sheet-button-0"><a...href="#gid=0">Sheet1</a></li>
    const pubhtmlPattern = /id="sheet-button-(\d+)"[^>]*>[^<]*<a[^>]*>([^<]+)</gi;
    while ((match = pubhtmlPattern.exec(html)) !== null) {
      worksheets.push({
        gid: match[1],
        name: decodeHtmlEntities(match[2].trim()),
      });
    }

    if (worksheets.length > 0) {
      console.log('Found worksheets via pubhtml pattern');
      return deduplicateWorksheets(worksheets);
    }

    // Pattern 2: Sheet tab with gid in href
    // <a...href="#gid=123"...>SheetName</a>
    const gidHrefPattern = /href="#gid=(\d+)"[^>]*>([^<]+)</gi;
    while ((match = gidHrefPattern.exec(html)) !== null) {
      worksheets.push({
        gid: match[1],
        name: decodeHtmlEntities(match[2].trim()),
      });
    }

    if (worksheets.length > 0) {
      console.log('Found worksheets via gid href pattern');
      return deduplicateWorksheets(worksheets);
    }

    // Pattern 3: JSON format with sheetId and title close together
    // "sheetId":123,"title":"Name" or "sheetId":123,...,"title":"Name"
    const pairPattern = /"sheetId"\s*:\s*(\d+)[^}]*?"title"\s*:\s*"([^"]+)"/g;
    while ((match = pairPattern.exec(html)) !== null) {
      worksheets.push({
        gid: match[1],
        name: decodeUnicodeEscapes(match[2]),
      });
    }

    if (worksheets.length > 0) {
      console.log('Found worksheets via JSON sheetId/title pattern');
      return deduplicateWorksheets(worksheets);
    }

    // Pattern 4: Alternative JSON format with properties wrapper
    // "properties":{"sheetId":123,"title":"Name"...}
    const propsPattern = /"properties"\s*:\s*\{\s*"sheetId"\s*:\s*(\d+)\s*,\s*"title"\s*:\s*"([^"]+)"/g;
    while ((match = propsPattern.exec(html)) !== null) {
      worksheets.push({
        gid: match[1],
        name: decodeUnicodeEscapes(match[2]),
      });
    }

    if (worksheets.length > 0) {
      console.log('Found worksheets via JSON properties pattern');
      return deduplicateWorksheets(worksheets);
    }

    // Pattern 5: data-id and data-name attributes
    // data-id="123" data-name="Sheet1" or variations
    const dataAttrPattern = /data-(?:sheet-)?id="(\d+)"[^>]*data-(?:sheet-)?name="([^"]+)"/gi;
    while ((match = dataAttrPattern.exec(html)) !== null) {
      worksheets.push({
        gid: match[1],
        name: decodeHtmlEntities(match[2]),
      });
    }

    if (worksheets.length > 0) {
      console.log('Found worksheets via data attribute pattern');
      return deduplicateWorksheets(worksheets);
    }

    console.log('No worksheets found with any pattern');

  } catch (error) {
    console.warn('Failed to parse worksheet metadata:', error);
  }

  return worksheets;
}

/**
 * Decode HTML entities like &amp; &lt; etc.
 */
function decodeHtmlEntities(str: string): string {
  const textarea = document.createElement('textarea');
  textarea.innerHTML = str;
  return textarea.value;
}

/**
 * Decode Unicode escapes like \u0020
 */
function decodeUnicodeEscapes(str: string): string {
  return str.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );
}

/**
 * Deduplicate worksheets by gid.
 */
function deduplicateWorksheets(worksheets: WorksheetMeta[]): WorksheetMeta[] {
  const seen = new Set<string>();
  return worksheets.filter(ws => {
    if (seen.has(ws.gid)) return false;
    seen.add(ws.gid);
    return true;
  });
}

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
 * Google Sheets API response for cell formatting.
 */
interface SheetsApiFormattingResponse {
  sheets?: Array<{
    data?: Array<{
      rowData?: Array<{
        values?: Array<{
          effectiveFormat?: {
            textFormat?: {
              bold?: boolean;
            };
          };
        }>;
      }>;
    }>;
  }>;
  error?: {
    code?: number;
    message?: string;
  };
}

/**
 * Bold formatting info for orientation detection.
 */
export interface BoldInfo {
  /** Whether cells in first row are bold */
  firstRowBold: boolean[];
  /** Whether cells in first column are bold */
  firstColBold: boolean[];
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
  apiKey?: string
): Promise<WorksheetMeta[] | null> {
  try {
    // Build the API URL - only request the fields we need
    let url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties(sheetId,title)`;

    if (apiKey) {
      url += `&key=${apiKey}`;
    }

    console.log('Fetching sheet metadata via Sheets API...');

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      console.warn(`Sheets API returned ${response.status}: ${response.statusText}`);
      return null;
    }

    const data: SheetsApiMetadataResponse = await response.json();

    if (data.error) {
      console.warn('Sheets API error:', data.error.message);
      return null;
    }

    if (!data.sheets || data.sheets.length === 0) {
      console.warn('Sheets API returned no sheets');
      return null;
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
    console.warn('Failed to fetch sheet metadata via API:', error);
    return null;
  }
}

/**
 * Probe a single gid to see if it exists.
 * Returns worksheet metadata if found, null otherwise.
 */
async function probeGid(spreadsheetId: string, gid: string): Promise<WorksheetMeta | null> {
  try {
    // Use a short timeout for probing
    const response = await fetchViaJsonp(spreadsheetId, gid, 5000);

    // Check if we got valid data (has table with rows or cols)
    if (response.table && (response.table.cols?.length || response.table.rows?.length)) {
      return { gid, name: '' }; // Name will be assigned later from Sheets API
    }
  } catch {
    // This gid doesn't exist or isn't accessible
  }
  return null;
}

/** Google Sheets API key for fetching worksheet metadata */
let googleSheetsApiKey: string | undefined = 'AIzaSyDSYDjCEVUYxY0KzZQ9_4G5_AzTF29PJGs';

/**
 * Set the Google Sheets API key for fetching worksheet metadata.
 * Get a free API key from Google Cloud Console.
 */
export function setGoogleSheetsApiKey(apiKey: string): void {
  googleSheetsApiKey = apiKey;
}

/** Cache for bold formatting info, keyed by spreadsheetId:sheetName */
const boldInfoCache = new Map<string, BoldInfo>();

/**
 * Fetch bold formatting info for a worksheet using the Google Sheets API.
 * This is used to detect sheet orientation based on which labels are bold.
 *
 * @param spreadsheetId - The spreadsheet ID
 * @param sheetName - The worksheet name (e.g., "Sheet1")
 * @returns BoldInfo with first row and first column bold status, or null if unavailable
 */
export async function fetchBoldInfo(
  spreadsheetId: string,
  sheetName: string
): Promise<BoldInfo | null> {
  const cacheKey = `${spreadsheetId}:${sheetName}`;

  // Check cache
  const cached = boldInfoCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  if (!googleSheetsApiKey) {
    return null;
  }

  try {
    // Encode sheet name for URL (handles spaces and special chars)
    const encodedSheetName = encodeURIComponent(sheetName);

    // Fetch first row (1:1) and first column (A:A) formatting
    // We request a reasonable range to cover typical sheet sizes
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?` +
      `ranges=${encodedSheetName}!1:1&` + // First row
      `ranges=${encodedSheetName}!A1:A100&` + // First column (up to 100 rows)
      `fields=sheets.data.rowData.values.effectiveFormat.textFormat.bold&` +
      `key=${googleSheetsApiKey}`;

    console.log('Fetching bold formatting info...');

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      console.warn(`Sheets API formatting request returned ${response.status}`);
      return null;
    }

    const data: SheetsApiFormattingResponse = await response.json();

    if (data.error) {
      console.warn('Sheets API formatting error:', data.error.message);
      return null;
    }

    // Extract bold info from response
    // First range is row 1, second range is column A
    const sheets = data.sheets || [];
    if (sheets.length === 0 || !sheets[0].data) {
      return null;
    }

    const ranges = sheets[0].data;

    // First row bold values (from first range)
    const firstRowBold: boolean[] = [];
    if (ranges[0]?.rowData?.[0]?.values) {
      for (const cell of ranges[0].rowData[0].values) {
        firstRowBold.push(cell?.effectiveFormat?.textFormat?.bold === true);
      }
    }

    // First column bold values (from second range)
    const firstColBold: boolean[] = [];
    if (ranges[1]?.rowData) {
      for (const row of ranges[1].rowData) {
        const cell = row.values?.[0];
        firstColBold.push(cell?.effectiveFormat?.textFormat?.bold === true);
      }
    }

    const boldInfo: BoldInfo = { firstRowBold, firstColBold };

    console.log('Bold info:', {
      firstRowBoldCount: firstRowBold.filter(b => b).length,
      firstColBoldCount: firstColBold.filter(b => b).length,
    });

    // Cache the result
    boldInfoCache.set(cacheKey, boldInfo);

    return boldInfo;
  } catch (error) {
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
  gidHint?: string
): Promise<WorksheetMeta[]> {
  // Check cache
  const cached = worksheetMetaCache.get(spreadsheetId);
  if (cached) {
    return cached;
  }

  // Strategy 1: Try the Google Sheets API (provides actual sheet names)
  const apiMetadata = await fetchSheetMetadataViaApi(spreadsheetId, googleSheetsApiKey);
  if (apiMetadata && apiMetadata.length > 0) {
    worksheetMetaCache.set(spreadsheetId, apiMetadata);
    return apiMetadata;
  }

  // Strategy 2: Fall back to probing gids via JSONP
  console.log('Falling back to JSONP probing for worksheet discovery...');

  // Common gids to probe - first sheet is always 0, others vary
  const gidsToProbe = new Set(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);

  // Add the gid hint if provided (in case it's a non-sequential gid)
  if (gidHint) {
    gidsToProbe.add(gidHint);
  }

  // Probe all gids in parallel for speed
  const results = await Promise.all(
    Array.from(gidsToProbe).map(gid => probeGid(spreadsheetId, gid))
  );

  // Collect found worksheets
  const foundGids = results
    .filter((result): result is WorksheetMeta => result !== null)
    .map(ws => ws.gid);

  console.log(`Found ${foundGids.length} worksheets with gids:`, foundGids);

  // If no worksheets found, return default
  if (foundGids.length === 0) {
    console.log('No worksheets found via probing, using fallback');
    return [{ name: 'Sheet1', gid: '0' }];
  }

  // Sort by gid numerically and assign placeholder names
  const worksheets: WorksheetMeta[] = foundGids
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
    .map((gid, index) => ({
      gid,
      name: index === 0 ? 'Sheet1' : `Sheet${index + 1}`,
    }));

  // Cache and return
  worksheetMetaCache.set(spreadsheetId, worksheets);
  console.log(`Discovered ${worksheets.length} worksheets:`, worksheets);
  return worksheets;
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
  gid?: string
): Promise<FetchResult> {
  try {
    // Check cache first
    const cached = sheetCache.get(spreadsheetId);
    if (cached) {
      return { success: true, data: cached };
    }

    // Discover all worksheets in the spreadsheet
    // Pass gid as hint in case it's a non-sequential gid
    const worksheetMetas = await discoverWorksheets(spreadsheetId, gid);

    // Fetch data for each worksheet
    const worksheets: Worksheet[] = [];

    for (const meta of worksheetMetas) {
      try {
        // Fetch raw data and bold formatting info in parallel
        const [rawData, boldInfo] = await Promise.all([
          fetchWorksheetViaGviz(spreadsheetId, meta.gid),
          fetchBoldInfo(spreadsheetId, meta.name),
        ]);

        // Convert to worksheet with structure detection (uses bold info when available)
        const worksheet = rawDataToWorksheetWithDetection(rawData, meta.name, boldInfo || undefined);
        worksheets.push(worksheet);
      } catch (error) {
        console.warn(`Failed to fetch worksheet "${meta.name}" (gid=${meta.gid}):`, error);
        // Continue with other worksheets
      }
    }

    // If no worksheets were successfully fetched, try fetching just the first one
    if (worksheets.length === 0) {
      const [rawData, boldInfo] = await Promise.all([
        fetchWorksheetViaGviz(spreadsheetId, gid || '0'),
        fetchBoldInfo(spreadsheetId, 'Sheet1'),
      ]);
      const worksheet = rawDataToWorksheetWithDetection(rawData, 'Sheet1', boldInfo || undefined);
      worksheets.push(worksheet);
    }

    // Determine active worksheet
    let activeWorksheet = worksheets[0]?.name || '';
    if (gid && worksheetMetas.length > 0) {
      const matchingMeta = worksheetMetas.find(m => m.gid === gid);
      if (matchingMeta) {
        activeWorksheet = matchingMeta.name;
      }
    }

    const sheetData: SheetData = {
      worksheets,
      activeWorksheet,
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
