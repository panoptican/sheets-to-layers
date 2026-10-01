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
  fetchWorksheetExact,
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
    respond: (gid: string, callback: (data: unknown) => void, src: string) => void
  ): { callbacks: Record<string, unknown>; head: { appendChild: ReturnType<typeof vi.fn>; removeChild: ReturnType<typeof vi.fn> } } {
    const callbacks: Record<string, unknown> = {};
    const head = {
      appendChild: vi.fn((script: { parentNode: unknown; src: string }) => {
        script.parentNode = head;
        const gid = new URL(script.src).searchParams.get('gid') || '0';
        const callbackName = /responseHandler:([^&]+)/.exec(script.src)?.[1];
        const callback = callbackName ? callbacks[decodeURIComponent(callbackName)] : undefined;
        if (typeof callback === 'function') respond(gid, callback as (data: unknown) => void, script.src);
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

  it('reports an oversized linked worksheet instead of treating it as empty', async () => {
    installJsonp((_gid, callback) => callback({ table: { cols: [{ label: 'x'.repeat(5 * 1024 * 1024) }] } }));
    try {
      const result = await fetchSheetData(spreadsheetId, '0');
      expect(result).toMatchObject({ success: false, error: { message: expect.stringContaining('5 MiB size limit') } });
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

  it('keeps a failed named worksheet visible as a structured partial diagnostic', async () => {
    installJsonp((_gid, callback, src) => {
      if (new URL(src).searchParams.get('sheet') === 'Broken') {
        callback({ status: 'error', errors: [{ reason: 'access_denied', message: 'Access denied' }] });
        return;
      }
      callback({ sig: '1', table: { cols: [{ label: '', type: 'string' }], rows: [{ c: [{ v: 'Name' }] }, { c: [{ v: 'value' }] }] } });
    });
    try {
      const result = await fetchSheetData(spreadsheetId, '0', {}, ['Broken']);
      expect(result).toMatchObject({ success: true });
      expect(result.data?.worksheets.map((worksheet) => worksheet.name)).toEqual(['Sheet1']);
      expect(result.data?.activeWorksheet).toBe('Sheet1');
      expect(result.data?.diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'missing-worksheet', worksheet: 'Broken', severity: 'error' }),
      ]));
    } finally {
      restoreGlobals();
    }
  });

  it('reads the linked gid directly instead of probing other gids', async () => {
    const requested: string[] = [];
    installJsonp((gid, callback) => {
      requested.push(gid);
      callback({ sig: '1', table: { cols: [{ label: '', type: 'string' }], rows: [{ c: [{ v: 'Name' }] }, { c: [{ v: 'value' }] }] } });
    });
    try {
      const result = await fetchSheetData(spreadsheetId, '999');
      expect(result).toMatchObject({ success: true });
      expect(result.data?.worksheets[0]).toMatchObject({ name: 'Sheet1', id: '999' });
      expect(new Set(requested)).toEqual(new Set(['999']));
    } finally {
      restoreGlobals();
    }
  });

  it('re-reads the live source on every fetch', async () => {
    let requests = 0;
    installJsonp((_gid, callback) => {
      requests++;
      callback({ sig: String(requests), table: { cols: [{ label: '', type: 'string' }], rows: [{ c: [{ v: 'Name' }] }, { c: [{ v: 'value' }] }] } });
    });
    try {
      const first = await fetchSheetData(spreadsheetId, '0');
      const requestsAfterFirst = requests;
      const second = await fetchSheetData(spreadsheetId, '0');
      expect(first.data?.activeWorksheet).toBe('Sheet1');
      expect(second.success).toBe(true);
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

/**
 * A fake gviz endpoint that behaves like Google's for the cases that matter:
 * unknown gids/names fall back to the first worksheet, fully empty rows are
 * dropped, each column gets one guessed type (cells of another type come back
 * null), ranges past the grid are `invalid_range`, and `sig` identifies the data.
 */
describe('exact JSONP reading against a Google-like endpoint', () => {
  const spreadsheetId = 'abcdefghijklmnopqrst';
  type Tab = { gid: string; name: string; grid: string[][] };
  let originalDocument: typeof global.document;
  let originalWindow: typeof global.window;
  let originalFetch: typeof global.fetch;

  const isNumber = (value: string) => value.trim() !== '' && !Number.isNaN(Number(value));

  function respond(tabs: Tab[], src: string): unknown {
    const params = new URL(src).searchParams;
    const gid = params.get('gid');
    const sheet = params.get('sheet');
    const tab = (gid && tabs.find((t) => t.gid === gid))
      || (sheet && tabs.find((t) => t.name.toLowerCase() === sheet.toLowerCase()))
      || tabs[0];
    const width = Math.max(...tab.grid.map((row) => row.length));
    let rows = tab.grid.map((row, index) => ({ row, number: index + 1 }));
    const range = params.get('range');
    if (range) {
      const [, startRow, , endRow] = /^A(\d+):([A-Z]+)(\d+)$/.exec(range)!;
      if (Number(startRow) > tab.grid.length + 2) {
        return { status: 'error', errors: [{ reason: 'invalid_range', message: 'INVALID_RANGE' }] };
      }
      rows = rows.filter((r) => r.number >= Number(startRow) && r.number <= Number(endRow));
    }
    rows = rows.filter((r) => r.row.some((cell) => cell !== ''));
    // As measured against Google: ties go to number; text in a number column is
    // dropped (and a row left with nothing disappears); a number in a text
    // column comes back as bare text without its display format.
    const types = Array.from({ length: width }, (_, column) => {
      const cells = rows.map((r) => r.row[column] ?? '').filter((cell) => cell !== '');
      return cells.length && cells.filter(isNumber).length >= cells.length / 2 ? 'number' : 'string';
    });
    const table = {
      cols: types.map((type) => ({ label: '', type })),
      rows: rows
        .map((r) => ({
          c: types.map((type, column) => {
            const cell = r.row[column] ?? '';
            if (cell === '') return null;
            if (type === 'number') return isNumber(cell) ? { v: Number(cell), f: cell } : null;
            return { v: isNumber(cell) ? String(Number(cell)) : cell };
          }),
        }))
        .filter((row) => row.c.some((cell) => cell !== null)),
    };
    return { status: 'ok', sig: String(JSON.stringify([tab.name, tab.grid]).length), table };
  }

  function installGoogle(tabs: Tab[]): string[] {
    const requests: string[] = [];
    const callbacks: Record<string, unknown> = {};
    const head = {
      appendChild: vi.fn((script: { parentNode: unknown; src: string }) => {
        script.parentNode = head;
        requests.push(script.src);
        const callbackName = /responseHandler:([^&]+)/.exec(script.src)?.[1];
        const callback = callbackName ? callbacks[decodeURIComponent(callbackName)] : undefined;
        if (typeof callback === 'function') callback(respond(tabs, script.src));
      }),
      removeChild: vi.fn(),
    };
    (global as Record<string, unknown>).window = callbacks;
    (global as Record<string, unknown>).document = {
      createElement: vi.fn(() => ({ parentNode: null, async: false, src: '', onerror: null })),
      head,
    };
    return requests;
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

  // Shaped like a real invoice: an empty row 6, text in the mostly-numeric Qty
  // column, and a formatted number ("0.50") that a text-typed block would flatten.
  const invoice: string[][] = [
    ['Title', 'Rate', 'Qty', 'Total'],
    ['Deck design', '500', '2', '1000'],
    ['Newsletter', '500', '0.50', '250'],
    ['Bloomberg', '500', '3', '1500'],
    ['', '', '5.5', ''],
    ['', '', '', ''],
    ['', '', 'Subtotal', '2750'],
    ['', '', 'VAT', '0'],
    ['', '', 'Total', '2750'],
  ];

  it('keeps empty rows and text in numeric columns, so row numbers match the sheet', async () => {
    installGoogle([{ gid: '0', name: 'Invoice', grid: invoice }]);
    try {
      const { rawData } = await fetchWorksheetExact(spreadsheetId, { gid: '0' });
      expect(rawData).toEqual(invoice);
    } finally {
      restoreGlobals();
    }
  });

  it('uses two requests when a single query cannot have lost anything', async () => {
    const clean = [['Name', 'City'], ['Ana', 'Lisbon'], ['Bea', 'Porto']];
    const requests = installGoogle([{ gid: '0', name: 'People', grid: clean }]);
    try {
      const { rawData } = await fetchWorksheetExact(spreadsheetId, { gid: '0' });
      expect(rawData).toEqual(clean);
      expect(requests).toHaveLength(2);
      expect(requests.every((src) => src.includes('&headers=0'))).toBe(true);
    } finally {
      restoreGlobals();
    }
  });

  it('reads worksheets named in layers by name and names the linked worksheet when it is one of them', async () => {
    const requests = installGoogle([
      { gid: '0', name: 'Overview', grid: [['Client'], ['IF']] },
      { gid: '77', name: 'Invoice', grid: invoice },
      { gid: '88', name: 'Products', grid: [['Product'], ['Lamp']] },
    ]);
    try {
      const result = await fetchSheetData(spreadsheetId, '77', {}, ['Products', 'Invoice']);
      expect(result.success).toBe(true);
      expect(result.data?.worksheets.map((worksheet) => worksheet.name)).toEqual(['Invoice', 'Products']);
      expect(result.data?.activeWorksheet).toBe('Invoice');
      expect(result.data?.worksheets[0].rawData?.map((row) => row[2])).toEqual(invoice.map((row) => row[2]));
      expect(result.data?.worksheets[1].rows.Product).toEqual(['Lamp']);
      expect(result.data?.diagnostics).toEqual([]);
      expect(requests.some((src) => src.includes('&sheet=Products'))).toBe(true);
      expect(requests.some((src) => /&gid=[1-9]&|&gid=[1-9]$/.test(src))).toBe(false);
    } finally {
      restoreGlobals();
    }
  });

  it('warns when Google answers a worksheet name with the first worksheet', async () => {
    installGoogle([
      { gid: '0', name: 'Overview', grid: [['Client'], ['IF']] },
      { gid: '77', name: 'Invoice', grid: invoice },
    ]);
    try {
      const result = await fetchSheetData(spreadsheetId, '77', {}, ['Prodcts']);
      expect(result.data?.worksheets.map((worksheet) => worksheet.name)).toEqual(['Sheet1', 'Prodcts']);
      expect(result.data?.diagnostics).toEqual([
        expect.objectContaining({ code: 'missing-worksheet', worksheet: 'Prodcts', severity: 'warning' }),
      ]);
    } finally {
      restoreGlobals();
    }
  });
});
