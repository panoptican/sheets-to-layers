/** Cloudflare Worker-based data fetching from the UI context. */

import type { BoldInfo, DataDiagnostic, SheetData, Worksheet } from './types';
import { buildWorksheet } from './sheet-structure';
import { validateWorkerUrl } from '../utils/url';
import {
  FetchRequestOptions,
  MAX_IMAGE_RESPONSE_BYTES,
  MAX_SHEET_RESPONSE_BYTES,
  MAX_SOURCE_CELLS,
  MAX_WORKSHEETS,
  countWorksheetCells,
  parseRetryAfter,
  readResponseBytesBounded,
  readResponseTextBounded,
  retryTransient,
  runImageRequest,
  runUpstreamRequest,
  runWorksheetTask,
  throwIfAborted,
  TransportError,
  withRequestDeadline,
} from './transport';

interface WorkerDiscoveryResponse {
  sheets: Array<{ title: string; sheetId: number; index: number }>;
  error?: string;
}

interface WorkerDataResponse {
  tabName: string;
  values: string[][];
  error?: string;
}

interface WorkerBoldInfoResponse {
  tabName: string;
  firstRowBold: boolean[];
  firstColBold: boolean[];
  error?: string;
}

export interface WorkerFetchResult {
  success: boolean;
  data?: SheetData;
  error?: string;
}

const DEFAULT_WORKER_URL = 'https://sheets-proxy.spidleweb.workers.dev';
let workerUrl: string | null = DEFAULT_WORKER_URL;

export function setWorkerUrl(url: string | null): void {
  const validation = validateWorkerUrl(url);
  if (!validation.isValid) {
    throw new Error(validation.errorMessage);
  }
  if (validation.disabled) {
    workerUrl = null;
    return;
  }
  workerUrl = validation.normalizedUrl!;
}

export function getWorkerUrl(): string | null {
  return workerUrl;
}

export function isWorkerEnabled(): boolean {
  return workerUrl !== null && workerUrl.trim() !== '';
}

function buildWorkerUrl(parameters: Record<string, string>): string {
  if (!workerUrl) throw new Error('Worker URL not configured');
  // setWorkerUrl validated this base already. Preserve percent encoding because
  // URLSearchParams changes encoded spaces in the embedded source URL to '+'.
  const query = Object.entries({ ...parameters, _cb: String(Date.now()) })
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
  return `${workerUrl}${workerUrl.includes('?') ? '&' : '?'}${query}`;
}

function assertSupportedFigmaImage(data: Uint8Array, contentType: string): void {
  const isPng = data.length >= 8 && data.slice(0, 8).every((byte, index) => byte === [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a][index]);
  const isJpeg = data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  const signature = new TextDecoder().decode(data.slice(0, 6));
  const isGif = signature === 'GIF87a' || signature === 'GIF89a';
  const supported = (contentType === 'image/png' && isPng)
    || (contentType === 'image/jpeg' && isJpeg)
    || (contentType === 'image/gif' && isGif);
  if (!supported) throw new TransportError('Image must be a valid PNG, JPEG, or GIF for Figma', 'LIMIT');
}

function isResponseLike(response: unknown): response is Response {
  return typeof response === 'object' && response !== null && 'ok' in response;
}

async function readWorkerError(response: Response, signal?: AbortSignal): Promise<string> {
  try {
    const text = await readResponseTextBounded(response, MAX_SHEET_RESPONSE_BYTES, signal, 'Worker response');
    const parsed = JSON.parse(text) as { error?: unknown };
    return typeof parsed.error === 'string' && parsed.error.trim()
      ? parsed.error.trim()
      : `Worker returned ${response.status}`;
  } catch {
    return `Worker returned ${response.status}`;
  }
}

