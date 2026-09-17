/**
 * Unit tests for sheet fetching utilities.
 *
 * These tests cover the CSV parsing and data transformation functions.
 * Network-dependent functions are tested separately in integration tests.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  parseCSV,
  rawDataToWorksheet,
  discoverWorksheets,
  extractLabelsFromGviz,
  fetchBoldInfo,
  fetchSheetData,
  fetchViaJsonp,
  fetchWorksheetRaw,
  fetchWorksheetViaGviz,
  setGoogleSheetsApiKey,
} from '../../src/core/sheet-fetcher';

describe('parseCSV', () => {
  describe('basic parsing', () => {
    it('parses simple CSV with no special characters', () => {
      const csv = 'Name,Age,City\nAlice,30,NYC\nBob,25,LA';
      const result = parseCSV(csv);
      expect(result).toEqual([
        ['Name', 'Age', 'City'],
        ['Alice', '30', 'NYC'],
        ['Bob', '25', 'LA'],
      ]);
    });

    it('parses single row', () => {
      const csv = 'Col1,Col2,Col3';
      const result = parseCSV(csv);
      expect(result).toEqual([['Col1', 'Col2', 'Col3']]);
    });

    it('parses single cell', () => {
      const csv = 'Value';
      const result = parseCSV(csv);
      expect(result).toEqual([['Value']]);
    });

    it('handles empty string', () => {
      const csv = '';
      const result = parseCSV(csv);
      expect(result).toEqual([[]]);
    });
  });

  describe('empty fields', () => {
    it('handles empty fields at start', () => {
      const csv = ',B,C';
      const result = parseCSV(csv);
      expect(result).toEqual([['', 'B', 'C']]);
    });

    it('handles empty fields in middle', () => {
      const csv = 'A,,C';
      const result = parseCSV(csv);
      expect(result).toEqual([['A', '', 'C']]);
    });

    it('handles empty fields at end', () => {
      const csv = 'A,B,';
      const result = parseCSV(csv);
      expect(result).toEqual([['A', 'B', '']]);
    });

    it('handles multiple empty fields', () => {
      const csv = ',,';
      const result = parseCSV(csv);
      expect(result).toEqual([['', '', '']]);
    });

    it('handles empty rows', () => {
      const csv = 'A,B\n\nC,D';
      const result = parseCSV(csv);
      expect(result).toEqual([['A', 'B'], [''], ['C', 'D']]);
    });
  });

  describe('quoted fields', () => {
    it('handles quoted fields', () => {
      const csv = '"Name","Age"\n"Alice","30"';
      const result = parseCSV(csv);
      expect(result).toEqual([
        ['Name', 'Age'],
        ['Alice', '30'],
      ]);
    });

    it('handles commas inside quotes', () => {
      const csv = '"Name, Full",Age\n"Doe, John",30';
      const result = parseCSV(csv);
      expect(result).toEqual([
        ['Name, Full', 'Age'],
        ['Doe, John', '30'],
      ]);
    });

    it('handles escaped quotes (double quotes)', () => {
      const csv = '"Say ""Hello""",Value\n"Test ""Data""",123';
      const result = parseCSV(csv);
      expect(result).toEqual([
        ['Say "Hello"', 'Value'],
        ['Test "Data"', '123'],
      ]);
    });

    it('handles newlines inside quotes', () => {
      const csv = '"Line1\nLine2",Value';
      const result = parseCSV(csv);
      expect(result).toEqual([['Line1\nLine2', 'Value']]);
    });

    it('handles complex quoted field with commas and newlines', () => {
      const csv = '"Multi-line\nwith, commas",Simple';
      const result = parseCSV(csv);
      expect(result).toEqual([['Multi-line\nwith, commas', 'Simple']]);
    });

    it('handles empty quoted field', () => {
      const csv = '"",Value';
      const result = parseCSV(csv);
      expect(result).toEqual([['', 'Value']]);
    });
  });

  describe('line endings', () => {
    it('handles CRLF line endings', () => {
      const csv = 'A,B\r\nC,D';
      const result = parseCSV(csv);
      expect(result).toEqual([
        ['A', 'B'],
        ['C', 'D'],
      ]);
    });

    it('handles CR only line endings', () => {
      const csv = 'A,B\rC,D';
      const result = parseCSV(csv);
      expect(result).toEqual([
        ['A', 'B'],
        ['C', 'D'],
      ]);
    });

    it('handles LF line endings', () => {
      const csv = 'A,B\nC,D';
      const result = parseCSV(csv);
      expect(result).toEqual([
        ['A', 'B'],
        ['C', 'D'],
      ]);
    });

    it('handles mixed line endings', () => {
      const csv = 'A,B\r\nC,D\nE,F\rG,H';
      const result = parseCSV(csv);
      expect(result).toEqual([
        ['A', 'B'],
        ['C', 'D'],
        ['E', 'F'],
        ['G', 'H'],
      ]);
    });

    it('handles trailing newline', () => {
      const csv = 'A,B\nC,D\n';
      const result = parseCSV(csv);
      // Trailing newline is ignored (standard CSV behavior)
      expect(result).toEqual([
        ['A', 'B'],
        ['C', 'D'],
      ]);
    });
  });

  describe('edge cases', () => {
    it('handles unicode characters', () => {
      const csv = '名前,年齢\nアリス,30\n😀,🎉';
      const result = parseCSV(csv);
      expect(result).toEqual([
        ['名前', '年齢'],
        ['アリス', '30'],
        ['😀', '🎉'],
      ]);
    });

    it('handles whitespace in fields', () => {
      const csv = '  Name  ,  Age  \n  Alice  ,  30  ';
      const result = parseCSV(csv);
      expect(result).toEqual([
        ['  Name  ', '  Age  '],
        ['  Alice  ', '  30  '],
      ]);
    });

    it('handles numbers and special characters', () => {
      const csv = '100,200.5,-300\n$1.00,50%,#hashtag';
      const result = parseCSV(csv);
      expect(result).toEqual([
        ['100', '200.5', '-300'],
        ['$1.00', '50%', '#hashtag'],
      ]);
    });

    it('handles tabs and other whitespace', () => {
      const csv = 'A\tB,C';
      const result = parseCSV(csv);
      expect(result).toEqual([['A\tB', 'C']]);
    });
  });

  describe('real-world examples', () => {
    it('parses product data', () => {
      const csv = 'Product,Price,Description\nWidget,"$19.99","A useful widget, great for tasks"\nGadget,"$29.99","Advanced gadget"';
      const result = parseCSV(csv);
      expect(result).toEqual([
        ['Product', 'Price', 'Description'],
        ['Widget', '$19.99', 'A useful widget, great for tasks'],
        ['Gadget', '$29.99', 'Advanced gadget'],
      ]);
    });

    it('parses address data with newlines', () => {
      const csv = 'Name,Address\n"John Doe","123 Main St\nApt 4\nNew York, NY 10001"';
      const result = parseCSV(csv);
      expect(result).toEqual([
        ['Name', 'Address'],
        ['John Doe', '123 Main St\nApt 4\nNew York, NY 10001'],
      ]);
    });
  });
});

describe('rawDataToWorksheet', () => {
  it('converts basic data to worksheet format', () => {
    const rawData = [
      ['Name', 'Age', 'City'],
      ['Alice', '30', 'NYC'],
      ['Bob', '25', 'LA'],
    ];

    const result = rawDataToWorksheet(rawData, 'Sheet1');

    expect(result.name).toBe('Sheet1');
    expect(result.labels).toEqual(['Name', 'Age', 'City']);
    expect(result.orientation).toBe('columns');
    expect(result.rows).toEqual({
      Name: ['Alice', 'Bob'],
      Age: ['30', '25'],
      City: ['NYC', 'LA'],
    });
  });

  it('handles single row (only headers)', () => {
    const rawData = [['Name', 'Age', 'City']];

    const result = rawDataToWorksheet(rawData, 'Sheet1');

    expect(result.labels).toEqual(['Name', 'Age', 'City']);
    expect(result.rows).toEqual({
      Name: [],
      Age: [],
      City: [],
    });
  });

  it('handles empty data', () => {
    const rawData: string[][] = [];

    const result = rawDataToWorksheet(rawData, 'Sheet1');

    expect(result.labels).toEqual([]);
    expect(result.rows).toEqual({});
  });

  it('handles single empty cell', () => {
    const rawData = [['']];

    const result = rawDataToWorksheet(rawData, 'Sheet1');

    expect(result.labels).toEqual([]);
    expect(result.rows).toEqual({});
  });

  it('trims whitespace from labels', () => {
    const rawData = [
      ['  Name  ', '  Age  '],
      ['Alice', '30'],
    ];

    const result = rawDataToWorksheet(rawData, 'Sheet1');

    expect(result.labels).toEqual(['Name', 'Age']);
    expect(result.rows).toEqual({
      Name: ['Alice'],
      Age: ['30'],
    });
  });

  it('excludes empty labels', () => {
    const rawData = [
      ['Name', '', 'Age'],
      ['Alice', 'ignored', '30'],
    ];

    const result = rawDataToWorksheet(rawData, 'Sheet1');

    expect(result.labels).toEqual(['Name', 'Age']);
    expect(result.rows['Name']).toEqual(['Alice']);
    expect(result.rows['Age']).toEqual(['30']);
    expect(result.rows['']).toBeUndefined();
  });

  it('handles missing values in rows', () => {
    const rawData = [
      ['Name', 'Age', 'City'],
      ['Alice', '30'],
      ['Bob'],
    ];

    const result = rawDataToWorksheet(rawData, 'Sheet1');

    expect(result.rows).toEqual({
      Name: ['Alice', 'Bob'],
      Age: ['30', ''],
      City: ['', ''],
    });
  });

  it('handles extra values in rows', () => {
    const rawData = [
      ['Name', 'Age'],
      ['Alice', '30', 'Extra1', 'Extra2'],
    ];

    const result = rawDataToWorksheet(rawData, 'Sheet1');

    // Extra values are ignored (no label for them)
    expect(result.labels).toEqual(['Name', 'Age']);
    expect(result.rows).toEqual({
      Name: ['Alice'],
      Age: ['30'],
    });
  });
});

describe('extractLabelsFromGviz', () => {
  it('extracts labels from gviz response', () => {
    const gviz = {
      table: {
        cols: [
          { label: 'Name' },
          { label: 'Age' },
          { label: 'City' },
        ],
      },
    };

    const result = extractLabelsFromGviz(gviz);
    expect(result).toEqual(['Name', 'Age', 'City']);
  });

  it('handles empty labels', () => {
    const gviz = {
      table: {
        cols: [
          { label: 'Name' },
          { label: '' },
          { label: 'Age' },
        ],
      },
    };

    const result = extractLabelsFromGviz(gviz);
    expect(result).toEqual(['Name', 'Age']);
  });

  it('handles missing label property', () => {
    const gviz = {
      table: {
        cols: [
          { label: 'Name' },
          {},
          { label: 'Age' },
        ],
      },
    };

    const result = extractLabelsFromGviz(gviz);
    expect(result).toEqual(['Name', 'Age']);
  });

  it('handles empty cols array', () => {
    const gviz = {
      table: {
        cols: [],
      },
    };

    const result = extractLabelsFromGviz(gviz);
    expect(result).toEqual([]);
  });

  it('handles missing cols', () => {
    const gviz = {
      table: {},
    };

    const result = extractLabelsFromGviz(gviz);
    expect(result).toEqual([]);
  });

  it('handles missing table', () => {
    const gviz = {};

    const result = extractLabelsFromGviz(gviz);
    expect(result).toEqual([]);
  });
});

describe('fetchViaJsonp cancellation', () => {
  it('removes the injected script and callback when cancelled', async () => {
    const originalDocument = global.document;
    const originalWindow = global.window;
    const callbacks: Record<string, unknown> = {};
    const head = {
      appendChild: vi.fn((script: { parentNode: unknown }) => {
        script.parentNode = head;
      }),
      removeChild: vi.fn(),
    };

    (global as Record<string, unknown>).window = callbacks;
    (global as Record<string, unknown>).document = {
      createElement: vi.fn(() => ({ parentNode: null, async: false, src: '', onerror: null })),
      head,
    };

    try {
      const controller = new AbortController();
      const pending = fetchViaJsonp('abcdefghijklmnopqrst', undefined, 15_000, { signal: controller.signal });
      await vi.waitFor(() => expect(head.appendChild).toHaveBeenCalledOnce());
      controller.abort();

      await expect(pending).rejects.toThrow('Request cancelled');
      expect(head.removeChild).toHaveBeenCalledOnce();
      expect(Object.keys(callbacks)).toEqual([]);
    } finally {
      (global as Record<string, unknown>).document = originalDocument;
      (global as Record<string, unknown>).window = originalWindow;
    }
  });
});

describe('JSONP adapter bounds and partial results', () => {
  const spreadsheetId = 'abcdefghijklmnopqrst';
  let originalDocument: typeof global.document;
  let originalWindow: typeof global.window;
  let originalFetch: typeof global.fetch;

  function installJsonp(
    respond: (gid: string, callback: (data: unknown) => void) => void
  ): { callbacks: Record<string, unknown>; head: { appendChild: ReturnType<typeof vi.fn>; removeChild: ReturnType<typeof vi.fn> } } {
    const callbacks: Record<string, unknown> = {};
    const head = {
      appendChild: vi.fn((script: { parentNode: unknown; src: string }) => {
        script.parentNode = head;
        const gid = new URL(script.src).searchParams.get('gid') || '0';
        const callbackName = /responseHandler:([^&]+)/.exec(script.src)?.[1];
        const callback = callbackName ? callbacks[decodeURIComponent(callbackName)] : undefined;
        if (typeof callback === 'function') respond(gid, callback as (data: unknown) => void);
      }),
      removeChild: vi.fn(),
    };
    (global as Record<string, unknown>).window = callbacks;
    (global as Record<string, unknown>).document = {
      createElement: vi.fn(() => ({ parentNode: null, async: false, src: '', onerror: null })),
      head,
    };
    return { callbacks, head };
  }

  beforeEach(() => {
    originalDocument = global.document;
    originalWindow = global.window;
    originalFetch = global.fetch;
    (global as Record<string, unknown>).fetch = vi.fn(async () => new Response('', { status: 403 }));
  });

  function restoreGlobals(): void {
    (global as Record<string, unknown>).document = originalDocument;
    (global as Record<string, unknown>).window = originalWindow;
    (global as Record<string, unknown>).fetch = originalFetch;
  }

  it('rejects JSONP callback payloads over 5 MiB before conversion', async () => {
    installJsonp((_gid, callback) => callback({ table: { cols: [{ label: 'x'.repeat(5 * 1024 * 1024) }] } }));
    try {
      await expect(fetchViaJsonp(spreadsheetId)).rejects.toThrow('5 MiB size limit');
    } finally {
      restoreGlobals();
    }
  });

  it('keeps an oversized JSONP probe visible instead of treating its gid as absent', async () => {
    installJsonp((_gid, callback) => callback({ table: { cols: [{ label: 'x'.repeat(5 * 1024 * 1024) }] } }));
    try {
      await expect(discoverWorksheets(spreadsheetId, undefined)).rejects.toThrow('5 MiB size limit');
    } finally {
      restoreGlobals();
    }
  });

  it('rejects a gviz grid over 100,000 cells before conversion', async () => {
    installJsonp((_gid, callback) => callback({
      table: {
        cols: Array.from({ length: 1000 }, () => ({ label: 'Header' })),
        rows: Array.from({ length: 100 }, () => ({ c: [] })),
      },
    }));
    try {
      await expect(fetchWorksheetViaGviz(spreadsheetId, '0')).rejects.toThrow('100,000-cell import limit');
    } finally {
      restoreGlobals();
    }
  });

  it('enforces the 200-tab API discovery limit before mapping metadata', async () => {
    (global as Record<string, unknown>).fetch = vi.fn(async () => new Response(JSON.stringify({
      sheets: Array.from({ length: 201 }, (_, sheetId) => ({ properties: { sheetId, title: `Sheet ${sheetId}` } })),
    })));
    try {
      await expect(discoverWorksheets(spreadsheetId, undefined)).rejects.toThrow('200-worksheet import limit');
    } finally {
      restoreGlobals();
    }
  });

  it('does not retry a CSV permission failure', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 403 }));
    (global as Record<string, unknown>).fetch = fetchMock;
    try {
      await expect(fetchWorksheetRaw(spreadsheetId, '0')).rejects.toThrow('not publicly accessible');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      restoreGlobals();
    }
  });

  it('keeps the global upstream slot until CSV body consumption settles', async () => {
    const fetchMock = vi.fn(async () => new Response(new ReadableStream({
      pull: () => new Promise<void>(() => undefined),
    })));
    (global as Record<string, unknown>).fetch = fetchMock;
    const controllers = Array.from({ length: 7 }, () => new AbortController());
    try {
      const active = controllers.slice(0, 6).map((controller, index) =>
        fetchWorksheetRaw(spreadsheetId, String(index), { signal: controller.signal })
      );
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(6));

      const queued = fetchWorksheetRaw(spreadsheetId, 'queued', {
        signal: controllers[6].signal,
      });
      await Promise.resolve();
      expect(fetchMock).toHaveBeenCalledTimes(6);

      controllers.forEach((controller) => controller.abort());
      await Promise.all([
        ...active.map((request) => expect(request).rejects.toMatchObject({ kind: 'ABORTED' })),
        expect(queued).rejects.toMatchObject({ kind: 'ABORTED' }),
      ]);
    } finally {
      restoreGlobals();
    }
  });

  it('keeps a failed active worksheet visible as a structured partial diagnostic', async () => {
    const calls = new Map<string, number>();
    installJsonp((gid, callback) => {
      const count = (calls.get(gid) || 0) + 1;
      calls.set(gid, count);
      if (gid === '2' && count > 1) {
        callback({ status: 'error', errors: [{ reason: 'access_denied', message: 'Access denied' }] });
        return;
      }
      if (gid === '0' || gid === '2') {
        callback({ table: { cols: [{ label: 'Name' }], rows: [{ c: [{ v: `value-${gid}` }] }] } });
        return;
      }
      callback({ table: { cols: [], rows: [] } });
    });
    try {
      const result = await fetchSheetData(spreadsheetId, '2');
      expect(result).toMatchObject({ success: true });
      expect(result.data?.worksheets.map((worksheet) => worksheet.name)).toEqual(['Sheet1']);
      expect(result.data?.activeWorksheet).toBe('Sheet2');
      expect(result.data?.worksheets[0]).toMatchObject({ id: '0' });
      expect(result.data?.diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'missing-worksheet', worksheet: 'Sheet2', severity: 'error' }),
      ]));
    } finally {
      restoreGlobals();
    }
  });

  it('returns a structured error when a requested gid is outside limited JSONP discovery', async () => {
    installJsonp((gid, callback) => {
      callback(gid === '0'
        ? { table: { cols: [{ label: 'Name' }], rows: [{ c: [{ v: 'value' }] }] } }
        : { table: { cols: [], rows: [] } });
    });
    try {
      const result = await fetchSheetData(spreadsheetId, '999');
      expect(result).toEqual({
        success: false,
        error: expect.objectContaining({
          type: 'NOT_FOUND',
          message: expect.stringContaining('gid 999 could not be discovered'),
        }),
      });
    } finally {
      restoreGlobals();
    }
  });

  it('re-reads the live source on every fetch and keys the active worksheet by gid', async () => {
    let requests = 0;
    installJsonp((gid, callback) => {
      requests++;
      if (gid === '0' || gid === '2') {
        callback({ table: { cols: [{ label: 'Name' }], rows: [{ c: [{ v: `value-${gid}` }] }] } });
        return;
      }
      callback({ table: { cols: [], rows: [] } });
    });
    try {
      const first = await fetchSheetData(spreadsheetId, '0');
      const requestsAfterFirst = requests;
      const otherTab = await fetchSheetData(spreadsheetId, '2');
      expect(first.data?.activeWorksheet).toBe('Sheet1');
      expect(otherTab.data?.activeWorksheet).toBe('Sheet2');
      expect(requests).toBeGreaterThan(requestsAfterFirst);
    } finally {
      restoreGlobals();
    }
  });

  it('propagates cancellation through bounded discovery instead of returning a partial snapshot', async () => {
    const { callbacks, head } = installJsonp(() => undefined);
    try {
      const controller = new AbortController();
      const pending = fetchSheetData(spreadsheetId, undefined, { signal: controller.signal });
      await vi.waitFor(() => expect(head.appendChild).toHaveBeenCalled());
      controller.abort();

      await expect(pending).rejects.toMatchObject({ kind: 'ABORTED' });
      expect(head.removeChild).toHaveBeenCalled();
      expect(Object.keys(callbacks)).toEqual([]);
    } finally {
      restoreGlobals();
    }
  });

  it('quotes apostrophes in Sheets API formatting ranges', async () => {
    setGoogleSheetsApiKey('test-key');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ sheets: [] })));
    (global as Record<string, unknown>).fetch = fetchMock;
    try {
      await expect(fetchBoldInfo(spreadsheetId, "Q1 O'Brien")).resolves.toBeNull();
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("ranges='Q1%20O''Brien'!1%3A1"),
        expect.objectContaining({ method: 'GET' })
      );
    } finally {
      setGoogleSheetsApiKey(undefined);
      restoreGlobals();
    }
  });

  it('propagates formatting-request cancellation', async () => {
    setGoogleSheetsApiKey('test-key');
    const fetchMock = vi.fn(() => new Promise<Response>(() => undefined));
    (global as Record<string, unknown>).fetch = fetchMock;
    const controller = new AbortController();
    try {
      const pending = fetchBoldInfo(spreadsheetId, 'Sheet 1', { signal: controller.signal });
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
      controller.abort();
      await expect(pending).rejects.toMatchObject({ kind: 'ABORTED' });
    } finally {
      setGoogleSheetsApiKey(undefined);
      restoreGlobals();
    }
  });
});
