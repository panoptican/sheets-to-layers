/**
 * Unit tests for layer name parsing utilities.
 */

import { describe, it, expect } from 'vitest';
import {
  parseLayerName,
  normalizeLabel,
  matchLabel,
  hasMatchingLabel,
  extractLabels,
  hasBinding,
  isIgnoredLayer,
  isRepeatFrame,
  createEmptyParsedLayerName,
  extractWorksheet,
  extractIndex,
  hasWorksheet,
  hasIndex,
  resolveInheritedParsedName,
  DEFAULT_INDEX,
} from '../../src/core/parser';

describe('parseLayerName', () => {
  describe('basic label extraction', () => {
    it('extracts single label', () => {
      const result = parseLayerName('#Title');
      expect(result.hasBinding).toBe(true);
      expect(result.labels).toEqual(['Title']);
      expect(result.isIgnored).toBe(false);
      expect(result.forceInclude).toBe(false);
      expect(result.isRepeatFrame).toBe(false);
    });

    it('extracts label up to space (spaces not included in labels)', () => {
      const result = parseLayerName('#First Name');
      expect(result.hasBinding).toBe(true);
      // Labels don't include spaces - use #First_Name or #FirstName instead
      expect(result.labels).toEqual(['First']);
    });

    it('extracts label with underscores', () => {
      const result = parseLayerName('#first_name');
      expect(result.hasBinding).toBe(true);
      expect(result.labels).toEqual(['first_name']);
    });

    it('extracts label with hyphens', () => {
      const result = parseLayerName('#first-name');
      expect(result.hasBinding).toBe(true);
      expect(result.labels).toEqual(['first-name']);
    });

    it('extracts uppercase label', () => {
      const result = parseLayerName('#TITLE');
      expect(result.hasBinding).toBe(true);
      expect(result.labels).toEqual(['TITLE']);
    });

    it('extracts label with trailing numbers', () => {
      const result = parseLayerName('#Price2');
      expect(result.hasBinding).toBe(true);
      expect(result.labels).toEqual(['Price2']);
    });

    it('extracts label from middle of name', () => {
      const result = parseLayerName('Layer #Title here');
      expect(result.hasBinding).toBe(true);
      expect(result.labels).toEqual(['Title']);
    });

    it('extracts label at end of name', () => {
      const result = parseLayerName('My Layer #Title');
      expect(result.hasBinding).toBe(true);
      expect(result.labels).toEqual(['Title']);
    });
  });

  describe('multiple labels', () => {
    it('extracts two labels', () => {
      const result = parseLayerName('#status #colour');
      expect(result.hasBinding).toBe(true);
      expect(result.labels).toEqual(['status', 'colour']);
    });

    it('extracts three labels', () => {
      const result = parseLayerName('#name #email #phone');
      expect(result.hasBinding).toBe(true);
      expect(result.labels).toEqual(['name', 'email', 'phone']);
    });

    it('extracts labels with mixed formatting', () => {
      const result = parseLayerName('#FirstName #email_address #Phone-Number');
      expect(result.hasBinding).toBe(true);
      expect(result.labels).toEqual(['FirstName', 'email_address', 'Phone-Number']);
    });

    it('extracts labels with prefix text', () => {
      const result = parseLayerName('Card #Title #Subtitle');
      expect(result.hasBinding).toBe(true);
      expect(result.labels).toEqual(['Title', 'Subtitle']);
    });
  });

  describe('no binding cases', () => {
    it('returns hasBinding false for plain text', () => {
      const result = parseLayerName('Regular Layer');
      expect(result.hasBinding).toBe(false);
      expect(result.labels).toEqual([]);
    });

    it('returns hasBinding false for empty string', () => {
      const result = parseLayerName('');
      expect(result.hasBinding).toBe(false);
      expect(result.labels).toEqual([]);
    });

    it('returns hasBinding false for whitespace only', () => {
      const result = parseLayerName('   ');
      expect(result.hasBinding).toBe(false);
      expect(result.labels).toEqual([]);
    });

    it('returns hasBinding false for # without label', () => {
      const result = parseLayerName('Layer #');
      expect(result.hasBinding).toBe(false);
      expect(result.labels).toEqual([]);
    });

    it('returns hasBinding false for # with only spaces', () => {
      const result = parseLayerName('Layer #   ');
      expect(result.hasBinding).toBe(false);
      expect(result.labels).toEqual([]);
    });
  });

  describe('ignore prefix (-)', () => {
    it('detects ignore prefix', () => {
      const result = parseLayerName('-Background');
      expect(result.isIgnored).toBe(true);
      expect(result.hasBinding).toBe(false);
      expect(result.labels).toEqual([]);
    });

    it('ignores labels after ignore prefix', () => {
      const result = parseLayerName('-Layer #Title');
      expect(result.isIgnored).toBe(true);
      expect(result.hasBinding).toBe(false);
      expect(result.labels).toEqual([]);
    });

    it('does not treat hyphen in middle as ignore', () => {
      const result = parseLayerName('Layer-Name #Title');
      expect(result.isIgnored).toBe(false);
      expect(result.hasBinding).toBe(true);
      expect(result.labels).toEqual(['Title']);
    });
  });

  describe('force include prefix (+)', () => {
    it('detects force include prefix', () => {
      const result = parseLayerName('+ComponentName');
      expect(result.forceInclude).toBe(true);
      expect(result.hasBinding).toBe(false);
    });

    it('extracts labels after force include prefix', () => {
      const result = parseLayerName('+Card #Title');
      expect(result.forceInclude).toBe(true);
      expect(result.hasBinding).toBe(true);
      expect(result.labels).toEqual(['Title']);
    });

    it('extracts multiple labels after force include prefix', () => {
      const result = parseLayerName('+Card #Title #Subtitle');
      expect(result.forceInclude).toBe(true);
      expect(result.labels).toEqual(['Title', 'Subtitle']);
    });

    it('does not treat plus in middle as force include', () => {
      const result = parseLayerName('Layer+Name #Title');
      expect(result.forceInclude).toBe(false);
      expect(result.hasBinding).toBe(true);
    });
  });

  describe('repeat frame marker (@#)', () => {
    it('detects repeat frame marker', () => {
      const result = parseLayerName('Cards @#');
      expect(result.isRepeatFrame).toBe(true);
    });

    it('detects repeat frame with labels', () => {
      const result = parseLayerName('Cards @# #Title');
      expect(result.isRepeatFrame).toBe(true);
      expect(result.hasBinding).toBe(true);
      expect(result.labels).toEqual(['Title']);
    });

    it('detects repeat frame at start', () => {
      const result = parseLayerName('@# Container');
      expect(result.isRepeatFrame).toBe(true);
    });

    it('detects repeat frame in middle', () => {
      const result = parseLayerName('My @# Frame');
      expect(result.isRepeatFrame).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('handles label with numbers after initial letter', () => {
      const result = parseLayerName('#Item1');
      expect(result.hasBinding).toBe(true);
      expect(result.labels).toEqual(['Item1']);
    });

    it('handles single letter label with number', () => {
      const result = parseLayerName('#a1');
      expect(result.hasBinding).toBe(true);
      expect(result.labels).toEqual(['a1']);
    });

    it('does not match label starting with number', () => {
      const result = parseLayerName('#1stItem');
      // Labels must start with a letter
      expect(result.hasBinding).toBe(false);
      expect(result.labels).toEqual([]);
    });

    it('handles very long label', () => {
      const longLabel = 'A'.repeat(100);
      const result = parseLayerName(`#${longLabel}`);
      expect(result.hasBinding).toBe(true);
      expect(result.labels).toEqual([longLabel]);
    });

    it('handles special characters in surrounding text', () => {
      const result = parseLayerName('Layer (1) #Title [test]');
      expect(result.hasBinding).toBe(true);
      expect(result.labels).toEqual(['Title']);
    });

    it('handles consecutive # symbols', () => {
      const result = parseLayerName('##Title');
      expect(result.hasBinding).toBe(true);
      // First # has no label, second # captures Title
      expect(result.labels).toEqual(['Title']);
    });

    it('handles label followed by whitespace', () => {
      const result = parseLayerName('#Title  ');
      expect(result.hasBinding).toBe(true);
      expect(result.labels).toEqual(['Title']);
    });

    it('does not match # followed by space (invalid label)', () => {
      const result = parseLayerName('#  Title');
      // # followed by spaces is not a valid label start
      expect(result.hasBinding).toBe(false);
      expect(result.labels).toEqual([]);
    });

    it('treats escaped # as a literal character', () => {
      const result = parseLayerName('Price \\#USD #RealLabel');
      expect(result.hasBinding).toBe(true);
      expect(result.labels).toEqual(['RealLabel']);
    });

    it('treats escaped // as literal text (not worksheet syntax)', () => {
      const result = parseLayerName('Layer \\// NotWorksheet #Title');
      expect(result.worksheet).toBeUndefined();
      expect(result.labels).toEqual(['Title']);
    });
  });

  describe('combined features', () => {
    it('handles force include with repeat frame', () => {
      const result = parseLayerName('+Container @# #Items');
      expect(result.forceInclude).toBe(true);
      expect(result.isRepeatFrame).toBe(true);
      expect(result.hasBinding).toBe(true);
      expect(result.labels).toEqual(['Items']);
    });

    it('ignore prefix takes precedence', () => {
      const result = parseLayerName('-Layer @# #Title');
      expect(result.isIgnored).toBe(true);
      expect(result.isRepeatFrame).toBe(false);
      expect(result.hasBinding).toBe(false);
    });
  });
});

describe('normalizeLabel', () => {
  it('lowercases the label', () => {
    expect(normalizeLabel('TITLE')).toBe('title');
    expect(normalizeLabel('Title')).toBe('title');
    expect(normalizeLabel('TiTlE')).toBe('title');
  });

  it('removes spaces', () => {
    expect(normalizeLabel('First Name')).toBe('firstname');
    expect(normalizeLabel('  Spaced  Out  ')).toBe('spacedout');
  });

  it('removes underscores', () => {
    expect(normalizeLabel('first_name')).toBe('firstname');
    expect(normalizeLabel('__double__underscore__')).toBe('doubleunderscore');
  });

  it('removes hyphens', () => {
    expect(normalizeLabel('first-name')).toBe('firstname');
    expect(normalizeLabel('--double--hyphen--')).toBe('doublehyphen');
  });

  it('removes mixed separators', () => {
    expect(normalizeLabel('first_name-test here')).toBe('firstnametesthere');
  });

  it('handles empty string', () => {
    expect(normalizeLabel('')).toBe('');
  });

  it('handles numbers', () => {
    expect(normalizeLabel('Item 1')).toBe('item1');
    expect(normalizeLabel('123')).toBe('123');
  });
});

describe('matchLabel', () => {
  const sheetLabels = ['First Name', 'Email', 'Status', 'Phone Number'];

  it('matches exact case', () => {
    expect(matchLabel('First Name', sheetLabels)).toBe('First Name');
  });

  it('matches different case', () => {
    expect(matchLabel('FIRST NAME', sheetLabels)).toBe('First Name');
    expect(matchLabel('first name', sheetLabels)).toBe('First Name');
  });

  it('matches with underscores', () => {
    expect(matchLabel('first_name', sheetLabels)).toBe('First Name');
  });

  it('matches with hyphens', () => {
    expect(matchLabel('first-name', sheetLabels)).toBe('First Name');
  });

  it('matches camelCase', () => {
    expect(matchLabel('firstName', sheetLabels)).toBe('First Name');
    expect(matchLabel('phoneNumber', sheetLabels)).toBe('Phone Number');
  });

  it('returns null for no match', () => {
    expect(matchLabel('Unknown', sheetLabels)).toBeNull();
    expect(matchLabel('NotInList', sheetLabels)).toBeNull();
  });

  it('returns null for empty label', () => {
    expect(matchLabel('', sheetLabels)).toBeNull();
  });

  it('returns null for empty sheet labels', () => {
    expect(matchLabel('Title', [])).toBeNull();
  });

  it('returns the original sheet label', () => {
    // The returned label should be the original from the sheet, not the input
    const result = matchLabel('EMAIL', sheetLabels);
    expect(result).toBe('Email');
    expect(result).not.toBe('EMAIL');
  });
});

describe('hasMatchingLabel', () => {
  const sheetLabels = ['Title', 'Description'];

  it('returns true for matching label', () => {
    expect(hasMatchingLabel('Title', sheetLabels)).toBe(true);
    expect(hasMatchingLabel('title', sheetLabels)).toBe(true);
  });

  it('returns false for non-matching label', () => {
    expect(hasMatchingLabel('Unknown', sheetLabels)).toBe(false);
  });
});

describe('extractLabels', () => {
  it('extracts labels from simple layer name', () => {
    expect(extractLabels('#Title')).toEqual(['Title']);
  });

  it('extracts multiple labels', () => {
    expect(extractLabels('#Title #Subtitle')).toEqual(['Title', 'Subtitle']);
  });

  it('returns empty array for no labels', () => {
    expect(extractLabels('Regular Layer')).toEqual([]);
  });

  it('returns empty array for ignored layers', () => {
    expect(extractLabels('-Layer #Title')).toEqual([]);
  });

  it('handles force include prefix', () => {
    expect(extractLabels('+Card #Title')).toEqual(['Title']);
  });

  it('ignores escaped # when extracting labels', () => {
    expect(extractLabels('Price \\#USD #Real')).toEqual(['Real']);
  });
});

describe('hasBinding', () => {
  it('returns true for layer with binding', () => {
    expect(hasBinding('#Title')).toBe(true);
    expect(hasBinding('Layer #Title')).toBe(true);
  });

  it('returns false for layer without binding', () => {
    expect(hasBinding('Regular Layer')).toBe(false);
    expect(hasBinding('No hash here')).toBe(false);
  });

  it('returns false for ignored layers', () => {
    expect(hasBinding('-Layer #Title')).toBe(false);
  });

  it('returns false when only escaped labels are present', () => {
    expect(hasBinding('Price \\#USD')).toBe(false);
  });

  it('returns false for empty # syntax', () => {
    expect(hasBinding('#')).toBe(false);
    expect(hasBinding('Layer #')).toBe(false);
  });
});

describe('isIgnoredLayer', () => {
  it('returns true for ignored layers', () => {
    expect(isIgnoredLayer('-Background')).toBe(true);
    expect(isIgnoredLayer('-')).toBe(true);
  });

  it('returns false for non-ignored layers', () => {
    expect(isIgnoredLayer('Regular')).toBe(false);
    expect(isIgnoredLayer('Layer-Name')).toBe(false);
    expect(isIgnoredLayer('#Title')).toBe(false);
  });
});

describe('isRepeatFrame', () => {
  it('returns true for repeat frames', () => {
    expect(isRepeatFrame('@#')).toBe(true);
    expect(isRepeatFrame('Cards @#')).toBe(true);
    expect(isRepeatFrame('@# Container')).toBe(true);
  });

  it('returns false for non-repeat frames', () => {
    expect(isRepeatFrame('Regular')).toBe(false);
    expect(isRepeatFrame('#Title')).toBe(false);
    expect(isRepeatFrame('@ #')).toBe(false); // Space between @ and #
  });
});

describe('createEmptyParsedLayerName', () => {
  it('creates empty parsed layer name', () => {
    const result = createEmptyParsedLayerName();
    expect(result).toEqual({
      hasBinding: false,
      labels: [],
      isIgnored: false,
      forceInclude: false,
      isRepeatFrame: false,
    });
  });
});

// ============================================================================
// TICKET-006: Worksheet and Index Parsing Tests
// ============================================================================

describe('parseLayerName - worksheet syntax', () => {
  it('extracts worksheet from // syntax', () => {
    const result = parseLayerName('Page 1 // Properties');
    expect(result.worksheet).toBe('Properties');
  });

  it('extracts worksheet with spaces', () => {
    const result = parseLayerName('// Sheet Name Here');
    expect(result.worksheet).toBe('Sheet Name Here');
  });

  it('extracts worksheet at start of name', () => {
    const result = parseLayerName('// Products');
    expect(result.worksheet).toBe('Products');
  });

  it('extracts worksheet with underscores', () => {
    const result = parseLayerName('Frame // my_worksheet');
    expect(result.worksheet).toBe('my_worksheet');
  });

  it('extracts worksheet with hyphens', () => {
    const result = parseLayerName('Frame // my-worksheet');
    expect(result.worksheet).toBe('my-worksheet');
  });

  it('extracts worksheet with numbers', () => {
    const result = parseLayerName('Frame // Sheet2');
    expect(result.worksheet).toBe('Sheet2');
  });

  it('returns undefined when no worksheet', () => {
    const result = parseLayerName('#Title');
    expect(result.worksheet).toBeUndefined();
  });

  it('extracts worksheet with label', () => {
    const result = parseLayerName('// Products #Name');
    expect(result.worksheet).toBe('Products');
    expect(result.labels).toEqual(['Name']);
    expect(result.hasBinding).toBe(true);
  });

  it('extracts worksheet from combined syntax', () => {
    const result = parseLayerName('Card // Sheet2 #Name.3');
    expect(result.worksheet).toBe('Sheet2');
    expect(result.labels).toEqual(['Name']);
    expect(result.index).toEqual({ type: 'specific', value: 3 });
  });

  it('does not extract worksheet from ignored layers', () => {
    const result = parseLayerName('-Background // Sheet1');
    expect(result.isIgnored).toBe(true);
    expect(result.worksheet).toBeUndefined();
  });

  it('handles single slash (not worksheet syntax)', () => {
    const result = parseLayerName('Layer / Name #Title');
    expect(result.worksheet).toBeUndefined();
    expect(result.labels).toEqual(['Title']);
  });
});

describe('parseLayerName - index syntax', () => {
  describe('specific index (.N)', () => {
    it('extracts specific index .1', () => {
      const result = parseLayerName('#Title.1');
      expect(result.labels).toEqual(['Title']);
      expect(result.index).toEqual({ type: 'specific', value: 1 });
    });

    it('extracts specific index .5', () => {
      const result = parseLayerName('#Title.5');
      expect(result.labels).toEqual(['Title']);
      expect(result.index).toEqual({ type: 'specific', value: 5 });
    });

    it('extracts multi-digit index', () => {
      const result = parseLayerName('#Title.123');
      expect(result.labels).toEqual(['Title']);
      expect(result.index).toEqual({ type: 'specific', value: 123 });
    });

    it('extracts index from layer without label', () => {
      const result = parseLayerName('Frame.3');
      expect(result.hasBinding).toBe(false);
      expect(result.index).toEqual({ type: 'specific', value: 3 });
    });
  });

  describe('auto-increment (.n)', () => {
    it('extracts .n index (lowercase)', () => {
      const result = parseLayerName('#Title.n');
      expect(result.labels).toEqual(['Title']);
      expect(result.index).toEqual({ type: 'increment' });
    });

    it('extracts .N index (uppercase)', () => {
      const result = parseLayerName('#Title.N');
      expect(result.labels).toEqual(['Title']);
      expect(result.index).toEqual({ type: 'increment' });
    });
  });

  describe('increment non-blank (.i)', () => {
    it('extracts .i index (lowercase)', () => {
      const result = parseLayerName('#Title.i');
      expect(result.labels).toEqual(['Title']);
      expect(result.index).toEqual({ type: 'incrementNonBlank' });
    });

    it('extracts .I index (uppercase)', () => {
      const result = parseLayerName('#Title.I');
      expect(result.labels).toEqual(['Title']);
      expect(result.index).toEqual({ type: 'incrementNonBlank' });
    });
  });

  describe('random index (.x)', () => {
    it('extracts .x index (lowercase)', () => {
      const result = parseLayerName('#Title.x');
      expect(result.labels).toEqual(['Title']);
      expect(result.index).toEqual({ type: 'random' });
    });

    it('extracts .X index (uppercase)', () => {
      const result = parseLayerName('#Title.X');
      expect(result.labels).toEqual(['Title']);
      expect(result.index).toEqual({ type: 'random' });
    });
  });

  describe('random non-blank (.r)', () => {
    it('extracts .r index (lowercase)', () => {
      const result = parseLayerName('#Title.r');
      expect(result.labels).toEqual(['Title']);
      expect(result.index).toEqual({ type: 'randomNonBlank' });
    });

    it('extracts .R index (uppercase)', () => {
      const result = parseLayerName('#Title.R');
      expect(result.labels).toEqual(['Title']);
      expect(result.index).toEqual({ type: 'randomNonBlank' });
    });
  });

  describe('no index', () => {
    it('returns undefined for no index', () => {
      const result = parseLayerName('#Title');
      expect(result.index).toBeUndefined();
    });

    it('does not match .z (invalid index letter)', () => {
      const result = parseLayerName('#Title.z');
      // .z is not a valid index, so label should include it
      expect(result.index).toBeUndefined();
    });
  });

  describe('index with multiple labels', () => {
    it('extracts index with multiple labels', () => {
      const result = parseLayerName('#Name #Email.2');
      expect(result.labels).toEqual(['Name', 'Email']);
      expect(result.index).toEqual({ type: 'specific', value: 2 });
    });
  });

  describe('index does not affect ignored layers', () => {
    it('ignores index on ignored layers', () => {
      const result = parseLayerName('-Background.5');
      expect(result.isIgnored).toBe(true);
      expect(result.index).toBeUndefined();
    });
  });
});

describe('parseLayerName - combined worksheet and index', () => {
  it('parses worksheet + label + specific index', () => {
    const result = parseLayerName('Card // Sheet2 #Name.3');
    expect(result.worksheet).toBe('Sheet2');
    expect(result.labels).toEqual(['Name']);
    expect(result.index).toEqual({ type: 'specific', value: 3 });
  });

  it('parses worksheet + label + increment index', () => {
    const result = parseLayerName('// Products #Price.n');
    expect(result.worksheet).toBe('Products');
    expect(result.labels).toEqual(['Price']);
    expect(result.index).toEqual({ type: 'increment' });
  });

  it('parses worksheet only with index (no label)', () => {
    const result = parseLayerName('Frame // Items.5');
    expect(result.worksheet).toBe('Items');
    expect(result.hasBinding).toBe(false);
    expect(result.index).toEqual({ type: 'specific', value: 5 });
  });

  it('parses all features together', () => {
    const result = parseLayerName('+Card // Products #Title #Price.2');
    expect(result.forceInclude).toBe(true);
    expect(result.worksheet).toBe('Products');
    expect(result.labels).toEqual(['Title', 'Price']);
    expect(result.index).toEqual({ type: 'specific', value: 2 });
  });
});

describe('extractWorksheet', () => {
  it('extracts worksheet from layer name', () => {
    expect(extractWorksheet('// Products')).toBe('Products');
    expect(extractWorksheet('Frame // Sheet1')).toBe('Sheet1');
  });

  it('returns undefined for no worksheet', () => {
    expect(extractWorksheet('#Title')).toBeUndefined();
    expect(extractWorksheet('Regular Layer')).toBeUndefined();
  });

  it('returns undefined for ignored layers', () => {
    expect(extractWorksheet('-Layer // Sheet1')).toBeUndefined();
  });

  it('returns undefined for escaped worksheet syntax', () => {
    expect(extractWorksheet('Layer \\// Sheet1')).toBeUndefined();
  });
});

describe('extractIndex', () => {
  it('extracts specific index', () => {
    expect(extractIndex('#Title.5')).toEqual({ type: 'specific', value: 5 });
  });

  it('extracts increment index', () => {
    expect(extractIndex('#Title.n')).toEqual({ type: 'increment' });
  });

  it('extracts incrementNonBlank index', () => {
    expect(extractIndex('#Title.i')).toEqual({ type: 'incrementNonBlank' });
  });

  it('extracts random index', () => {
    expect(extractIndex('#Title.x')).toEqual({ type: 'random' });
  });

  it('extracts randomNonBlank index', () => {
    expect(extractIndex('#Title.r')).toEqual({ type: 'randomNonBlank' });
  });

  it('returns undefined for no index', () => {
    expect(extractIndex('#Title')).toBeUndefined();
    expect(extractIndex('Regular Layer')).toBeUndefined();
  });

  it('returns undefined for ignored layers', () => {
    expect(extractIndex('-Layer.5')).toBeUndefined();
  });
});

describe('hasWorksheet', () => {
  it('returns true for layers with worksheet', () => {
    expect(hasWorksheet('// Products')).toBe(true);
    expect(hasWorksheet('Frame // Sheet1 #Title')).toBe(true);
  });

  it('returns false for layers without worksheet', () => {
    expect(hasWorksheet('#Title')).toBe(false);
    expect(hasWorksheet('Regular Layer')).toBe(false);
  });
});

describe('hasIndex', () => {
  it('returns true for layers with index', () => {
    expect(hasIndex('#Title.5')).toBe(true);
    expect(hasIndex('#Title.n')).toBe(true);
    expect(hasIndex('Frame.i')).toBe(true);
  });

  it('returns false for layers without index', () => {
    expect(hasIndex('#Title')).toBe(false);
    expect(hasIndex('Regular Layer')).toBe(false);
  });
});

describe('resolveInheritedParsedName', () => {
  it('inherits worksheet from parent', () => {
    const layer = parseLayerName('#Title');
    const parent = parseLayerName('Frame // Products');

    const resolved = resolveInheritedParsedName(layer, [parent]);

    expect(resolved.labels).toEqual(['Title']);
    expect(resolved.worksheet).toBe('Products');
    expect(resolved.index).toBeUndefined();
  });

  it('inherits index from parent', () => {
    const layer = parseLayerName('#Title');
    const parent = parseLayerName('Frame.5');

    const resolved = resolveInheritedParsedName(layer, [parent]);

    expect(resolved.labels).toEqual(['Title']);
    expect(resolved.index).toEqual({ type: 'specific', value: 5 });
  });

  it('inherits both worksheet and index from parent', () => {
    const layer = parseLayerName('#Title');
    const parent = parseLayerName('Frame // Products.3');

    const resolved = resolveInheritedParsedName(layer, [parent]);

    expect(resolved.labels).toEqual(['Title']);
    expect(resolved.worksheet).toBe('Products');
    expect(resolved.index).toEqual({ type: 'specific', value: 3 });
  });

  it('layer worksheet overrides parent worksheet', () => {
    const layer = parseLayerName('// Items #Title');
    const parent = parseLayerName('Frame // Products');

    const resolved = resolveInheritedParsedName(layer, [parent]);

    expect(resolved.worksheet).toBe('Items');
  });

  it('layer index overrides parent index', () => {
    const layer = parseLayerName('#Title.2');
    const parent = parseLayerName('Frame.5');

    const resolved = resolveInheritedParsedName(layer, [parent]);

    expect(resolved.index).toEqual({ type: 'specific', value: 2 });
  });

  it('inherits from grandparent when parent has no value', () => {
    const layer = parseLayerName('#Title');
    const parent = parseLayerName('Card Frame');
    const grandparent = parseLayerName('Container // Products.1');

    const resolved = resolveInheritedParsedName(layer, [parent, grandparent]);

    expect(resolved.worksheet).toBe('Products');
    expect(resolved.index).toEqual({ type: 'specific', value: 1 });
  });

  it('uses nearest ancestor value (parent over grandparent)', () => {
    const layer = parseLayerName('#Title');
    const parent = parseLayerName('Frame // Items');
    const grandparent = parseLayerName('Container // Products');

    const resolved = resolveInheritedParsedName(layer, [parent, grandparent]);

    expect(resolved.worksheet).toBe('Items');
  });

  it('combines values from different ancestors', () => {
    const layer = parseLayerName('#Title');
    const parent = parseLayerName('Frame // Items');
    const grandparent = parseLayerName('Container.5');

    const resolved = resolveInheritedParsedName(layer, [parent, grandparent]);

    expect(resolved.worksheet).toBe('Items');
    expect(resolved.index).toEqual({ type: 'specific', value: 5 });
  });

  it('returns unchanged when no ancestors', () => {
    const layer = parseLayerName('#Title');

    const resolved = resolveInheritedParsedName(layer, []);

    expect(resolved.labels).toEqual(['Title']);
    expect(resolved.worksheet).toBeUndefined();
    expect(resolved.index).toBeUndefined();
  });

  it('preserves all original properties', () => {
    const layer = parseLayerName('+Card @# #Title #Subtitle');
    const parent = parseLayerName('// Products.2');

    const resolved = resolveInheritedParsedName(layer, [parent]);

    expect(resolved.forceInclude).toBe(true);
    expect(resolved.isRepeatFrame).toBe(true);
    expect(resolved.labels).toEqual(['Title', 'Subtitle']);
    expect(resolved.worksheet).toBe('Products');
    expect(resolved.index).toEqual({ type: 'specific', value: 2 });
  });

  it('does not mutate original parsed name', () => {
    const layer = parseLayerName('#Title');
    const parent = parseLayerName('// Products.5');

    resolveInheritedParsedName(layer, [parent]);

    // Original should be unchanged
    expect(layer.worksheet).toBeUndefined();
    expect(layer.index).toBeUndefined();
  });
});

describe('DEFAULT_INDEX', () => {
  it('is auto-increment', () => {
    expect(DEFAULT_INDEX).toEqual({ type: 'increment' });
  });
});
