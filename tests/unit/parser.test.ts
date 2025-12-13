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