async function fetchWorkerJson<T>(
  parameters: Record<string, string>,
  context: string,
  options: FetchRequestOptions = {}
): Promise<T> {
  const url = buildWorkerUrl(parameters);
  return retryTransient(async () => runUpstreamRequest(async () => withRequestDeadline(async (signal) => {
    const rawResponse = await fetch(url, { cache: 'no-store', signal });
    if (rawResponse === null || rawResponse === undefined) {
      throw new TransportError(`No response received from worker while ${context}`, 'LIMIT');
    }
    if (!isResponseLike(rawResponse)) {
      throw new TransportError(`Malformed response received from worker while ${context}`, 'LIMIT');
    }
    if (!rawResponse.ok) {
      const message = await readWorkerError(rawResponse, signal);
      throw new TransportError(
        message,
        'HTTP',
        rawResponse.status,
        parseRetryAfter(rawResponse.headers?.get('retry-after') ?? null)
      );
    }
    const text = await readResponseTextBounded(rawResponse, MAX_SHEET_RESPONSE_BYTES, signal, 'Worker sheet response');
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new TransportError(`Malformed JSON received from worker while ${context}`, 'LIMIT');
    }
  }, options), options.signal), options.signal);
}

async function fetchWorksheetsViaWorker(
  spreadsheetId: string,
  options?: FetchRequestOptions
): Promise<WorkerDiscoveryResponse> {
  return fetchWorkerJson({ sheetId: spreadsheetId }, 'fetching worksheet list', options);
}

async function fetchWorksheetDataViaWorker(
  spreadsheetId: string,
  tabName: string,
  options?: FetchRequestOptions
): Promise<WorkerDataResponse> {
  return fetchWorkerJson({ sheetId: spreadsheetId, tabName }, `fetching worksheet "${tabName}"`, options);
}

async function fetchBoldInfoViaWorker(
  spreadsheetId: string,
  tabName: string,
  options?: FetchRequestOptions
): Promise<{ boldInfo: BoldInfo | null; error?: string }> {
  try {
    const data = await fetchWorkerJson<WorkerBoldInfoResponse>(
      { sheetId: spreadsheetId, tabName, boldInfo: 'true' },
      `fetching bold info for "${tabName}"`,
      options
    );
    if (data.error) return { boldInfo: null, error: data.error };
    return { boldInfo: { firstRowBold: data.firstRowBold || [], firstColBold: data.firstColBold || [] } };
  } catch (error) {
    if (error instanceof TransportError && error.kind === 'ABORTED') throw error;
    return { boldInfo: null, error: error instanceof Error ? error.message : 'Formatting request failed' };
  }
}

/** Fetch a Worker-proxied image with a deadline covering body consumption. */
export async function fetchImageViaWorker(
  imageUrl: string,
  options: FetchRequestOptions = {}
): Promise<Uint8Array> {
  const url = buildWorkerUrl({ imageUrl });
  return runImageRequest(async () => retryTransient(async () => withRequestDeadline(async (signal) => {
    const rawResponse = await fetch(url, { cache: 'no-store', signal });
    if (rawResponse === null || rawResponse === undefined) {
      throw new TransportError('No response received from worker while fetching image', 'LIMIT');
    }
    if (!isResponseLike(rawResponse)) {
      throw new TransportError('Malformed response received from worker while fetching image', 'LIMIT');
    }
    if (!rawResponse.ok) {
      throw new TransportError(
        await readWorkerError(rawResponse, signal),
        'HTTP',
        rawResponse.status,
        parseRetryAfter(rawResponse.headers?.get('retry-after') ?? null)
      );
    }
    const contentType = (rawResponse.headers.get('content-type') || '').split(';', 1)[0].toLowerCase();
    const data = await readResponseBytesBounded(rawResponse, MAX_IMAGE_RESPONSE_BYTES, signal, 'Image response');
    assertSupportedFigmaImage(data, contentType);
    return data;
  }, options), options.signal), options.signal);
}

