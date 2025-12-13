/**
 * Unit tests for Google Sheets URL parsing utilities.
 */

import { describe, it, expect } from 'vitest';
import {
  parseGoogleSheetsUrl,
  buildCsvExportUrl,
  buildJsonExportUrl,
  buildEditUrl,
  looksLikeGoogleSheetsUrl,
  normalizeGoogleSheetsUrl,
} from '../../src/utils/url';

describe('parseGoogleSheetsUrl', () => {
  describe('valid URLs', () => {
    it('parses basic edit URL', () => {
      const result = parseGoogleSheetsUrl(
        'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit'
      );
      expect(result.isValid).toBe(true);
      expect(result.spreadsheetId).toBe('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms');
      expect(result.gid).toBeUndefined();
      expect(result.errorMessage).toBeUndefined();
    });

    it('parses URL with gid in hash', () => {
      const result = parseGoogleSheetsUrl(
        'https://docs.google.com/spreadsheets/d/abc123/edit#gid=456'
      );
      expect(result.isValid).toBe(true);
      expect(result.spreadsheetId).toBe('abc123');
      expect(result.gid).toBe('456');
    });

    it('parses URL with gid in query string', () => {
      const result = parseGoogleSheetsUrl(
        'https://docs.google.com/spreadsheets/d/abc123/edit?gid=789'
      );
      expect(result.isValid).toBe(true);
      expect(result.spreadsheetId).toBe('abc123');
      expect(result.gid).toBe('789');
    });

    it('parses URL with sharing parameter', () => {
      const result = parseGoogleSheetsUrl(
        'https://docs.google.com/spreadsheets/d/abc123/edit?usp=sharing'
      );
      expect(result.isValid).toBe(true);
      expect(result.spreadsheetId).toBe('abc123');
    });

    it('parses URL with sharing and gid', () => {
      const result = parseGoogleSheetsUrl(
        'https://docs.google.com/spreadsheets/d/abc123/edit?usp=sharing#gid=111'
      );
      expect(result.isValid).toBe(true);
      expect(result.spreadsheetId).toBe('abc123');
      expect(result.gid).toBe('111');
    });

    it('parses URL without edit suffix', () => {
      const result = parseGoogleSheetsUrl(
        'https://docs.google.com/spreadsheets/d/abc123'
      );
      expect(result.isValid).toBe(true);
      expect(result.spreadsheetId).toBe('abc123');
    });

    it('parses URL with trailing slash', () => {
      const result = parseGoogleSheetsUrl(
        'https://docs.google.com/spreadsheets/d/abc123/'
      );
      expect(result.isValid).toBe(true);
      expect(result.spreadsheetId).toBe('abc123');
    });

    it('parses URL with view suffix', () => {
      const result = parseGoogleSheetsUrl(
        'https://docs.google.com/spreadsheets/d/abc123/view'
      );
      expect(result.isValid).toBe(true);
      expect(result.spreadsheetId).toBe('abc123');
    });

    it('parses URL with export path', () => {
      const result = parseGoogleSheetsUrl(
        'https://docs.google.com/spreadsheets/d/abc123/export?format=csv'
      );
      expect(result.isValid).toBe(true);
      expect(result.spreadsheetId).toBe('abc123');
    });

    it('parses URL with gviz path', () => {
      const result = parseGoogleSheetsUrl(
        'https://docs.google.com/spreadsheets/d/abc123/gviz/tq?tqx=out:json'
      );
      expect(result.isValid).toBe(true);
      expect(result.spreadsheetId).toBe('abc123');
    });

    it('handles spreadsheet ID with hyphens', () => {
      const result = parseGoogleSheetsUrl(
        'https://docs.google.com/spreadsheets/d/abc-123-def/edit'
      );
      expect(result.isValid).toBe(true);
      expect(result.spreadsheetId).toBe('abc-123-def');
    });

    it('handles spreadsheet ID with underscores', () => {
      const result = parseGoogleSheetsUrl(
        'https://docs.google.com/spreadsheets/d/abc_123_def/edit'
      );
      expect(result.isValid).toBe(true);
      expect(result.spreadsheetId).toBe('abc_123_def');
    });

    it('trims whitespace from URL', () => {
      const result = parseGoogleSheetsUrl(
        '  https://docs.google.com/spreadsheets/d/abc123/edit  '
      );
      expect(result.isValid).toBe(true);
      expect(result.spreadsheetId).toBe('abc123');
    });

    it('handles http:// URLs (upgrades conceptually)', () => {
      const result = parseGoogleSheetsUrl(
        'http://docs.google.com/spreadsheets/d/abc123/edit'
      );
      expect(result.isValid).toBe(true);
      expect(result.spreadsheetId).toBe('abc123');
    });
  });

  describe('invalid URLs', () => {
    it('rejects empty string', () => {
      const result = parseGoogleSheetsUrl('');
      expect(result.isValid).toBe(false);
      expect(result.spreadsheetId).toBe('');
      expect(result.errorMessage).toBe('Please enter a Google Sheets URL');
    });

    it('rejects whitespace-only string', () => {
      const result = parseGoogleSheetsUrl('   ');
      expect(result.isValid).toBe(false);
      expect(result.errorMessage).toBe('Please enter a Google Sheets URL');
    });

    it('rejects non-URL strings', () => {
      const result = parseGoogleSheetsUrl('not a url');
      expect(result.isValid).toBe(false);
      expect(result.errorMessage).toBe('URL must start with http:// or https://');
    });

    it('rejects URLs without protocol', () => {
      const result = parseGoogleSheetsUrl('docs.google.com/spreadsheets/d/abc123/edit');
      expect(result.isValid).toBe(false);
      expect(result.errorMessage).toBe('URL must start with http:// or https://');
    });

    it('rejects non-Google Docs URLs', () => {
      const result = parseGoogleSheetsUrl('https://example.com/spreadsheets/d/abc123');
      expect(result.isValid).toBe(false);
      expect(result.errorMessage).toBe('URL must be from docs.google.com');
    });

    it('rejects Google Forms URLs', () => {
      const result = parseGoogleSheetsUrl(
        'https://docs.google.com/forms/d/abc123/edit'
      );
      expect(result.isValid).toBe(false);
      expect(result.errorMessage).toContain('Google Forms');
    });

    it('rejects Google Docs URLs', () => {
      const result = parseGoogleSheetsUrl(
        'https://docs.google.com/document/d/abc123/edit'
      );
      expect(result.isValid).toBe(false);
      expect(result.errorMessage).toContain('Google Doc');
    });

    it('rejects Google Slides URLs', () => {
      const result = parseGoogleSheetsUrl(
        'https://docs.google.com/presentation/d/abc123/edit'
      );
      expect(result.isValid).toBe(false);
      expect(result.errorMessage).toContain('Google Doc');
    });

    it('rejects Google Drawings URLs', () => {
      const result = parseGoogleSheetsUrl(
        'https://docs.google.com/drawings/d/abc123/edit'
      );
      expect(result.isValid).toBe(false);
      expect(result.errorMessage).toContain('Google Doc');
    });

    it('rejects URL missing spreadsheet ID', () => {
      const result = parseGoogleSheetsUrl(
        'https://docs.google.com/spreadsheets/u/0/'
      );
      expect(result.isValid).toBe(false);
      expect(result.errorMessage).toContain('Could not find spreadsheet ID');
    });

    it('rejects Google Docs homepage', () => {
      const result = parseGoogleSheetsUrl('https://docs.google.com/');
      expect(result.isValid).toBe(false);
      expect(result.errorMessage).toContain('Could not find spreadsheet ID');
    });
  });
});

