/**
 * Cloudflare Worker-based data fetching.
 *
 * This module provides an alternative to the JSONP-based sheet fetcher,
 * using a Cloudflare Worker as a proxy for the Google Sheets API.
 *
 * Benefits:
 * - Uses official Google Sheets API v4
 * - More reliable than undocumented gviz endpoint
 * - Better handling of special characters in sheet names
 * - Single proxy for both sheet data and images
 */

import type { SheetData, Worksheet, BoldInfo } from './types';
import { rawDataToWorksheetWithDetection } from './sheet-structure';

// ============================================================================
// Types
// ============================================================================

/**
 * Worker discovery response (list of sheets)
 */
interface WorkerDiscoveryResponse {
  sheets: Array<{
    title: string;
    sheetId: number;
    index: number;
  }>;
  error?: string;
}

/**
 * Worker data extraction response
 */
interface WorkerDataResponse {
  tabName: string;
  values: string[][];
  error?: string;
}

/**
 * Worker bold info response
 */
interface WorkerBoldInfoResponse {
  tabName: string;
  firstRowBold: boolean[];
  firstColBold: boolean[];
  error?: string;
}

/**
 * Fetch result from worker
 */
export interface WorkerFetchResult {
  success: boolean;
  data?: SheetData;
  error?: string;
}

// ============================================================================
// Worker URL Configuration
// ============================================================================

const DEFAULT_WORKER_URL = 'https://sheets-proxy.spidleweb.workers.dev';

let workerUrl: string | null = DEFAULT_WORKER_URL;

/**
 * Set the Cloudflare Worker URL to use for fetching.
 * @param url - The worker URL (e.g., https://sheets-proxy.yourname.workers.dev)
 */
export function setWorkerUrl(url: string | null): void {
  workerUrl = url;
}

/**
 * Get the currently configured worker URL.
 */
export function getWorkerUrl(): string | null {
  return workerUrl;
}

/**
 * Check if worker mode is enabled.
 */
export function isWorkerEnabled(): boolean {
  return workerUrl !== null && workerUrl.trim() !== '';
}

// ============================================================================
// Worker-based Fetching
// ============================================================================

/**
 * Fetch list of worksheets from a spreadsheet via worker.
 */
async function fetchWorksheetsViaWorker(
  spreadsheetId: string
): Promise<WorkerDiscoveryResponse> {
  if (!workerUrl) {
    throw new Error('Worker URL not configured');
  }

  // Add cache-busting parameter to prevent browser caching
  const cacheBuster = Date.now();
  const url = `${workerUrl}?sheetId=${encodeURIComponent(spreadsheetId)}&_cb=${cacheBuster}`;
  const response = await fetch(url, { cache: 'no-store' });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Worker returned ${response.status}`);
  }

  return response.json();
}

/**
 * Fetch data for a specific worksheet via worker.
 */
async function fetchWorksheetDataViaWorker(
  spreadsheetId: string,
  tabName: string
): Promise<WorkerDataResponse> {
  if (!workerUrl) {
    throw new Error('Worker URL not configured');
  }

  // Add cache-busting parameter to prevent browser caching
  const cacheBuster = Date.now();
  const url = `${workerUrl}?sheetId=${encodeURIComponent(spreadsheetId)}&tabName=${encodeURIComponent(tabName)}&_cb=${cacheBuster}`;
  const response = await fetch(url, { cache: 'no-store' });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Worker returned ${response.status}`);
  }

  return response.json();
}

/**
 * Fetch bold formatting info for a worksheet via worker.
 * Used for orientation detection (bold = labels).
 */