/** Fetch all worksheets through the Worker with a whole-operation deadline. */
export async function fetchSheetDataViaWorker(
  spreadsheetId: string,
  gidHint?: string,
  options: FetchRequestOptions = {}
): Promise<WorkerFetchResult> {
  let sheetDeadlineExceeded = false;
  try {
    throwIfAborted(options.signal);
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onAbort, { once: true });
    const deadlineId = setTimeout(() => {
      sheetDeadlineExceeded = true;
      controller.abort();
    }, 90_000);
    const requestOptions: FetchRequestOptions = { ...options, signal: controller.signal };

    try {
      const discovery = await fetchWorksheetsViaWorker(spreadsheetId, requestOptions);
      if (discovery.error) return { success: false, error: discovery.error };
      if (!Array.isArray(discovery.sheets) || discovery.sheets.length === 0) {
        return { success: false, error: 'No worksheets found in spreadsheet' };
      }
      if (discovery.sheets.length > MAX_WORKSHEETS) {
        return { success: false, error: 'Spreadsheet exceeds the 200-worksheet import limit' };
      }
      if (gidHint && !discovery.sheets.some((sheet) => String(sheet.sheetId) === gidHint)) {
        return { success: false, error: `Requested worksheet gid ${gidHint} was not found in this spreadsheet` };
      }

      const diagnostics: DataDiagnostic[] = [];
      const fetchWorksheet = async (sheet: WorkerDiscoveryResponse['sheets'][number]) => runWorksheetTask(async () => {
        const [data, boldInfo] = await Promise.all([
          fetchWorksheetDataViaWorker(spreadsheetId, sheet.title, requestOptions),
          fetchBoldInfoViaWorker(spreadsheetId, sheet.title, requestOptions),
        ]);
        if (data.error) {
          diagnostics.push({ code: 'missing-worksheet', worksheet: sheet.title, severity: 'error', message: data.error });
          return null;
        }
        const cells = countWorksheetCells(data.values);
        return { worksheet: buildWorksheet(data.values, sheet.title, {
          boldInfo: boldInfo.boldInfo || undefined,
          id: String(sheet.sheetId),
        }), cells };
      }, requestOptions.signal).catch((error) => {
        if (error instanceof TransportError && error.kind === 'ABORTED') throw error;
        diagnostics.push({ code: 'missing-worksheet', worksheet: sheet.title, severity: 'error', message: error instanceof Error ? error.message : 'Worksheet fetch failed' });
        return null;
      });

      // Bound both active worksheet tasks and the materialized result list.
      // Stop launching new requests once a source-level limit is reached.
      const results: Array<{ worksheet: Worksheet; cells: number } | null> = [];
      let observedCells = 0;
      for (let start = 0; start < discovery.sheets.length; start += 3) {
        const batch = await Promise.all(discovery.sheets.slice(start, start + 3).map(fetchWorksheet));
        const batchCells = batch.reduce((total, result) => total + (result?.cells || 0), 0);
        if (observedCells + batchCells > MAX_SOURCE_CELLS) {
          diagnostics.push({ code: 'limit-exceeded', severity: 'error', message: 'Spreadsheet exceeds the 500,000-cell import limit' });
          break;
        }
        observedCells += batchCells;
        results.push(...batch);
      }

      for (let index = 0; index < results.length; index++) {
        const result = results[index];
        if (result && result.worksheet.boldInfo === undefined) {
          diagnostics.push({
            code: 'missing-worksheet',
            worksheet: discovery.sheets[index].title,
            severity: 'warning',
            message: 'Worksheet formatting could not be fetched; orientation used values only.',
          });
        }
      }

      const worksheets: Worksheet[] = [];
      for (const result of results) {
        if (!result) continue;
        worksheets.push(result.worksheet);
      }
      if (worksheets.length === 0) return { success: false, error: 'Failed to fetch any worksheet data' };
      const matched = gidHint ? discovery.sheets.find((sheet) => String(sheet.sheetId) === gidHint) : undefined;
      return { success: true, data: { worksheets, activeWorksheet: matched?.title ?? worksheets[0].name, diagnostics } };
    } finally {
      clearTimeout(deadlineId);
      options.signal?.removeEventListener('abort', onAbort);
    }
  } catch (error) {
    if (sheetDeadlineExceeded && error instanceof TransportError && error.kind === 'ABORTED' && !options.signal?.aborted) {
      return { success: false, error: 'Sheet fetch timed out after 90 seconds' };
    }
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
