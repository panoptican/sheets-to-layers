/**
 * Unit tests for sheet structure detection utilities.
 */

import { describe, it, expect } from 'vitest';
import {
  findDataBounds,
  trimToBounds,
  detectOrientation,
  detectSheetStructure,
  normalizeSheetData,
  rawDataToWorksheetWithDetection,
} from '../../src/core/sheet-structure';

describe('findDataBounds', () => {
  it('finds bounds for simple data', () => {
    const rawData = [
      ['Name', 'Age'],
      ['Alice', '30'],
      ['Bob', '25'],
    ];

    const bounds = findDataBounds(rawData);

    expect(bounds.startRow).toBe(0);
    expect(bounds.endRow).toBe(2);
    expect(bounds.startCol).toBe(0);
    expect(bounds.endCol).toBe(1);
    expect(bounds.rowCount).toBe(3);
    expect(bounds.colCount).toBe(2);
  });

  it('excludes trailing empty rows', () => {
    const rawData = [
      ['Name', 'Age'],
      ['Alice', '30'],
      ['', ''],
      ['', ''],
    ];

    const bounds = findDataBounds(rawData);

    expect(bounds.endRow).toBe(1);
    expect(bounds.rowCount).toBe(2);
  });

  it('excludes trailing empty columns', () => {
    const rawData = [
      ['Name', 'Age', '', ''],
      ['Alice', '30', '', ''],
    ];

    const bounds = findDataBounds(rawData);

    expect(bounds.endCol).toBe(1);
    expect(bounds.colCount).toBe(2);
  });

  it('excludes leading empty rows', () => {
    const rawData = [
      ['', ''],
      ['Name', 'Age'],
      ['Alice', '30'],
    ];

    const bounds = findDataBounds(rawData);

    expect(bounds.startRow).toBe(1);
    expect(bounds.endRow).toBe(2);
    expect(bounds.rowCount).toBe(2);
  });

  it('excludes leading empty columns', () => {
    const rawData = [
      ['', 'Name', 'Age'],
      ['', 'Alice', '30'],
    ];

    const bounds = findDataBounds(rawData);

    expect(bounds.startCol).toBe(1);
    expect(bounds.endCol).toBe(2);
    expect(bounds.colCount).toBe(2);
  });

  it('handles empty data', () => {
    const rawData: string[][] = [];

    const bounds = findDataBounds(rawData);

    expect(bounds.rowCount).toBe(0);
    expect(bounds.colCount).toBe(0);
  });

  it('handles data with only empty cells', () => {
    const rawData = [
      ['', ''],
      ['', ''],
    ];

    const bounds = findDataBounds(rawData);

    expect(bounds.rowCount).toBe(0);
    expect(bounds.colCount).toBe(0);
  });

  it('handles data with whitespace-only cells', () => {
    const rawData = [
      ['  ', '  '],
      ['Name', 'Age'],
    ];

    const bounds = findDataBounds(rawData);

    expect(bounds.startRow).toBe(1);
    expect(bounds.rowCount).toBe(1);
  });

  it('finds data island in larger grid', () => {
    const rawData = [
      ['', '', '', ''],
      ['', 'Name', 'Age', ''],
      ['', 'Alice', '30', ''],
      ['', '', '', ''],
    ];

    const bounds = findDataBounds(rawData);

    expect(bounds.startRow).toBe(1);
    expect(bounds.endRow).toBe(2);
    expect(bounds.startCol).toBe(1);
    expect(bounds.endCol).toBe(2);
    expect(bounds.rowCount).toBe(2);
    expect(bounds.colCount).toBe(2);
  });
});

describe('trimToBounds', () => {
  it('trims data to specified bounds', () => {
    const rawData = [
      ['', '', '', ''],
      ['', 'Name', 'Age', ''],
      ['', 'Alice', '30', ''],
      ['', '', '', ''],
    ];

    const bounds = {
      startRow: 1,
      endRow: 2,
      startCol: 1,
      endCol: 2,
      rowCount: 2,
      colCount: 2,
    };

    const trimmed = trimToBounds(rawData, bounds);

    expect(trimmed).toEqual([
      ['Name', 'Age'],
      ['Alice', '30'],
    ]);
  });

  it('handles empty bounds', () => {
    const rawData = [['A', 'B']];
    const bounds = {
      startRow: 0,
      endRow: -1,
      startCol: 0,
      endCol: -1,
      rowCount: 0,
      colCount: 0,
    };

    const trimmed = trimToBounds(rawData, bounds);

    expect(trimmed).toEqual([]);
  });

  it('handles missing cells', () => {
    const rawData = [
      ['A'],
      ['B', 'C', 'D'],
    ];

    const bounds = {
      startRow: 0,
      endRow: 1,
      startCol: 0,
      endCol: 2,
      rowCount: 2,
      colCount: 3,
    };

    const trimmed = trimToBounds(rawData, bounds);

    expect(trimmed).toEqual([
      ['A', '', ''],
      ['B', 'C', 'D'],
    ]);
  });
});

