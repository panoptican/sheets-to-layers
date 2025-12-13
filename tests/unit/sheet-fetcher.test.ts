/**
 * Unit tests for sheet fetching utilities.
 *
 * These tests cover the CSV parsing and data transformation functions.
 * Network-dependent functions are tested separately in integration tests.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseCSV,
  rawDataToWorksheet,
  clearCache,
  extractLabelsFromGviz,
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

describe('clearCache', () => {
  beforeEach(() => {
    // Clear cache before each test
    clearCache();
  });

  it('clears the cache without error', () => {
    // This should not throw
    expect(() => clearCache()).not.toThrow();
  });
});
