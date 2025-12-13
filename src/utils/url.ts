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

/**
 * Pattern to extract spreadsheet ID from Google Sheets URLs.
 * Matches: /spreadsheets/d/{SPREADSHEET_ID}
 * The ID can contain alphanumeric characters, hyphens, and underscores.
 */
const SPREADSHEET_ID_PATTERN = /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/;

/**
 * Pattern to extract worksheet gid from URL hash or query params.
 * Matches: #gid=123, ?gid=123, &gid=123
 */
const GID_PATTERN = /[#&?]gid=(\d+)/;

/**
 * Pattern to validate that URL is from Google Docs domain.
 */
const GOOGLE_DOCS_DOMAIN_PATTERN = /^https?:\/\/(docs\.google\.com|www\.docs\.google\.com)/;

/**
 * Pattern to detect Google Forms URLs (to reject them).
 */
const GOOGLE_FORMS_PATTERN = /\/forms\/d\//;

/**
 * Pattern to detect other Google Docs types (to reject them).
 */
const GOOGLE_OTHER_DOCS_PATTERN = /\/(document|presentation|drawings)\/d\//;

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

  // Check if it's a URL at all
  if (!trimmedUrl.startsWith('http://') && !trimmedUrl.startsWith('https://')) {
    return {
      isValid: false,
      spreadsheetId: '',
      errorMessage: 'URL must start with http:// or https://',
    };
  }

  // Check if it's from Google Docs domain
  if (!GOOGLE_DOCS_DOMAIN_PATTERN.test(trimmedUrl)) {
    return {
      isValid: false,
      spreadsheetId: '',
      errorMessage: 'URL must be from docs.google.com',
    };
  }

  // Reject Google Forms
  if (GOOGLE_FORMS_PATTERN.test(trimmedUrl)) {
    return {
      isValid: false,
      spreadsheetId: '',
      errorMessage: 'This appears to be a Google Forms URL, not a Google Sheets URL',
    };
  }

  // Reject other Google Docs types
  if (GOOGLE_OTHER_DOCS_PATTERN.test(trimmedUrl)) {
    return {
      isValid: false,
      spreadsheetId: '',
      errorMessage:
        'This appears to be a Google Doc/Slides/Drawing URL, not a Google Sheets URL',
    };
  }

  // Extract spreadsheet ID
  const idMatch = trimmedUrl.match(SPREADSHEET_ID_PATTERN);
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
  const gidMatch = trimmedUrl.match(GID_PATTERN);
  const gid = gidMatch ? gidMatch[1] : undefined;

  return {
    isValid: true,
    spreadsheetId,
    gid,
  };
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
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${worksheetGid}`;
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
  let url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:json`;
  if (gid) {
    url += `&gid=${gid}`;
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
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
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
  const trimmed = url.trim().toLowerCase();
  return (
    trimmed.includes('docs.google.com') &&
    trimmed.includes('spreadsheets')
  );
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
