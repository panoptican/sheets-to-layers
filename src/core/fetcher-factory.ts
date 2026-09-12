import { fetchSheetData as fetchSheetDataViaJsonp } from './sheet-fetcher';
import {
  fetchImageViaWorker,
  fetchSheetDataViaWorker,
  isWorkerEnabled,
} from './worker-fetcher';
import type { FetchRequestOptions, SheetFetcher, UnifiedFetchResult } from './fetcher-interface';

const workerFetcher: SheetFetcher = {
  mode: 'worker',
  async fetchSheetData(
    spreadsheetId: string,
    gid?: string,
    options?: FetchRequestOptions
  ): Promise<UnifiedFetchResult> {
    const result = await fetchSheetDataViaWorker(spreadsheetId, gid, options);
    return {
      success: result.success,
      data: result.data,
      error: result.error ? { message: result.error } : undefined,
    };
  },
  async fetchImage(imageUrl: string, options?: FetchRequestOptions): Promise<Uint8Array> {
    return await fetchImageViaWorker(imageUrl, options);
  },
};

const jsonpFetcher: SheetFetcher = {
  mode: 'jsonp',
  async fetchSheetData(
    spreadsheetId: string,
    gid?: string,
    options?: FetchRequestOptions
  ): Promise<UnifiedFetchResult> {
    return await fetchSheetDataViaJsonp(spreadsheetId, gid, options);
  },
};

/**
 * Create a fetcher adapter for current configuration.
 */
export function createSheetFetcher(): SheetFetcher {
  return isWorkerEnabled() ? workerFetcher : jsonpFetcher;
}
