/**
 * Tests for Cloudflare Worker-based data fetching.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  setWorkerUrl,
  getWorkerUrl,
  isWorkerEnabled,
  fetchImageViaWorker,
  fetchSheetDataViaWorker,
} from '../../src/core/worker-fetcher';

// Mock fetch globally
const mockFetch = vi.fn();
(global as Record<string, unknown>).fetch = mockFetch;

describe('worker-fetcher', () => {
  const DEFAULT_WORKER_URL = 'https://sheets-proxy.spidleweb.workers.dev';

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to default worker URL
    setWorkerUrl(DEFAULT_WORKER_URL);
  });

  afterEach(() => {
    setWorkerUrl(DEFAULT_WORKER_URL);
  });

  describe('setWorkerUrl / getWorkerUrl', () => {
    it('sets and gets the worker URL', () => {
      const customUrl = 'https://my-worker.example.workers.dev';
      setWorkerUrl(customUrl);
      expect(getWorkerUrl()).toBe(customUrl);
    });

    it('can set URL to null', () => {
      setWorkerUrl(null);
      expect(getWorkerUrl()).toBe(null);
    });

    it('preserves the default URL', () => {
      expect(getWorkerUrl()).toBe(DEFAULT_WORKER_URL);
    });
  });

  describe('isWorkerEnabled', () => {
    it('returns true when URL is set', () => {
      setWorkerUrl('https://worker.example.com');
      expect(isWorkerEnabled()).toBe(true);
    });

    it('returns false when URL is null', () => {
      setWorkerUrl(null);
      expect(isWorkerEnabled()).toBe(false);
    });

    it('returns false when URL is empty string', () => {
      setWorkerUrl('');
      expect(isWorkerEnabled()).toBe(false);
    });

    it('returns false when URL is whitespace only', () => {
      setWorkerUrl('   ');
      expect(isWorkerEnabled()).toBe(false);
    });
  });

  describe('fetchImageViaWorker', () => {
    it('throws error when worker URL is not configured', async () => {
      setWorkerUrl(null);

      await expect(fetchImageViaWorker('https://example.com/image.png')).rejects.toThrow(
        'Worker URL not configured'
      );
    });

    it('fetches image via worker proxy', async () => {
      const imageData = new Uint8Array([1, 2, 3, 4, 5]);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(imageData.buffer),
      });

      const result = await fetchImageViaWorker('https://example.com/image.png');

      expect(mockFetch).toHaveBeenCalledWith(
        `${DEFAULT_WORKER_URL}?imageUrl=${encodeURIComponent('https://example.com/image.png')}`
      );
      expect(result).toEqual(imageData);
    });

    it('throws error on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      await expect(fetchImageViaWorker('https://example.com/image.png')).rejects.toThrow(
        'Failed to fetch image via worker: 404'
      );
    });

    it('encodes special characters in image URL', async () => {
      const imageData = new Uint8Array([1, 2, 3]);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(imageData.buffer),
      });

      await fetchImageViaWorker('https://example.com/image with spaces.png');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(encodeURIComponent('https://example.com/image with spaces.png'))
      );
    });
  });

  describe('fetchSheetDataViaWorker', () => {
    const spreadsheetId = 'abc123';

    it('throws error when worker URL is not configured', async () => {
      setWorkerUrl(null);

      const result = await fetchSheetDataViaWorker(spreadsheetId);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Worker URL not configured');
    });

    it('returns error when discovery returns error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ error: 'Spreadsheet not found' }),
      });

      const result = await fetchSheetDataViaWorker(spreadsheetId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Spreadsheet not found');
    });

    it('returns error when no worksheets found', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ sheets: [] }),
      });

      const result = await fetchSheetDataViaWorker(spreadsheetId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('No worksheets found in spreadsheet');
    });

    it('returns error when sheets is undefined', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const result = await fetchSheetDataViaWorker(spreadsheetId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('No worksheets found in spreadsheet');
    });

    it('successfully fetches sheet data with single worksheet', async () => {
      // Discovery response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            sheets: [{ title: 'Sheet1', sheetId: 0, index: 0 }],
          }),
      });

      // Worksheet data response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            tabName: 'Sheet1',
            values: [
              ['Name', 'Age'],
              ['Alice', '30'],
              ['Bob', '25'],
            ],
          }),
      });

      const result = await fetchSheetDataViaWorker(spreadsheetId);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data!.worksheets.length).toBe(1);
      expect(result.data!.worksheets[0].name).toBe('Sheet1');
      expect(result.data!.activeWorksheet).toBe('Sheet1');
    });

    it('successfully fetches sheet data with multiple worksheets', async () => {
      // Discovery response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            sheets: [
              { title: 'Sheet1', sheetId: 0, index: 0 },
              { title: 'Products', sheetId: 123, index: 1 },
            ],
          }),
      });

      // Worksheet data and bold info responses (2 worksheets x 2 requests each)
      // Sheet1 data
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            tabName: 'Sheet1',
            values: [['Header'], ['Value']],
          }),
      });
      // Sheet1 bold info
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            tabName: 'Sheet1',
            firstRowBold: [true],
            firstColBold: [true, false],
          }),
      });
      // Products data
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            tabName: 'Products',
            values: [['Product'], ['Widget']],
          }),
      });
      // Products bold info
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            tabName: 'Products',
            firstRowBold: [true],
            firstColBold: [true, false],
          }),
      });

      const result = await fetchSheetDataViaWorker(spreadsheetId);

      expect(result.success).toBe(true);
      expect(result.data!.worksheets.length).toBe(2);
    });

    it('sets active worksheet based on gidHint', async () => {
      // Discovery response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            sheets: [
              { title: 'Sheet1', sheetId: 0, index: 0 },
              { title: 'Products', sheetId: 123, index: 1 },
            ],
          }),
      });

      // Worksheet data responses
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            tabName: 'Sheet1',
            values: [['Header'], ['Value']],
          }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            tabName: 'Products',
            values: [['Product'], ['Widget']],
          }),
      });

      const result = await fetchSheetDataViaWorker(spreadsheetId, '123');

      expect(result.success).toBe(true);
      expect(result.data!.activeWorksheet).toBe('Products');
    });

    it('handles worksheet fetch failure gracefully', async () => {
      // Discovery response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            sheets: [
              { title: 'Sheet1', sheetId: 0, index: 0 },
              { title: 'FailSheet', sheetId: 1, index: 1 },
            ],
          }),
      });

      // First worksheet succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            tabName: 'Sheet1',
            values: [['Header'], ['Value']],
          }),
      });

      // Second worksheet fails with error in response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            error: 'Access denied',
          }),
      });

      const result = await fetchSheetDataViaWorker(spreadsheetId);

      expect(result.success).toBe(true);
      expect(result.data!.worksheets.length).toBe(1);
      expect(result.data!.worksheets[0].name).toBe('Sheet1');
    });

    it('handles all worksheet fetches failing', async () => {
      // Discovery response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            sheets: [{ title: 'Sheet1', sheetId: 0, index: 0 }],
          }),
      });

      // Worksheet fetch fails
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            error: 'Access denied',
          }),
      });

      const result = await fetchSheetDataViaWorker(spreadsheetId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to fetch any worksheet data');
    });

    it('handles network error during discovery', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await fetchSheetDataViaWorker(spreadsheetId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network error');
    });

    it('handles non-ok response during discovery', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: () => Promise.resolve({ error: 'Forbidden' }),
      });

      const result = await fetchSheetDataViaWorker(spreadsheetId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Forbidden');
    });

    it('handles non-ok response with no error message', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({}),
      });

      const result = await fetchSheetDataViaWorker(spreadsheetId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Worker returned 500');
    });

    it('handles non-ok response with json parse error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error('Invalid JSON')),
      });

      const result = await fetchSheetDataViaWorker(spreadsheetId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Worker returned 500');
    });

    it('handles worksheet fetch throwing exception', async () => {
      // Discovery response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            sheets: [
              { title: 'Sheet1', sheetId: 0, index: 0 },
              { title: 'ErrorSheet', sheetId: 1, index: 1 },
            ],
          }),
      });

      // First worksheet succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            tabName: 'Sheet1',
            values: [['Header'], ['Value']],
          }),
      });

      // Second worksheet throws
      mockFetch.mockRejectedValueOnce(new Error('Network timeout'));

      const result = await fetchSheetDataViaWorker(spreadsheetId);

      expect(result.success).toBe(true);
      expect(result.data!.worksheets.length).toBe(1);
    });

    it('uses cache buster in URL', async () => {
      const beforeCall = Date.now();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            sheets: [{ title: 'Sheet1', sheetId: 0, index: 0 }],
          }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            tabName: 'Sheet1',
            values: [['Header'], ['Value']],
          }),
      });

      await fetchSheetDataViaWorker(spreadsheetId);

      const afterCall = Date.now();

      // Check that the discovery URL contains a cache buster
      const discoveryCall = mockFetch.mock.calls[0][0];
      expect(discoveryCall).toContain('_cb=');

      // Extract the cache buster value
      const cbMatch = discoveryCall.match(/_cb=(\d+)/);
      expect(cbMatch).not.toBeNull();
      const cbValue = parseInt(cbMatch![1], 10);
      expect(cbValue).toBeGreaterThanOrEqual(beforeCall);
      expect(cbValue).toBeLessThanOrEqual(afterCall);
    });

    it('encodes spreadsheet ID in URL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ sheets: [] }),
      });

      await fetchSheetDataViaWorker('sheet-id-with-special/chars');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(encodeURIComponent('sheet-id-with-special/chars')),
        expect.any(Object)
      );
    });
  });
});
