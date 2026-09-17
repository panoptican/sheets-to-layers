/**
 * Google Sheets URL parsing and validation utilities.
 *
 * Supports various URL formats:
 * - https://docs.google.com/spreadsheets/d/{ID}/edit
 * - https://docs.google.com/spreadsheets/d/{ID}/edit#gid={GID}
 * - https://docs.google.com/spreadsheets/d/{ID}/edit?usp=sharing
 * - https://docs.google.com/spreadsheets/d/{ID}
 * - https://docs.google.com/spreadsheets/d/{ID}/gviz/tq?tqx=out:json
 */

import type { ParsedSheetUrl } from '../core/types';

// ============================================================================
// Constants
// ============================================================================

const SPREADSHEET_PATH_PATTERN = /^\/spreadsheets\/d\/([A-Za-z0-9_-]+)(?:\/|$)/i;
const ALLOWED_GOOGLE_HOSTS = new Set(['docs.google.com', 'www.docs.google.com']);
const MAIN_SAFE_SHEET_URL_PATTERN = /^https:\/\/(docs\.google\.com|www\.docs\.google\.com)(\/[^?#]*)(?:\?([^#]*))?(?:#(.*))?$/i;
const WORKER_URL_PATTERN = /^https:\/\/([A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?)(?::(\d{1,5}))?(\/[^\s?#]*)?$/;

function invalid(errorMessage: string): ParsedSheetUrl {
  return { isValid: false, spreadsheetId: '', errorMessage };
}

function parseGid(queryOrHash: string | undefined): string | undefined | null {
  if (!queryOrHash) return undefined;
  const match = /(?:^|&)gid=([^&]*)/.exec(queryOrHash);
  if (!match) return undefined;
  return /^\d+$/.test(match[1]) ? match[1] : null;
}

/**
 * Main-thread-safe source parser. Figma's document sandbox does not provide the
 * browser URL constructor, so this intentionally accepts only canonical HTTPS
 * Google Sheets URLs and keeps the host/path grammar anchored.
 */
export function parseGoogleSheetsUrlForMain(url: string): ParsedSheetUrl {
  const trimmed = url.trim();
  if (!trimmed) return invalid('Please enter a Google Sheets URL');
  const match = MAIN_SAFE_SHEET_URL_PATTERN.exec(trimmed);
  if (!match) return invalid('URL must be an HTTPS docs.google.com spreadsheet URL');

  const path = match[2];
  if (/^\/forms\/d\//.test(path)) return invalid('This appears to be a Google Forms URL, not a Google Sheets URL');
  if (/^\/(document|presentation|drawings)\/d\//.test(path)) {
    return invalid('This appears to be a Google Doc/Slides/Drawing URL, not a Google Sheets URL');
  }
  const idMatch = path.match(SPREADSHEET_PATH_PATTERN);
  if (!idMatch?.[1]) return invalid('Could not find spreadsheet ID in URL. Make sure you\'re using a valid Google Sheets link.');
  const queryGid = parseGid(match[3]);
  const hashGid = parseGid(match[4]);
  if (queryGid === null || hashGid === null) return invalid('Invalid worksheet gid');
  const gid = queryGid ?? hashGid;
  return { isValid: true, spreadsheetId: idMatch[1], gid };
}

export interface WorkerUrlValidation {
  isValid: boolean;
  /** An empty optional setting intentionally disables Worker mode. */
  disabled?: boolean;
  normalizedUrl?: string;
  errorMessage?: string;
}

/**
 * Validate an optional Worker endpoint without browser-only APIs. The Worker
 * URL never carries source credentials or query parameters; source URLs travel
 * only as individually encoded request parameters.
 */
export function validateWorkerUrl(value: string | null | undefined): WorkerUrlValidation {
  const trimmed = (value || '').trim();
  if (!trimmed) return { isValid: true, disabled: true };
  if (trimmed.length > 2048) return { isValid: false, errorMessage: 'Worker URL is too long' };
  const match = WORKER_URL_PATTERN.exec(trimmed);
  if (!match) return { isValid: false, errorMessage: 'Worker URL must be an HTTPS endpoint without credentials, query, or fragment' };
  const port = match[2] ? Number(match[2]) : undefined;
  if (port !== undefined && (port < 1 || port > 65535)) {
    return { isValid: false, errorMessage: 'Worker URL has an invalid port' };
  }
  const path = match[3] || '';
  return { isValid: true, normalizedUrl: `https://${match[1].toLowerCase()}${port ? `:${port}` : ''}${path}`.replace(/\/$/, '') };
}

// ============================================================================
// URL Parsing
// ============================================================================

/**
 * Parse a Google Sheets URL and extract the spreadsheet ID and optional gid.
 *
 * @param url - The URL to parse (can be empty, malformed, or valid)
 * @returns ParsedSheetUrl with validation result and extracted data
 *
 * @example
 * // Valid URL
 * parseGoogleSheetsUrl('https://docs.google.com/spreadsheets/d/abc123/edit')
 * // => { isValid: true, spreadsheetId: 'abc123' }
 *
 * @example
 * // With gid
 * parseGoogleSheetsUrl('https://docs.google.com/spreadsheets/d/abc123/edit#gid=456')
 * // => { isValid: true, spreadsheetId: 'abc123', gid: '456' }
 *
 * @example
 * // Invalid URL
 * parseGoogleSheetsUrl('https://example.com')
 * // => { isValid: false, spreadsheetId: '', errorMessage: '...' }
 */
export function parseGoogleSheetsUrl(url: string): ParsedSheetUrl {
  // Handle empty or whitespace-only input
  const trimmedUrl = url.trim();
  if (!trimmedUrl) {
    return {
      isValid: false,
      spreadsheetId: '',
      errorMessage: 'Please enter a Google Sheets URL',
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmedUrl);
  } catch {
    return invalid('URL must start with http:// or https://');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return invalid('URL must start with http:// or https://');
  }

  if (parsed.username || parsed.password || !ALLOWED_GOOGLE_HOSTS.has(parsed.hostname.toLowerCase())) {
    return {
      isValid: false,
      spreadsheetId: '',
      errorMessage: 'URL must be from docs.google.com',
    };
  }

  if (/^\/forms\/d\//.test(parsed.pathname)) {
    return {
      isValid: false,
      spreadsheetId: '',
      errorMessage: 'This appears to be a Google Forms URL, not a Google Sheets URL',
    };
  }

  if (/^\/(document|presentation|drawings)\/d\//.test(parsed.pathname)) {
    return {
      isValid: false,
      spreadsheetId: '',
      errorMessage:
        'This appears to be a Google Doc/Slides/Drawing URL, not a Google Sheets URL',
    };
  }

  // Extract spreadsheet ID
  const idMatch = parsed.pathname.match(SPREADSHEET_PATH_PATTERN);
  if (!idMatch || !idMatch[1]) {
    return {
      isValid: false,
      spreadsheetId: '',
      errorMessage:
        'Could not find spreadsheet ID in URL. Make sure you\'re using a valid Google Sheets link.',
    };
  }

  const spreadsheetId = idMatch[1];

  // Validate spreadsheet ID format (should be alphanumeric with hyphens/underscores)
  if (!/^[a-zA-Z0-9_-]+$/.test(spreadsheetId)) {
    return {
      isValid: false,
      spreadsheetId: '',
      errorMessage: 'Invalid spreadsheet ID format',
    };
  }

  // Extract gid if present
  const queryGid = parseGid(parsed.search.replace(/^\?/, ''));
  const hashGid = parseGid(parsed.hash.replace(/^#/, ''));
  if (queryGid === null || hashGid === null) {
    return { isValid: false, spreadsheetId: '', errorMessage: 'Invalid worksheet gid' };
  }
  const gid = queryGid ?? hashGid;

  return { isValid: true, spreadsheetId, gid };
}

// ============================================================================
// URL Building
// ============================================================================

/**
 * Build the export URL for fetching sheet data in CSV format.
 *
 * @param spreadsheetId - The spreadsheet ID
 * @param gid - Optional worksheet gid (defaults to '0' for first sheet)
 * @returns The full export URL
 *
 * @example
 * buildCsvExportUrl('abc123')
 * // => 'https://docs.google.com/spreadsheets/d/abc123/export?format=csv&gid=0'
 *
 * @example
 * buildCsvExportUrl('abc123', '456')
 * // => 'https://docs.google.com/spreadsheets/d/abc123/export?format=csv&gid=456'
 */
export function buildCsvExportUrl(spreadsheetId: string, gid?: string): string {
  const worksheetGid = gid ?? '0';
  return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/export?format=csv&gid=${encodeURIComponent(worksheetGid)}`;
}

/**
 * Build the URL for fetching sheet data as JSON via the visualization API.
 * This endpoint returns data in a JSONP-like format that needs parsing.
 *
 * @param spreadsheetId - The spreadsheet ID
 * @param gid - Optional worksheet gid
 * @returns The visualization API URL
 *
 * @example
 * buildJsonExportUrl('abc123')
 * // => 'https://docs.google.com/spreadsheets/d/abc123/gviz/tq?tqx=out:json'
 */
export function buildJsonExportUrl(spreadsheetId: string, gid?: string): string {
  let url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/gviz/tq?tqx=out:json`;
  if (gid) {
    url += `&gid=${encodeURIComponent(gid)}`;
  }
  return url;
}

/**
 * Build the URL for fetching sheet data via JSONP (script tag injection).
 * This bypasses CORS restrictions by using a callback function.
 *
 * @param spreadsheetId - The spreadsheet ID
 * @param callbackName - The name of the callback function to invoke
 * @param gid - Optional worksheet gid
 * @returns The JSONP URL
 *
 * @example
 * buildJsonpUrl('abc123', 'myCallback')
 * // => 'https://docs.google.com/spreadsheets/d/abc123/gviz/tq?tqx=out:json;responseHandler:myCallback'
 */
export function buildJsonpUrl(spreadsheetId: string, callbackName: string, gid?: string): string {
  let url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/gviz/tq?tqx=out:json;responseHandler:${encodeURIComponent(callbackName)}`;
  if (gid) {
    url += `&gid=${encodeURIComponent(gid)}`;
  }
  return url;
}

/**
 * Build the URL for the sheet's edit page (for metadata fetching).
 *
 * @param spreadsheetId - The spreadsheet ID
 * @returns The edit page URL
 */
export function buildEditUrl(spreadsheetId: string): string {
  return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/edit`;
}

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Check if a URL string looks like it could be a Google Sheets URL.
 * This is a quick check before attempting full parsing.
 *
 * @param url - The URL to check
 * @returns true if the URL might be a Google Sheets URL
 */
export function looksLikeGoogleSheetsUrl(url: string): boolean {
  return parseGoogleSheetsUrl(url).isValid;
}

/**
 * Normalize a Google Sheets URL to a consistent format.
 * Useful for comparing URLs or storing canonical versions.
 *
 * @param url - The URL to normalize
 * @returns Normalized URL or the original if parsing fails
 */
export function normalizeGoogleSheetsUrl(url: string): string {
  const parsed = parseGoogleSheetsUrl(url);
  if (!parsed.isValid) {
    return url;
  }

  let normalized = `https://docs.google.com/spreadsheets/d/${parsed.spreadsheetId}/edit`;
  if (parsed.gid) {
    normalized += `#gid=${parsed.gid}`;
  }
  return normalized;
}