async function fetchBoldInfoViaWorker(
  spreadsheetId: string,
  tabName: string
): Promise<BoldInfo | null> {
  if (!workerUrl) {
    return null;
  }

  try {
    const cacheBuster = Date.now();
    const url = `${workerUrl}?sheetId=${encodeURIComponent(spreadsheetId)}&tabName=${encodeURIComponent(tabName)}&boldInfo=true&_cb=${cacheBuster}`;
    const response = await fetch(url, { cache: 'no-store' });

    if (!response.ok) {
      console.warn(`[Worker] Failed to fetch bold info: ${response.status}`);
      return null;
    }

    const data: WorkerBoldInfoResponse = await response.json();
    if (data.error) {
      console.warn(`[Worker] Bold info error: ${data.error}`);
      return null;
    }

    return {
      firstRowBold: data.firstRowBold || [],
      firstColBold: data.firstColBold || [],
    };
  } catch (error) {
    console.warn('[Worker] Failed to fetch bold info:', error);
    return null;
  }
}

/**
 * Fetch image via worker proxy.
 * @param imageUrl - The original image URL
 * @returns Uint8Array of image data
 */
export async function fetchImageViaWorker(imageUrl: string): Promise<Uint8Array> {
  if (!workerUrl) {
    throw new Error('Worker URL not configured');
  }

  const url = `${workerUrl}?imageUrl=${encodeURIComponent(imageUrl)}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch image via worker: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

/**
 * Fetch complete sheet data using the Cloudflare Worker.
 *
 * Flow:
 * 1. Discovery: Get list of worksheets
 * 2. Extraction: Fetch data for each worksheet in parallel
 * 3. Transform: Convert to SheetData format
 *
 * @param spreadsheetId - The Google Sheets spreadsheet ID
 * @param gidHint - Optional gid to set as active worksheet
 */
export async function fetchSheetDataViaWorker(
  spreadsheetId: string,
  gidHint?: string
): Promise<WorkerFetchResult> {
  try {
    // Step 1: Discovery - get list of worksheets
    console.log('[Worker] Discovering worksheets...');
    const discovery = await fetchWorksheetsViaWorker(spreadsheetId);

    if (discovery.error) {
      return { success: false, error: discovery.error };
    }

    if (!discovery.sheets || discovery.sheets.length === 0) {
      return { success: false, error: 'No worksheets found in spreadsheet' };
    }

    console.log(`[Worker] Found ${discovery.sheets.length} worksheets`);

    // Step 2: Extraction - fetch data and bold info for each worksheet in parallel
    const worksheetPromises = discovery.sheets.map(async (sheet) => {
      try {
        console.log(`[Worker] Fetching data for "${sheet.title}"...`);

        // Fetch data and bold info in parallel
        const [data, boldInfo] = await Promise.all([
          fetchWorksheetDataViaWorker(spreadsheetId, sheet.title),
          fetchBoldInfoViaWorker(spreadsheetId, sheet.title),
        ]);

        if (data.error) {
          console.warn(`[Worker] Error fetching "${sheet.title}": ${data.error}`);
          return null;
        }

        // Convert 2D array to Worksheet format with bold info for orientation detection
        const worksheet = rawDataToWorksheetWithDetection(
          data.values,
          sheet.title,
          boldInfo || undefined
        );

        return worksheet;
      } catch (error) {
        console.warn(`[Worker] Failed to fetch "${sheet.title}":`, error);
        return null;
      }
    });

    const worksheetResults = await Promise.all(worksheetPromises);
    const worksheets = worksheetResults.filter((ws): ws is Worksheet => ws !== null);

    if (worksheets.length === 0) {
      return { success: false, error: 'Failed to fetch any worksheet data' };
    }

    // Determine active worksheet
    let activeWorksheet = worksheets[0].name;
    if (gidHint) {
      const matchingSheet = discovery.sheets.find(s => String(s.sheetId) === gidHint);
      if (matchingSheet) {
        activeWorksheet = matchingSheet.title;
      }
    }

    const sheetData: SheetData = {
      worksheets,
      activeWorksheet,
    };

    console.log(`[Worker] Successfully fetched ${worksheets.length} worksheets`);

    return { success: true, data: sheetData };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[Worker] Fetch failed:', message);
    return { success: false, error: message };
  }
}
