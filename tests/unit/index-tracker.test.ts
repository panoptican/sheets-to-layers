/**
 * Unit tests for index tracking utilities.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  IndexTracker,
  createIndexTracker,
  DEFAULT_INDEX_TYPE,
} from '../../src/core/index-tracker';
import type { SheetData, IndexType } from '../../src/core/types';

// ============================================================================
// Test Data
// ============================================================================

function createTestSheetData(): SheetData {
  return {
    worksheets: [
      {
        name: 'Products',
        labels: ['Name', 'Price', 'Stock'],
        rows: {
          Name: ['Widget', 'Gadget', 'Gizmo'],
          Price: ['19.99', '29.99', '39.99'],
          Stock: ['100', '50', '25'],
        },
        orientation: 'columns',
      },
      {
        name: 'Users',
        labels: ['First Name', 'Email', 'Status'],
        rows: {
          'First Name': ['Alice', 'Bob', 'Charlie', 'Diana'],
          Email: ['alice@test.com', 'bob@test.com', 'charlie@test.com', 'diana@test.com'],
          Status: ['active', 'inactive', 'active', 'pending'],
        },
        orientation: 'columns',
      },
    ],
    activeWorksheet: 'Products',
  };
}

function createSheetDataWithBlanks(): SheetData {
  return {
    worksheets: [
      {
        name: 'Data',
        labels: ['Title', 'Value'],
        rows: {
          Title: ['First', '', 'Third', '', 'Fifth'],
          Value: ['A', 'B', '', 'D', ''],
        },
        orientation: 'columns',
      },
    ],
    activeWorksheet: 'Data',
  };
}

function createEmptySheetData(): SheetData {
  return {
    worksheets: [
      {
        name: 'Empty',
        labels: ['Column'],
        rows: {
          Column: [],
        },
        orientation: 'columns',
      },
    ],
    activeWorksheet: 'Empty',
  };
}

function createAllBlanksSheetData(): SheetData {
  return {
    worksheets: [
      {
        name: 'Blanks',
        labels: ['Data'],
        rows: {
          Data: ['', '  ', '', '   '],
        },
        orientation: 'columns',
      },
    ],
    activeWorksheet: 'Blanks',
  };
}

// ============================================================================
// IndexTracker Tests
// ============================================================================

describe('IndexTracker', () => {
  let sheetData: SheetData;
  let tracker: IndexTracker;

  beforeEach(() => {
    sheetData = createTestSheetData();
    tracker = new IndexTracker(sheetData);
  });

  describe('constructor', () => {
    it('creates tracker with sheet data', () => {
      expect(tracker).toBeInstanceOf(IndexTracker);
    });

    it('accepts optional seed for random', () => {
      const seededTracker = new IndexTracker(sheetData, 12345);
      expect(seededTracker).toBeInstanceOf(IndexTracker);
    });
  });

  describe('createIndexTracker factory', () => {
    it('creates tracker instance', () => {
      const tracker = createIndexTracker(sheetData);
      expect(tracker).toBeInstanceOf(IndexTracker);
    });

    it('accepts optional seed', () => {
      const tracker = createIndexTracker(sheetData, 12345);
      expect(tracker).toBeInstanceOf(IndexTracker);
    });
  });

  describe('getWorksheet', () => {
    it('returns active worksheet when name not specified', () => {
      const worksheet = tracker.getWorksheet();
      expect(worksheet?.name).toBe('Products');
    });

    it('finds worksheet by exact name', () => {
      const worksheet = tracker.getWorksheet('Users');
      expect(worksheet?.name).toBe('Users');
    });

    it('finds worksheet case-insensitively', () => {
      const worksheet = tracker.getWorksheet('USERS');
      expect(worksheet?.name).toBe('Users');
    });

    it('returns undefined for non-existent worksheet', () => {
      const worksheet = tracker.getWorksheet('NonExistent');
      expect(worksheet).toBeUndefined();
    });
  });

  describe('getValuesForLabel', () => {
    it('finds values by exact label', () => {
      const worksheet = tracker.getWorksheet('Products')!;
      const values = tracker.getValuesForLabel('Name', worksheet);
      expect(values).toEqual(['Widget', 'Gadget', 'Gizmo']);
    });

    it('finds values by normalized label', () => {
      const worksheet = tracker.getWorksheet('Users')!;
      // 'First Name' in sheet, 'first_name' query
      const values = tracker.getValuesForLabel('first_name', worksheet);
      expect(values).toEqual(['Alice', 'Bob', 'Charlie', 'Diana']);
    });

    it('returns undefined for non-existent label', () => {
      const worksheet = tracker.getWorksheet('Products')!;
      const values = tracker.getValuesForLabel('NonExistent', worksheet);
      expect(values).toBeUndefined();
    });
  });

  describe('resolveIndex - specific', () => {
    it('converts 1-based to 0-based index', () => {
      const result = tracker.resolveIndex('Name', undefined, { type: 'specific', value: 1 });
      expect(result.success).toBe(true);
      expect(result.index).toBe(0);
      expect(result.value).toBe('Widget');
    });

    it('returns correct value for middle index', () => {
      const result = tracker.resolveIndex('Name', undefined, { type: 'specific', value: 2 });
      expect(result.success).toBe(true);
      expect(result.index).toBe(1);
      expect(result.value).toBe('Gadget');
    });

    it('returns last value for last index', () => {
      const result = tracker.resolveIndex('Name', undefined, { type: 'specific', value: 3 });
      expect(result.success).toBe(true);
      expect(result.index).toBe(2);
      expect(result.value).toBe('Gizmo');
    });

    it('clamps to first value for index 0 or negative', () => {
      const result0 = tracker.resolveIndex('Name', undefined, { type: 'specific', value: 0 });
      expect(result0.index).toBe(0);
      expect(result0.value).toBe('Widget');

      const resultNeg = tracker.resolveIndex('Name', undefined, { type: 'specific', value: -5 });
      expect(resultNeg.index).toBe(0);
    });

    it('clamps to last value for out of bounds index', () => {
      const result = tracker.resolveIndex('Name', undefined, { type: 'specific', value: 100 });
      expect(result.success).toBe(true);
      expect(result.index).toBe(2); // Last valid index
      expect(result.value).toBe('Gizmo');
    });
  });

  describe('resolveIndex - increment', () => {
    it('auto-increments through values', () => {
      const indexType: IndexType = { type: 'increment' };

      const r1 = tracker.resolveIndex('Name', undefined, indexType);
      expect(r1.index).toBe(0);
      expect(r1.value).toBe('Widget');

      const r2 = tracker.resolveIndex('Name', undefined, indexType);
      expect(r2.index).toBe(1);
      expect(r2.value).toBe('Gadget');

      const r3 = tracker.resolveIndex('Name', undefined, indexType);
      expect(r3.index).toBe(2);
      expect(r3.value).toBe('Gizmo');
    });

    it('wraps around at end of values', () => {
      const indexType: IndexType = { type: 'increment' };

      // Go through all 3 values
      tracker.resolveIndex('Name', undefined, indexType);
      tracker.resolveIndex('Name', undefined, indexType);
      tracker.resolveIndex('Name', undefined, indexType);

      // Should wrap to start
      const r4 = tracker.resolveIndex('Name', undefined, indexType);
      expect(r4.index).toBe(0);
      expect(r4.value).toBe('Widget');
    });

    it('maintains separate counters per label', () => {
      const indexType: IndexType = { type: 'increment' };

      const name1 = tracker.resolveIndex('Name', undefined, indexType);
      expect(name1.value).toBe('Widget');

      const price1 = tracker.resolveIndex('Price', undefined, indexType);
      expect(price1.value).toBe('19.99');

      const name2 = tracker.resolveIndex('Name', undefined, indexType);
      expect(name2.value).toBe('Gadget');

      const price2 = tracker.resolveIndex('Price', undefined, indexType);
      expect(price2.value).toBe('29.99');
    });

    it('maintains separate counters per worksheet', () => {
      const indexType: IndexType = { type: 'increment' };

      // Products worksheet has Name label
      const prod1 = tracker.resolveIndex('Name', 'Products', indexType);
      expect(prod1.value).toBe('Widget');

      // Users worksheet has different data
      const user1 = tracker.resolveIndex('First Name', 'Users', indexType);
      expect(user1.value).toBe('Alice');

      // Continue Products
      const prod2 = tracker.resolveIndex('Name', 'Products', indexType);
      expect(prod2.value).toBe('Gadget');
    });
  });

  describe('resolveIndex - incrementNonBlank', () => {
    let blankTracker: IndexTracker;

    beforeEach(() => {
      blankTracker = new IndexTracker(createSheetDataWithBlanks());
    });

    it('skips blank values', () => {
      const indexType: IndexType = { type: 'incrementNonBlank' };

      // Title has: 'First', '', 'Third', '', 'Fifth'
      const r1 = blankTracker.resolveIndex('Title', undefined, indexType);
      expect(r1.value).toBe('First'); // index 0

      const r2 = blankTracker.resolveIndex('Title', undefined, indexType);
      expect(r2.value).toBe('Third'); // index 2 (skipped 1)

      const r3 = blankTracker.resolveIndex('Title', undefined, indexType);
      expect(r3.value).toBe('Fifth'); // index 4 (skipped 3)
    });

    it('wraps around through non-blank values', () => {
      const indexType: IndexType = { type: 'incrementNonBlank' };

      // Go through all non-blank values
      blankTracker.resolveIndex('Title', undefined, indexType); // First
      blankTracker.resolveIndex('Title', undefined, indexType); // Third
      blankTracker.resolveIndex('Title', undefined, indexType); // Fifth

      // Should wrap
      const r4 = blankTracker.resolveIndex('Title', undefined, indexType);
      expect(r4.value).toBe('First');
    });

    it('fails when all values are blank', () => {
      const allBlanksTracker = new IndexTracker(createAllBlanksSheetData());
      const result = allBlanksTracker.resolveIndex('Data', undefined, { type: 'incrementNonBlank' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('No non-blank values');
    });
  });

  describe('resolveIndex - random', () => {
    it('returns valid index from values', () => {
      const indexType: IndexType = { type: 'random' };
      const result = tracker.resolveIndex('Name', undefined, indexType);
      expect(result.success).toBe(true);
      expect(result.index).toBeGreaterThanOrEqual(0);
      expect(result.index).toBeLessThan(3);
      expect(['Widget', 'Gadget', 'Gizmo']).toContain(result.value);
    });

    it('produces consistent results with same seed', () => {
      const seeded1 = new IndexTracker(sheetData, 42);
      const seeded2 = new IndexTracker(sheetData, 42);
      const indexType: IndexType = { type: 'random' };

      const r1 = seeded1.resolveIndex('Name', undefined, indexType);
      const r2 = seeded2.resolveIndex('Name', undefined, indexType);

      expect(r1.index).toBe(r2.index);
      expect(r1.value).toBe(r2.value);
    });

    it('produces different results with different seeds', () => {
      const seeded1 = new IndexTracker(sheetData, 42);
      const seeded2 = new IndexTracker(sheetData, 99999);
      const indexType: IndexType = { type: 'random' };

      // Call multiple times to increase chance of difference
      const results1: number[] = [];
      const results2: number[] = [];
      for (let i = 0; i < 10; i++) {
        results1.push(seeded1.resolveIndex('Name', undefined, indexType).index);
        results2.push(seeded2.resolveIndex('Name', undefined, indexType).index);
      }

      // At least one should be different
      expect(results1).not.toEqual(results2);
    });
  });

  describe('resolveIndex - randomNonBlank', () => {
    let blankTracker: IndexTracker;

    beforeEach(() => {
      blankTracker = new IndexTracker(createSheetDataWithBlanks(), 12345);
    });

    it('only returns non-blank values', () => {
      const indexType: IndexType = { type: 'randomNonBlank' };
      const nonBlankValues = ['First', 'Third', 'Fifth'];

      // Call multiple times to verify
      for (let i = 0; i < 10; i++) {
        const result = blankTracker.resolveIndex('Title', undefined, indexType);
        expect(result.success).toBe(true);
        expect(nonBlankValues).toContain(result.value);
      }
    });

    it('fails when all values are blank', () => {
      const allBlanksTracker = new IndexTracker(createAllBlanksSheetData());
      const result = allBlanksTracker.resolveIndex('Data', undefined, { type: 'randomNonBlank' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('No non-blank values');
    });
  });

  describe('resolveIndex - error cases', () => {
    it('fails when worksheet not found', () => {
      const result = tracker.resolveIndex('Name', 'NonExistent', { type: 'increment' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Worksheet not found');
    });

    it('fails when label not found', () => {
      const result = tracker.resolveIndex('NonExistent', undefined, { type: 'increment' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Label not found');
    });

    it('fails when no values exist', () => {
      const emptyTracker = new IndexTracker(createEmptySheetData());
      const result = emptyTracker.resolveIndex('Column', undefined, { type: 'increment' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('No values');
    });
  });

  describe('getValue', () => {
    it('returns value string directly', () => {
      const value = tracker.getValue('Name', undefined, { type: 'specific', value: 1 });
      expect(value).toBe('Widget');
    });

    it('returns empty string on error', () => {
      const value = tracker.getValue('NonExistent', undefined, { type: 'increment' });
      expect(value).toBe('');
    });
  });

  describe('hasLabel', () => {
    it('returns true for existing label', () => {
      expect(tracker.hasLabel('Name')).toBe(true);
    });

    it('returns true for normalized label match', () => {
      expect(tracker.hasLabel('first_name', 'Users')).toBe(true);
    });

    it('returns false for non-existent label', () => {
      expect(tracker.hasLabel('NonExistent')).toBe(false);
    });

    it('returns false for non-existent worksheet', () => {
      expect(tracker.hasLabel('Name', 'NonExistent')).toBe(false);
    });
  });

  describe('getValueCount', () => {
    it('returns count of values', () => {
      expect(tracker.getValueCount('Name')).toBe(3);
    });

    it('returns 0 for non-existent label', () => {
      expect(tracker.getValueCount('NonExistent')).toBe(0);
    });

    it('returns count from specific worksheet', () => {
      expect(tracker.getValueCount('First Name', 'Users')).toBe(4);
    });
  });

  describe('getNonBlankValueCount', () => {
    let blankTracker: IndexTracker;

    beforeEach(() => {
      blankTracker = new IndexTracker(createSheetDataWithBlanks());
    });

    it('counts only non-blank values', () => {
      // Title has: 'First', '', 'Third', '', 'Fifth' - 3 non-blank
      expect(blankTracker.getNonBlankValueCount('Title')).toBe(3);
    });

    it('returns 0 when all blank', () => {
      const allBlanksTracker = new IndexTracker(createAllBlanksSheetData());
      expect(allBlanksTracker.getNonBlankValueCount('Data')).toBe(0);
    });

    it('returns 0 for non-existent label', () => {
      expect(blankTracker.getNonBlankValueCount('NonExistent')).toBe(0);
    });
  });

  describe('getLabels', () => {
    it('returns labels from active worksheet', () => {
      const labels = tracker.getLabels();
      expect(labels).toEqual(['Name', 'Price', 'Stock']);
    });

    it('returns labels from specific worksheet', () => {
      const labels = tracker.getLabels('Users');
      expect(labels).toEqual(['First Name', 'Email', 'Status']);
    });

    it('returns empty array for non-existent worksheet', () => {
      const labels = tracker.getLabels('NonExistent');
      expect(labels).toEqual([]);
    });
  });

  describe('getWorksheetNames', () => {
    it('returns all worksheet names', () => {
      const names = tracker.getWorksheetNames();
      expect(names).toEqual(['Products', 'Users']);
    });
  });

  describe('reset', () => {
    it('resets all counters', () => {
      const indexType: IndexType = { type: 'increment' };

      // Advance counters
      tracker.resolveIndex('Name', undefined, indexType);
      tracker.resolveIndex('Name', undefined, indexType);
      tracker.resolveIndex('Price', undefined, indexType);

      // Reset
      tracker.reset();

      // Should start from beginning
      const r1 = tracker.resolveIndex('Name', undefined, indexType);
      expect(r1.index).toBe(0);
      expect(r1.value).toBe('Widget');

      const r2 = tracker.resolveIndex('Price', undefined, indexType);
      expect(r2.index).toBe(0);
      expect(r2.value).toBe('19.99');
    });
  });

  describe('resetLabel', () => {
    it('resets counter for specific label', () => {
      const indexType: IndexType = { type: 'increment' };

      // Advance both counters
      tracker.resolveIndex('Name', undefined, indexType);
      tracker.resolveIndex('Name', undefined, indexType);
      tracker.resolveIndex('Price', undefined, indexType);
      tracker.resolveIndex('Price', undefined, indexType);

      // Reset only Name
      tracker.resetLabel('Name');

      // Name should restart
      const r1 = tracker.resolveIndex('Name', undefined, indexType);
      expect(r1.index).toBe(0);

      // Price should continue
      const r2 = tracker.resolveIndex('Price', undefined, indexType);
      expect(r2.index).toBe(2);
    });
  });

  describe('DEFAULT_INDEX_TYPE', () => {
    it('is increment type', () => {
      expect(DEFAULT_INDEX_TYPE).toEqual({ type: 'increment' });
    });
  });
});

describe('integration scenarios', () => {
  it('simulates sync with multiple layers using same label', () => {
    const sheetData: SheetData = {
      worksheets: [
        {
          name: 'Cards',
          labels: ['Title', 'Description'],
          rows: {
            Title: ['Card 1', 'Card 2', 'Card 3'],
            Description: ['Desc 1', 'Desc 2', 'Desc 3'],
          },
          orientation: 'columns',
        },
      ],
      activeWorksheet: 'Cards',
    };

    const tracker = createIndexTracker(sheetData);

    // Simulate 3 cards, each with Title and Description
    for (let card = 0; card < 3; card++) {
      const title = tracker.getValue('Title', undefined, { type: 'increment' });
      const desc = tracker.getValue('Description', undefined, { type: 'increment' });

      expect(title).toBe(`Card ${card + 1}`);
      expect(desc).toBe(`Desc ${card + 1}`);
    }
  });

  it('simulates sync with explicit indices', () => {
    const sheetData: SheetData = {
      worksheets: [
        {
          name: 'Data',
          labels: ['Value'],
          rows: {
            Value: ['A', 'B', 'C', 'D', 'E'],
          },
          orientation: 'columns',
        },
      ],
      activeWorksheet: 'Data',
    };

    const tracker = createIndexTracker(sheetData);

    // Some layers with explicit indices
    expect(tracker.getValue('Value', undefined, { type: 'specific', value: 3 })).toBe('C');
    expect(tracker.getValue('Value', undefined, { type: 'specific', value: 1 })).toBe('A');
    expect(tracker.getValue('Value', undefined, { type: 'specific', value: 5 })).toBe('E');

    // Increment should still work independently
    expect(tracker.getValue('Value', undefined, { type: 'increment' })).toBe('A');
    expect(tracker.getValue('Value', undefined, { type: 'increment' })).toBe('B');
  });

  it('simulates sync with mixed worksheets', () => {
    const sheetData = createTestSheetData();
    const tracker = createIndexTracker(sheetData);

    // Products worksheet
    expect(tracker.getValue('Name', 'Products', { type: 'increment' })).toBe('Widget');
    expect(tracker.getValue('Price', 'Products', { type: 'increment' })).toBe('19.99');

    // Users worksheet
    expect(tracker.getValue('First Name', 'Users', { type: 'increment' })).toBe('Alice');
    expect(tracker.getValue('Email', 'Users', { type: 'increment' })).toBe('alice@test.com');

    // Back to Products - should continue
    expect(tracker.getValue('Name', 'Products', { type: 'increment' })).toBe('Gadget');
  });
});
