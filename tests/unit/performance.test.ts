/**
 * Tests for performance optimization utilities.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  collectFontsFromLayers,
  processInChunks,
  processInParallelChunks,
  yieldToUI,
  PerfTimer,
} from '../../src/core/performance';
import type { LayerToProcess } from '../../src/core/types';

// Mock figma global
const mockFigma = {
  mixed: Symbol('mixed'),
  loadFontAsync: vi.fn().mockResolvedValue(undefined),
};

(global as Record<string, unknown>).figma = mockFigma;

// Helper to create mock text nodes
function createMockTextNode(
  name: string,
  fontFamily: string = 'Inter',
  fontStyle: string = 'Regular',
  isMixed: boolean = false,
  characters: string = 'Test text'
): LayerToProcess {
  const node = {
    type: 'TEXT',
    name,
    characters,
    fontName: isMixed ? mockFigma.mixed : { family: fontFamily, style: fontStyle },
    getRangeFontName: vi.fn().mockImplementation((start: number, _end: number) => {
      // Simulate different fonts for different positions in mixed text
      const fonts = [
        { family: 'Inter', style: 'Regular' },
        { family: 'Inter', style: 'Bold' },
        { family: 'Roboto', style: 'Regular' },
      ];
      return fonts[start % fonts.length];
    }),
  } as unknown as TextNode;

  return {
    node: node as unknown as SceneNode,
    resolvedBinding: {
      hasBinding: true,
      labels: ['label'],
      isIgnored: false,
      forceInclude: false,
      isRepeatFrame: false,
    },
    depth: 0,
  };
}

// Helper to create mock non-text nodes
function createMockFrameNode(name: string): LayerToProcess {
  const node = {
    type: 'FRAME',
    name,
  } as unknown as FrameNode;

  return {
    node: node as unknown as SceneNode,
    resolvedBinding: {
      hasBinding: true,
      labels: ['label'],
      isIgnored: false,
      forceInclude: false,
      isRepeatFrame: false,
    },
    depth: 0,
  };
}

describe('performance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('collectFontsFromLayers', () => {
    it('collects fonts from simple text nodes', () => {
      const layers = [
        createMockTextNode('Text1', 'Inter', 'Regular'),
        createMockTextNode('Text2', 'Roboto', 'Bold'),
      ];

      const fonts = collectFontsFromLayers(layers);

      expect(fonts.size).toBe(2);
      expect(fonts.has('Inter::Regular')).toBe(true);
      expect(fonts.has('Roboto::Bold')).toBe(true);
    });

    it('deduplicates identical fonts', () => {
      const layers = [
        createMockTextNode('Text1', 'Inter', 'Regular'),
        createMockTextNode('Text2', 'Inter', 'Regular'),
        createMockTextNode('Text3', 'Inter', 'Regular'),
      ];

      const fonts = collectFontsFromLayers(layers);

      expect(fonts.size).toBe(1);
      expect(fonts.has('Inter::Regular')).toBe(true);
    });

    it('ignores non-text nodes', () => {
      const layers = [
        createMockTextNode('Text1', 'Inter', 'Regular'),
        createMockFrameNode('Frame1'),
        createMockFrameNode('Frame2'),
      ];

      const fonts = collectFontsFromLayers(layers);

      expect(fonts.size).toBe(1);
      expect(fonts.has('Inter::Regular')).toBe(true);
    });

    it('collects fonts from mixed-font text nodes', () => {
      const layers = [createMockTextNode('MixedText', 'Inter', 'Regular', true, 'ABC')];

      const fonts = collectFontsFromLayers(layers);

      // Mixed text should have collected all fonts from getRangeFontName
      expect(fonts.size).toBe(3);
      expect(fonts.has('Inter::Regular')).toBe(true);
      expect(fonts.has('Inter::Bold')).toBe(true);
      expect(fonts.has('Roboto::Regular')).toBe(true);
    });

    it('handles empty text nodes', () => {
      const emptyTextLayer = createMockTextNode('Empty', 'Inter', 'Regular', false, '');

      const fonts = collectFontsFromLayers([emptyTextLayer]);

      expect(fonts.size).toBe(1);
      expect(fonts.has('Inter::Regular')).toBe(true);
    });

    it('returns empty set for no text layers', () => {
      const layers = [
        createMockFrameNode('Frame1'),
        createMockFrameNode('Frame2'),
      ];

      const fonts = collectFontsFromLayers(layers);

      expect(fonts.size).toBe(0);
    });
  });

  describe('processInChunks', () => {
    it('processes all items', async () => {
      const items = [1, 2, 3, 4, 5];
      const processor = vi.fn().mockImplementation(async (item: number) => item * 2);

      const results = await processInChunks(items, processor, { chunkSize: 2 });

      expect(results).toEqual([2, 4, 6, 8, 10]);
      expect(processor).toHaveBeenCalledTimes(5);
    });

    it('respects chunk size', async () => {
      const items = Array.from({ length: 100 }, (_, i) => i);
      let chunkCount = 0;
      const processor = vi.fn().mockImplementation(async (item: number) => {
        return item;
      });

      const onProgress = vi.fn().mockImplementation(() => {
        chunkCount++;
      });

      await processInChunks(items, processor, { chunkSize: 25, onProgress });

      // Should have 4 chunks of 25
      expect(onProgress).toHaveBeenCalledTimes(4);
    });

    it('reports progress correctly', async () => {
      const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const progressCalls: { message: string; percent: number }[] = [];

      await processInChunks(items, async (item) => item, {
        chunkSize: 5,
        progressStart: 10,
        progressRange: 80,
        progressLabel: 'Testing',
        onProgress: (message, percent) => {
          progressCalls.push({ message, percent });
        },
      });

      expect(progressCalls.length).toBe(2);
      expect(progressCalls[0].message).toContain('Testing');
      expect(progressCalls[0].message).toContain('5/10');
      expect(progressCalls[0].percent).toBe(50); // 10 + (0.5 * 80) = 50
      expect(progressCalls[1].message).toContain('10/10');
      expect(progressCalls[1].percent).toBe(90); // 10 + (1.0 * 80) = 90
    });

    it('handles empty array', async () => {
      const results = await processInChunks([], async (item) => item);
      expect(results).toEqual([]);
    });

    it('maintains order of results', async () => {
      const items = [5, 3, 1, 4, 2];
      const results = await processInChunks(items, async (item) => item * 10, { chunkSize: 2 });
      expect(results).toEqual([50, 30, 10, 40, 20]);
    });
  });

  describe('processInParallelChunks', () => {
    it('processes items in parallel within chunks', async () => {
      const items = [1, 2, 3, 4, 5];
      const startTimes: number[] = [];

      const processor = vi.fn().mockImplementation(async (item: number, index: number) => {
        startTimes[index] = Date.now();
        await new Promise((resolve) => setTimeout(resolve, 10));
        return item * 2;
      });

      const results = await processInParallelChunks(items, processor, { chunkSize: 5 });

      expect(results).toEqual([2, 4, 6, 8, 10]);

      // All items in same chunk should start nearly simultaneously
      const maxTimeDiff = Math.max(...startTimes) - Math.min(...startTimes);
      expect(maxTimeDiff).toBeLessThan(5); // Should all start within 5ms
    });

    it('maintains result order despite parallel processing', async () => {
      const items = [1, 2, 3, 4, 5];

      // Simulate varying processing times
      const processor = async (item: number) => {
        await new Promise((resolve) => setTimeout(resolve, (6 - item) * 5));
        return item;
      };

      const results = await processInParallelChunks(items, processor, { chunkSize: 5 });

      expect(results).toEqual([1, 2, 3, 4, 5]); // Order preserved
    });
  });

  describe('yieldToUI', () => {
    it('resolves after setTimeout', async () => {
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

      await yieldToUI();

      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 0);
      setTimeoutSpy.mockRestore();
    });
  });

  describe('PerfTimer', () => {
    it('tracks elapsed time', async () => {
      const timer = new PerfTimer();

      await new Promise((resolve) => setTimeout(resolve, 50));

      const elapsed = timer.elapsed();
      expect(elapsed).toBeGreaterThanOrEqual(45); // Allow some variance
      expect(elapsed).toBeLessThan(100);
    });

    it('records marks', async () => {
      const timer = new PerfTimer();

      await new Promise((resolve) => setTimeout(resolve, 10));
      timer.mark('first');

      await new Promise((resolve) => setTimeout(resolve, 10));
      timer.mark('second');

      const report = timer.report();

      expect(report).toContain('first:');
      expect(report).toContain('second:');
      expect(report).toContain('Total:');
    });

    it('logs to console', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const timer = new PerfTimer();
      timer.mark('test');
      timer.log('MyTimer');

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[MyTimer]'));
      consoleSpy.mockRestore();
    });
  });
});