describe('detectOrientation', () => {
  describe('column-based detection', () => {
    it('detects typical column-based data', () => {
      const rawData = [
        ['Name', 'Age', 'City'],
        ['Alice', '30', 'NYC'],
        ['Bob', '25', 'LA'],
        ['Charlie', '35', 'Chicago'],
      ];

      const orientation = detectOrientation(rawData);

      expect(orientation).toBe('columns');
    });

    it('detects column-based data with numeric values', () => {
      const rawData = [
        ['Product', 'Price', 'Quantity'],
        ['Widget', '19.99', '100'],
        ['Gadget', '29.99', '50'],
      ];

      const orientation = detectOrientation(rawData);

      expect(orientation).toBe('columns');
    });

    it('defaults to columns for single row', () => {
      const rawData = [['Name', 'Age', 'City']];

      const orientation = detectOrientation(rawData);

      expect(orientation).toBe('columns');
    });

    it('defaults to columns for empty data', () => {
      const rawData: string[][] = [];

      const orientation = detectOrientation(rawData);

      expect(orientation).toBe('columns');
    });

    it('defaults to columns for ambiguous data', () => {
      const rawData = [
        ['A', 'B'],
        ['C', 'D'],
      ];

      const orientation = detectOrientation(rawData);

      expect(orientation).toBe('columns');
    });
  });

  describe('row-based detection', () => {
    it('detects typical row-based data', () => {
      const rawData = [
        ['Name', 'Alice', 'Bob', 'Charlie'],
        ['Age', '30', '25', '35'],
        ['City', 'NYC', 'LA', 'Chicago'],
      ];

      const orientation = detectOrientation(rawData);

      expect(orientation).toBe('rows');
    });

    it('handles ambiguous data with numeric values (defaults to columns)', () => {
      // This data is structurally ambiguous - it could be either row-based
      // (Product/Price/Quantity as labels) or column-based (transposed).
      // Without semantic understanding, the algorithm defaults to columns.
      const rawData = [
        ['Product', 'Widget', 'Gadget'],
        ['Price', '19.99', '29.99'],
        ['Quantity', '100', '50'],
      ];

      const orientation = detectOrientation(rawData);

      // Defaults to columns for ambiguous cases
      expect(orientation).toBe('columns');
    });

    it('detects single column as rows', () => {
      const rawData = [
        ['Name'],
        ['Age'],
        ['City'],
      ];

      const orientation = detectOrientation(rawData);

      expect(orientation).toBe('rows');
    });
  });

  describe('edge cases', () => {
    it('handles single cell', () => {
      const rawData = [['Value']];

      const orientation = detectOrientation(rawData);

      // Single cell defaults to columns
      expect(orientation).toBe('columns');
    });

    it('handles numeric first row', () => {
      // First row is numeric, first col is text - suggests rows
      const rawData = [
        ['Jan', '100', '200', '300'],
        ['Feb', '150', '250', '350'],
        ['Mar', '175', '275', '375'],
      ];

      const orientation = detectOrientation(rawData);

      expect(orientation).toBe('rows');
    });
  });
});

describe('detectSheetStructure', () => {
  it('detects structure for column-based data', () => {
    const rawData = [
      ['Name', 'Age', 'City'],
      ['Alice', '30', 'NYC'],
      ['Bob', '25', 'LA'],
    ];

    const structure = detectSheetStructure(rawData);

    expect(structure.orientation).toBe('columns');
    expect(structure.labels).toEqual(['Name', 'Age', 'City']);
    expect(structure.valueCount).toBe(2);
  });

  it('detects structure for row-based data', () => {
    const rawData = [
      ['Name', 'Alice', 'Bob'],
      ['Age', '30', '25'],
      ['City', 'NYC', 'LA'],
    ];

    const structure = detectSheetStructure(rawData);

    expect(structure.orientation).toBe('rows');
    expect(structure.labels).toEqual(['Name', 'Age', 'City']);
    expect(structure.valueCount).toBe(2);
  });

  it('handles empty data', () => {
    const rawData: string[][] = [];

    const structure = detectSheetStructure(rawData);

    expect(structure.orientation).toBe('columns');
    expect(structure.labels).toEqual([]);
    expect(structure.valueCount).toBe(0);
  });

  it('handles data with empty labels', () => {
    const rawData = [
      ['Name', '', 'City'],
      ['Alice', 'ignored', 'NYC'],
    ];

    const structure = detectSheetStructure(rawData);

    // Empty labels should be filtered out
    expect(structure.labels).toEqual(['Name', 'City']);
  });

  it('trims data to bounds', () => {
    const rawData = [
      ['Name', 'Age', ''],
      ['Alice', '30', ''],
      ['', '', ''],
    ];

    const structure = detectSheetStructure(rawData);

    expect(structure.bounds.rowCount).toBe(2);
    expect(structure.bounds.colCount).toBe(2);
  });
});