describe('buildCsvExportUrl', () => {
  it('builds URL with default gid', () => {
    const url = buildCsvExportUrl('abc123');
    expect(url).toBe(
      'https://docs.google.com/spreadsheets/d/abc123/export?format=csv&gid=0'
    );
  });

  it('builds URL with specified gid', () => {
    const url = buildCsvExportUrl('abc123', '456');
    expect(url).toBe(
      'https://docs.google.com/spreadsheets/d/abc123/export?format=csv&gid=456'
    );
  });
});

describe('buildJsonExportUrl', () => {
  it('builds URL without gid', () => {
    const url = buildJsonExportUrl('abc123');
    expect(url).toBe(
      'https://docs.google.com/spreadsheets/d/abc123/gviz/tq?tqx=out:json'
    );
  });

  it('builds URL with gid', () => {
    const url = buildJsonExportUrl('abc123', '456');
    expect(url).toBe(
      'https://docs.google.com/spreadsheets/d/abc123/gviz/tq?tqx=out:json&gid=456'
    );
  });
});

describe('buildEditUrl', () => {
  it('builds edit URL', () => {
    const url = buildEditUrl('abc123');
    expect(url).toBe('https://docs.google.com/spreadsheets/d/abc123/edit');
  });
});

describe('looksLikeGoogleSheetsUrl', () => {
  it('returns true for valid-looking URLs', () => {
    expect(
      looksLikeGoogleSheetsUrl('https://docs.google.com/spreadsheets/d/abc123/edit')
    ).toBe(true);
  });

  it('returns true for case variations', () => {
    expect(
      looksLikeGoogleSheetsUrl('HTTPS://DOCS.GOOGLE.COM/SPREADSHEETS/D/ABC123')
    ).toBe(true);
  });

  it('returns false for non-Google URLs', () => {
    expect(looksLikeGoogleSheetsUrl('https://example.com/spreadsheets')).toBe(false);
  });

  it('returns false for Google Docs without spreadsheets', () => {
    expect(looksLikeGoogleSheetsUrl('https://docs.google.com/document/d/abc')).toBe(
      false
    );
  });

  it('returns false for empty string', () => {
    expect(looksLikeGoogleSheetsUrl('')).toBe(false);
  });
});

describe('normalizeGoogleSheetsUrl', () => {
  it('normalizes URL to consistent format', () => {
    const normalized = normalizeGoogleSheetsUrl(
      'https://docs.google.com/spreadsheets/d/abc123/edit?usp=sharing'
    );
    expect(normalized).toBe('https://docs.google.com/spreadsheets/d/abc123/edit');
  });

  it('preserves gid in normalized URL', () => {
    const normalized = normalizeGoogleSheetsUrl(
      'https://docs.google.com/spreadsheets/d/abc123/edit?usp=sharing#gid=456'
    );
    expect(normalized).toBe(
      'https://docs.google.com/spreadsheets/d/abc123/edit#gid=456'
    );
  });

  it('returns original URL if parsing fails', () => {
    const original = 'not a valid url';
    const normalized = normalizeGoogleSheetsUrl(original);
    expect(normalized).toBe(original);
  });
});
