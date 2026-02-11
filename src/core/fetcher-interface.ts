import type { SheetData } from './types';

/**
 * Unified sheet fetch result shape used by all fetcher adapters.
 */
export interface UnifiedFetchResult {
  success: boolean;
  data?: SheetData;
  error?: { message: string } | string;
}

/**
 * Shared interface for sheet/image fetch implementations.
 */
export interface SheetFetcher {
  /** Active fetch mode identifier */
  readonly mode: 'worker' | 'jsonp';
  /** Fetch sheet data for a spreadsheet */
  fetchSheetData(spreadsheetId: string, gid?: string): Promise<UnifiedFetchResult>;
  /** Optional image fetch support */
  fetchImage?(imageUrl: string): Promise<Uint8Array>;
}