describe('normalizeSheetData', () => {
  describe('column-based normalization', () => {
    it('normalizes column-based data', () => {
      const rawData = [
        ['Name', 'Age'],
        ['Alice', '30'],
        ['Bob', '25'],
      ];

      const normalized = normalizeSheetData(rawData, 'columns');

      expect(normalized).toEqual({
        Name: ['Alice', 'Bob'],
        Age: ['30', '25'],
      });
    });

    it('handles missing values', () => {
      const rawData = [
        ['Name', 'Age'],
        ['Alice', '30'],
        ['Bob'],
      ];

      const normalized = normalizeSheetData(rawData, 'columns');

      expect(normalized.Name).toEqual(['Alice', 'Bob']);
      expect(normalized.Age).toEqual(['30', '']);
    });

    it('skips empty labels', () => {
      const rawData = [
        ['Name', '', 'Age'],
        ['Alice', 'ignored', '30'],
      ];

      const normalized = normalizeSheetData(rawData, 'columns');

      expect(normalized).toEqual({
        Name: ['Alice'],
        Age: ['30'],
      });
      expect(normalized['']).toBeUndefined();
    });
  });

  describe('row-based normalization', () => {
    it('normalizes row-based data', () => {
      const rawData = [
        ['Name', 'Alice', 'Bob'],
        ['Age', '30', '25'],
      ];

      const normalized = normalizeSheetData(rawData, 'rows');

      expect(normalized).toEqual({
        Name: ['Alice', 'Bob'],
        Age: ['30', '25'],
      });
    });

    it('handles missing values', () => {
      const rawData = [
        ['Name', 'Alice', 'Bob'],
        ['Age', '30'],
      ];

      const normalized = normalizeSheetData(rawData, 'rows');

      expect(normalized.Name).toEqual(['Alice', 'Bob']);
      expect(normalized.Age).toEqual(['30']);
    });

    it('skips rows with empty labels', () => {
      const rawData = [
        ['Name', 'Alice'],
        ['', 'ignored'],
        ['Age', '30'],
      ];

      const normalized = normalizeSheetData(rawData, 'rows');

      expect(normalized).toEqual({
        Name: ['Alice'],
        Age: ['30'],
      });
    });
  });

  it('handles empty data', () => {
    const rawData: string[][] = [];

    const normalized = normalizeSheetData(rawData, 'columns');

    expect(normalized).toEqual({});
  });
});

describe('rawDataToWorksheetWithDetection', () => {
  it('creates worksheet from column-based data', () => {
    const rawData = [
      ['Name', 'Age', 'City'],
      ['Alice', '30', 'NYC'],
      ['Bob', '25', 'LA'],
    ];

    const worksheet = rawDataToWorksheetWithDetection(rawData, 'Sheet1');

    expect(worksheet.name).toBe('Sheet1');
    expect(worksheet.orientation).toBe('columns');
    expect(worksheet.labels).toEqual(['Name', 'Age', 'City']);
    expect(worksheet.rows).toEqual({
      Name: ['Alice', 'Bob'],
      Age: ['30', '25'],
      City: ['NYC', 'LA'],
    });
  });

  it('creates worksheet from row-based data', () => {
    const rawData = [
      ['Name', 'Alice', 'Bob'],
      ['Age', '30', '25'],
      ['City', 'NYC', 'LA'],
    ];

    const worksheet = rawDataToWorksheetWithDetection(rawData, 'Sheet1');

    expect(worksheet.name).toBe('Sheet1');
    expect(worksheet.orientation).toBe('rows');
    expect(worksheet.labels).toEqual(['Name', 'Age', 'City']);
    expect(worksheet.rows).toEqual({
      Name: ['Alice', 'Bob'],
      Age: ['30', '25'],
      City: ['NYC', 'LA'],
    });
  });

  it('handles empty data', () => {
    const rawData: string[][] = [];

    const worksheet = rawDataToWorksheetWithDetection(rawData, 'Sheet1');

    expect(worksheet.name).toBe('Sheet1');
    expect(worksheet.labels).toEqual([]);
    expect(worksheet.rows).toEqual({});
    expect(worksheet.orientation).toBe('columns');
  });

  it('trims to data bounds', () => {
    const rawData = [
      ['Name', 'Age', ''],
      ['Alice', '30', ''],
      ['', '', ''],
    ];

    const worksheet = rawDataToWorksheetWithDetection(rawData, 'Sheet1');

    expect(worksheet.labels).toEqual(['Name', 'Age']);
    expect(worksheet.rows).toEqual({
      Name: ['Alice'],
      Age: ['30'],
    });
  });

  it('handles single row', () => {
    const rawData = [['Name', 'Age', 'City']];

    const worksheet = rawDataToWorksheetWithDetection(rawData, 'Sheet1');

    expect(worksheet.orientation).toBe('columns');
    expect(worksheet.labels).toEqual(['Name', 'Age', 'City']);
    expect(worksheet.rows).toEqual({
      Name: [],
      Age: [],
      City: [],
    });
  });

  it('handles single column', () => {
    const rawData = [
      ['Name'],
      ['Age'],
      ['City'],
    ];

    const worksheet = rawDataToWorksheetWithDetection(rawData, 'Sheet1');

    expect(worksheet.orientation).toBe('rows');
    expect(worksheet.labels).toEqual(['Name', 'Age', 'City']);
    // Row-based with single column means no data values
    expect(worksheet.rows.Name).toEqual([]);
  });
});
