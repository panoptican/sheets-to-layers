/**
 * Unit tests for text layer synchronization.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createMockText,
  createMockPage,
  createMockDocument,
  createMockFigma,
  setupMockFigma,
  cleanupMockFigma,
  resetNodeIdCounter,
  getLoadedFonts,
  clearLoadedFonts,
  setFailingFonts,
  MOCK_MIXED_SYMBOL,
  DEFAULT_MOCK_FONT,
  type MockFontName,
  type MockTextNode,
} from '../mocks/figma';
import {
  loadFontsForTextNode,
  getFontsInTextNode,
  syncTextLayer,
  batchSyncTextLayers,
  isEmptyValue,
  tryLoadFont,
} from '../../src/core/text-sync';

describe('Text Sync', () => {
  beforeEach(() => {
    resetNodeIdCounter();
    const page = createMockPage('Page 1');
    const doc = createMockDocument([page]);
    const mockFigma = createMockFigma(doc, page);
    setupMockFigma(mockFigma);
    clearLoadedFonts();
  });

  afterEach(() => {
    cleanupMockFigma();
  });

  // ============================================================================
  // Font Loading Tests
  // ============================================================================

  describe('loadFontsForTextNode', () => {
    it('loads single font from text node', async () => {
      const textNode = createMockText('#Title', 'Hello World');

      await loadFontsForTextNode(textNode as unknown as TextNode);

      const loadedFonts = getLoadedFonts();
      expect(loadedFonts.has('Inter:Regular')).toBe(true);
    });

    it('loads custom font', async () => {
      const customFont: MockFontName = { family: 'Roboto', style: 'Bold' };
      const textNode = createMockText('#Title', 'Hello', customFont);

      await loadFontsForTextNode(textNode as unknown as TextNode);

      const loadedFonts = getLoadedFonts();
      expect(loadedFonts.has('Roboto:Bold')).toBe(true);
    });

    it('loads font for empty text node', async () => {
      const textNode = createMockText('#Title', '');

      await loadFontsForTextNode(textNode as unknown as TextNode);

      const loadedFonts = getLoadedFonts();
      expect(loadedFonts.has('Inter:Regular')).toBe(true);
    });

    it('loads all fonts from mixed font text node', async () => {
      const mixedFonts: MockFontName[] = [
        { family: 'Inter', style: 'Regular' },  // H
        { family: 'Inter', style: 'Regular' },  // e
        { family: 'Inter', style: 'Bold' },     // l
        { family: 'Inter', style: 'Bold' },     // l
        { family: 'Roboto', style: 'Italic' },  // o
      ];
      const textNode = createMockText('#Title', 'Hello', MOCK_MIXED_SYMBOL, mixedFonts);

      await loadFontsForTextNode(textNode as unknown as TextNode);

      const loadedFonts = getLoadedFonts();
      expect(loadedFonts.has('Inter:Regular')).toBe(true);
      expect(loadedFonts.has('Inter:Bold')).toBe(true);
      expect(loadedFonts.has('Roboto:Italic')).toBe(true);
      expect(loadedFonts.size).toBe(3); // Only unique fonts
    });
  });

  describe('getFontsInTextNode', () => {
    it('returns single font from simple text node', () => {
      const textNode = createMockText('#Title', 'Hello');

      const fonts = getFontsInTextNode(textNode as unknown as TextNode);

      expect(fonts).toHaveLength(1);
      expect(fonts[0]).toEqual(DEFAULT_MOCK_FONT);
    });

    it('returns default font for empty text node', () => {
      const textNode = createMockText('#Title', '');

      const fonts = getFontsInTextNode(textNode as unknown as TextNode);

      expect(fonts).toHaveLength(1);
      expect(fonts[0]).toEqual(DEFAULT_MOCK_FONT);
    });

    it('returns all unique fonts from mixed font text node', () => {
      const mixedFonts: MockFontName[] = [
        { family: 'Inter', style: 'Regular' },
        { family: 'Inter', style: 'Regular' },
        { family: 'Inter', style: 'Bold' },
        { family: 'Roboto', style: 'Italic' },
      ];
      const textNode = createMockText('#Title', 'Text', MOCK_MIXED_SYMBOL, mixedFonts);

      const fonts = getFontsInTextNode(textNode as unknown as TextNode);

      expect(fonts).toHaveLength(3);
      expect(fonts).toContainEqual({ family: 'Inter', style: 'Regular' });
      expect(fonts).toContainEqual({ family: 'Inter', style: 'Bold' });
      expect(fonts).toContainEqual({ family: 'Roboto', style: 'Italic' });
    });
  });

  // ============================================================================
  // Text Sync Tests
  // ============================================================================

  describe('syncTextLayer', () => {
    it('sets text content from value', async () => {
      const textNode = createMockText('#Title', 'Old text');

      const result = await syncTextLayer(textNode as unknown as TextNode, 'New text');

      expect(result.success).toBe(true);
      expect(result.contentChanged).toBe(true);
      expect(textNode.characters).toBe('New text');
    });

    it('loads font before setting text', async () => {
      const textNode = createMockText('#Title', 'Old text');

      await syncTextLayer(textNode as unknown as TextNode, 'New text');

      const loadedFonts = getLoadedFonts();
      expect(loadedFonts.has('Inter:Regular')).toBe(true);
    });

    it('does not mark as changed when content is the same', async () => {
      const textNode = createMockText('#Title', 'Same text');

      const result = await syncTextLayer(textNode as unknown as TextNode, 'Same text');

      expect(result.success).toBe(true);
      expect(result.contentChanged).toBe(false);
      expect(textNode.characters).toBe('Same text');
    });

    it('handles empty value by clearing text', async () => {
      const textNode = createMockText('#Title', 'Has content');

      const result = await syncTextLayer(textNode as unknown as TextNode, '');

      expect(result.success).toBe(true);
      expect(result.contentChanged).toBe(true);
      expect(textNode.characters).toBe('');
    });

    it('handles whitespace-only value as empty', async () => {
      const textNode = createMockText('#Title', 'Has content');

      const result = await syncTextLayer(textNode as unknown as TextNode, '   ');

      expect(result.success).toBe(true);
      expect(result.contentChanged).toBe(true);
      expect(textNode.characters).toBe('');
    });

    it('preserves content when clearOnEmpty is false', async () => {
      const textNode = createMockText('#Title', 'Original');

      const result = await syncTextLayer(textNode as unknown as TextNode, '', {
        clearOnEmpty: false,
      });

      expect(result.success).toBe(true);
      expect(result.contentChanged).toBe(false);
      expect(textNode.characters).toBe('Original');
    });

    it('handles special data type prefix', async () => {
      const textNode = createMockText('#Title', 'Original');

      const result = await syncTextLayer(textNode as unknown as TextNode, '/hide');

      expect(result.success).toBe(true);
      expect(result.contentChanged).toBe(false);
      expect(textNode.characters).toBe('Original'); // Content not changed
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('handles additional values with warnings', async () => {
      const textNode = createMockText('#Title', 'Old');

      const result = await syncTextLayer(textNode as unknown as TextNode, 'New', {
        additionalValues: ['#FF0000', '24px'],
      });

      expect(result.success).toBe(true);
      expect(result.contentChanged).toBe(true);
      expect(textNode.characters).toBe('New');
      expect(result.warnings.length).toBe(2); // Warnings for unimplemented properties
    });

    it('returns error info when sync fails', async () => {
      // Set up a font that will fail
      setFailingFonts(['Inter:Regular']);
      const textNode = createMockText('#BadFont', 'Text');

      const result = await syncTextLayer(textNode as unknown as TextNode, 'New');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.layerName).toBe('#BadFont');
    });
  });

  // ============================================================================
  // Batch Sync Tests
  // ============================================================================

  describe('batchSyncTextLayers', () => {
    it('syncs multiple text layers', async () => {
      const entries = [
        { node: createMockText('#Title', '') as unknown as TextNode, value: 'Title 1' },
        { node: createMockText('#Desc', '') as unknown as TextNode, value: 'Description' },
        { node: createMockText('#Price', '') as unknown as TextNode, value: '$99' },
      ];

      const result = await batchSyncTextLayers(entries);

      expect(result.totalProcessed).toBe(3);
      expect(result.successCount).toBe(3);
      expect(result.failureCount).toBe(0);
      expect(result.changedCount).toBe(3);
    });

    it('tracks unchanged layers separately', async () => {
      const node1 = createMockText('#Title', 'Same');
      const node2 = createMockText('#Desc', 'Old');
      const entries = [
        { node: node1 as unknown as TextNode, value: 'Same' },
        { node: node2 as unknown as TextNode, value: 'New' },
      ];

      const result = await batchSyncTextLayers(entries);

      expect(result.totalProcessed).toBe(2);
      expect(result.successCount).toBe(2);
      expect(result.changedCount).toBe(1); // Only node2 changed
    });

    it('continues after individual failures', async () => {
      setFailingFonts(['Roboto:Bold']);
      const badFont: MockFontName = { family: 'Roboto', style: 'Bold' };
      const entries = [
        { node: createMockText('#Good', '') as unknown as TextNode, value: 'Good' },
        { node: createMockText('#Bad', '', badFont) as unknown as TextNode, value: 'Bad' },
        { node: createMockText('#Also Good', '') as unknown as TextNode, value: 'Also good' },
      ];

      const result = await batchSyncTextLayers(entries);

      expect(result.totalProcessed).toBe(3);
      expect(result.successCount).toBe(2);
      expect(result.failureCount).toBe(1);
      expect(result.errors).toHaveLength(1);
    });

    it('collects warnings from all layers', async () => {
      const entries = [
        {
          node: createMockText('#Title', '') as unknown as TextNode,
          value: 'Title',
          additionalValues: ['#FF0000'],
        },
        {
          node: createMockText('#Desc', '') as unknown as TextNode,
          value: 'Desc',
          additionalValues: ['24px', '50%'],
        },
      ];

      const result = await batchSyncTextLayers(entries);

      expect(result.warnings.length).toBe(3); // 1 + 2 warnings
    });

    it('handles empty batch', async () => {
      const result = await batchSyncTextLayers([]);

      expect(result.totalProcessed).toBe(0);
      expect(result.successCount).toBe(0);
      expect(result.failureCount).toBe(0);
      expect(result.changedCount).toBe(0);
    });
  });

  // ============================================================================
  // Utility Tests
  // ============================================================================

  describe('isEmptyValue', () => {
    it('returns true for null', () => {
      expect(isEmptyValue(null)).toBe(true);
    });

    it('returns true for undefined', () => {
      expect(isEmptyValue(undefined)).toBe(true);
    });

    it('returns true for empty string', () => {
      expect(isEmptyValue('')).toBe(true);
    });

    it('returns true for whitespace-only string', () => {
      expect(isEmptyValue('   ')).toBe(true);
      expect(isEmptyValue('\t')).toBe(true);
      expect(isEmptyValue('\n')).toBe(true);
    });

    it('returns false for non-empty string', () => {
      expect(isEmptyValue('hello')).toBe(false);
      expect(isEmptyValue('  hello  ')).toBe(false);
      expect(isEmptyValue('0')).toBe(false);
    });
  });

  describe('tryLoadFont', () => {
    it('returns true when font loads successfully', async () => {
      const result = await tryLoadFont({ family: 'Inter', style: 'Regular' } as FontName);
      expect(result).toBe(true);
    });

    it('returns false when font fails to load', async () => {
      setFailingFonts(['Nonexistent:Bold']);
      const result = await tryLoadFont({ family: 'Nonexistent', style: 'Bold' } as FontName);
      expect(result).toBe(false);
    });
  });
});
