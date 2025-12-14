/**
 * Tests for the sync engine orchestration logic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SheetData, Worksheet, SyncScope } from '../../src/core/types';

// Mock the dependencies before importing sync-engine
vi.mock('../../src/core/traversal', () => ({
  traverseLayers: vi.fn(),
  singlePassTraversal: vi.fn(),
}));

vi.mock('../../src/core/performance', () => ({
  loadFontsForLayers: vi.fn().mockResolvedValue({ loaded: new Set(), failed: new Set() }),
  processInChunks: vi.fn().mockImplementation((items, fn) => Promise.all(items.map(fn))),
  yieldToUI: vi.fn().mockResolvedValue(undefined),
  PerfTimer: vi.fn().mockImplementation(() => ({
    mark: vi.fn(),
    elapsed: vi.fn().mockReturnValue(100),
    report: vi.fn().mockReturnValue('Timer report'),
    log: vi.fn(),
  })),
}));

vi.mock('../../src/core/component-swap', () => ({
  buildComponentCache: vi.fn().mockReturnValue({ components: new Map() }),
  swapComponent: vi.fn().mockReturnValue({ success: true, componentChanged: false }),
}));

vi.mock('../../src/core/repeat-frame', () => ({
  processRepeatFrame: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('../../src/core/text-sync', () => ({
  syncTextLayer: vi.fn().mockResolvedValue({ success: true, contentChanged: true }),
}));

vi.mock('../../src/core/image-sync', () => ({
  isImageUrl: vi.fn().mockReturnValue(false),
  canHaveImageFill: vi.fn().mockReturnValue(false),
  convertToDirectUrl: vi.fn().mockImplementation((url) => url),
}));

vi.mock('../../src/core/special-types', () => ({
  parseChainedSpecialTypes: vi.fn().mockReturnValue({}),
  applyChainedSpecialTypes: vi.fn().mockResolvedValue(undefined),
  hasAnyParsedType: vi.fn().mockReturnValue(false),
}));

// Import after mocks are set up
import { runSync, runTargetedSync, applyFetchedImage } from '../../src/core/sync-engine';
import { singlePassTraversal } from '../../src/core/traversal';
import { loadFontsForLayers } from '../../src/core/performance';
import { syncTextLayer } from '../../src/core/text-sync';
import { swapComponent } from '../../src/core/component-swap';
import { processRepeatFrame } from '../../src/core/repeat-frame';
import { isImageUrl, canHaveImageFill } from '../../src/core/image-sync';
import { parseChainedSpecialTypes, hasAnyParsedType } from '../../src/core/special-types';

// Mock Figma API
const mockFigma = {
  getNodeByIdAsync: vi.fn(),
  createImage: vi.fn().mockReturnValue({ hash: 'mock-hash' }),
};
(global as Record<string, unknown>).figma = mockFigma;

// Helper to create mock sheet data
function createMockSheetData(worksheets: Partial<Worksheet>[] = [{ name: 'Sheet1' }]): SheetData {
  return {
    worksheets: worksheets.map((ws) => ({
      name: ws.name || 'Sheet1',
      rows: ws.rows || {
        Title: ['Hello', 'World'],
        Description: ['Desc 1', 'Desc 2'],
      },
      orientation: ws.orientation || 'columns',
    })),
    activeWorksheet: worksheets[0]?.name || 'Sheet1',
  };
}

// Helper to create mock traversal result
function createMockTraversalResult(layerCount: number = 0, repeatFrameCount: number = 0) {
  const layers = Array.from({ length: layerCount }, (_, i) => ({
    node: {
      id: `layer-${i}`,
      name: `#Title Layer ${i}`,
      type: 'TEXT' as const,
    },
    resolvedBinding: {
      hasBinding: true,
      labels: ['Title'],
      isIgnored: false,
      forceInclude: false,
      isRepeatFrame: false,
      index: { type: 'increment' as const },
    },
    depth: 0,
  }));

  const repeatFrames = Array.from({ length: repeatFrameCount }, (_, i) => ({
    id: `repeat-${i}`,
    name: `@# Repeat ${i}`,
    type: 'FRAME' as const,
    layoutMode: 'VERTICAL',
    children: [],
  }));

  return {
    layers,
    repeatFrames,
    componentCache: { components: new Map() },
    layersExamined: layerCount + repeatFrameCount,
    layersIgnored: 0,
    componentsSkipped: 0,
  };
}

describe('sync-engine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('runSync', () => {
    it('returns success with no layers found', async () => {
      vi.mocked(singlePassTraversal).mockResolvedValueOnce(createMockTraversalResult(0, 0));

      const result = await runSync({
        sheetData: createMockSheetData(),
        scope: 'page',
      });

      expect(result.success).toBe(true);
      expect(result.layersProcessed).toBe(0);
      expect(result.warnings).toContain('No layers with bindings found in the selected scope');
    });

    it('processes text layers successfully', async () => {
      vi.mocked(singlePassTraversal).mockResolvedValueOnce(createMockTraversalResult(3, 0));
      vi.mocked(syncTextLayer).mockResolvedValue({ success: true, contentChanged: true });

      const progressCalls: Array<{ message: string; percent: number }> = [];
      const result = await runSync({
        sheetData: createMockSheetData(),
        scope: 'page',
        onProgress: (message, percent) => progressCalls.push({ message, percent }),
      });

      expect(result.success).toBe(true);
      expect(result.layersProcessed).toBe(3);
      expect(result.layersUpdated).toBe(3);
      expect(syncTextLayer).toHaveBeenCalledTimes(3);
    });

    it('calls progress callback during sync', async () => {
      vi.mocked(singlePassTraversal).mockResolvedValueOnce(createMockTraversalResult(2, 0));

      const progressCalls: Array<{ message: string; percent: number }> = [];
      await runSync({
        sheetData: createMockSheetData(),
        scope: 'page',
        onProgress: (message, percent) => progressCalls.push({ message, percent }),
      });

      expect(progressCalls.length).toBeGreaterThan(0);
      expect(progressCalls.some((p) => p.message.includes('Scanning'))).toBe(true);
      expect(progressCalls.some((p) => p.message.includes('Complete'))).toBe(true);
    });

    it('processes repeat frames before layers', async () => {
      const traversalWithRepeat = createMockTraversalResult(2, 1);
      vi.mocked(singlePassTraversal)
        .mockResolvedValueOnce(traversalWithRepeat)
        .mockResolvedValueOnce(createMockTraversalResult(4, 0)); // After repeat processing

      await runSync({
        sheetData: createMockSheetData(),
        scope: 'page',
      });

      expect(processRepeatFrame).toHaveBeenCalledTimes(1);
      // Should have two traversals: initial and after repeat frame processing
      expect(singlePassTraversal).toHaveBeenCalledTimes(2);
    });

    it('handles font loading failures gracefully', async () => {
      vi.mocked(singlePassTraversal).mockResolvedValueOnce(createMockTraversalResult(1, 0));
      vi.mocked(loadFontsForLayers).mockResolvedValueOnce({
        loaded: new Set(['Inter::Regular']),
        failed: new Set(['Missing::Font', 'Another::Missing']),
      });

      const result = await runSync({
        sheetData: createMockSheetData(),
        scope: 'page',
      });

      expect(result.success).toBe(true);
      expect(result.warnings.some((w) => w.includes('Failed to load 2 fonts'))).toBe(true);
    });

    it('handles layers without matching label', async () => {
      const traversalResult = createMockTraversalResult(1, 0);
      traversalResult.layers[0].resolvedBinding.labels = ['NonExistent'];
      vi.mocked(singlePassTraversal).mockResolvedValueOnce(traversalResult);

      const result = await runSync({
        sheetData: createMockSheetData(),
        scope: 'page',
      });

      expect(result.success).toBe(true);
      expect(result.layersProcessed).toBe(1);
      expect(result.layersUpdated).toBe(0); // No matching label
      expect(syncTextLayer).not.toHaveBeenCalled();
    });

    it('tracks processed layer IDs', async () => {
      vi.mocked(singlePassTraversal).mockResolvedValueOnce(createMockTraversalResult(2, 0));
      vi.mocked(syncTextLayer).mockResolvedValue({ success: true, contentChanged: true });

      const result = await runSync({
        sheetData: createMockSheetData(),
        scope: 'page',
      });

      expect(result.processedLayerIds).toEqual(['layer-0', 'layer-1']);
    });

    it('handles sync with different scopes', async () => {
      vi.mocked(singlePassTraversal).mockResolvedValue(createMockTraversalResult(1, 0));

      const scopes: SyncScope[] = ['document', 'page', 'selection'];

      for (const scope of scopes) {
        await runSync({
          sheetData: createMockSheetData(),
          scope,
        });
      }

      expect(singlePassTraversal).toHaveBeenCalledTimes(3);
      expect(singlePassTraversal).toHaveBeenCalledWith({ scope: 'document' });
      expect(singlePassTraversal).toHaveBeenCalledWith({ scope: 'page' });
      expect(singlePassTraversal).toHaveBeenCalledWith({ scope: 'selection' });
    });

    it('handles instance nodes with component swap', async () => {
      const traversalResult = createMockTraversalResult(1, 0);
      traversalResult.layers[0].node = {
        id: 'instance-1',
        name: '#ComponentName',
        type: 'INSTANCE' as const,
      } as unknown as SceneNode;
      vi.mocked(singlePassTraversal).mockResolvedValueOnce(traversalResult);
      vi.mocked(swapComponent).mockReturnValueOnce({ success: true, componentChanged: true });

      const result = await runSync({
        sheetData: createMockSheetData(),
        scope: 'page',
      });

      expect(result.success).toBe(true);
      expect(swapComponent).toHaveBeenCalled();
    });

    it('handles image URLs by queuing for UI fetch', async () => {
      const traversalResult = createMockTraversalResult(1, 0);
      traversalResult.layers[0].node = {
        id: 'frame-1',
        name: '#Image',
        type: 'FRAME' as const,
      } as unknown as SceneNode;
      traversalResult.layers[0].resolvedBinding.labels = ['Image'];
      vi.mocked(singlePassTraversal).mockResolvedValueOnce(traversalResult);
      vi.mocked(isImageUrl).mockReturnValueOnce(true);
      vi.mocked(canHaveImageFill).mockReturnValueOnce(true);

      const sheetData = createMockSheetData([
        {
          name: 'Sheet1',
          rows: { Image: ['https://example.com/image.png'] },
        },
      ]);

      const result = await runSync({
        sheetData,
        scope: 'page',
      });

      expect(result.pendingImages.length).toBe(1);
      expect(result.pendingImages[0].url).toBe('https://example.com/image.png');
      expect(result.pendingImages[0].nodeId).toBe('frame-1');
    });

    it('handles special data types with / prefix', async () => {
      const traversalResult = createMockTraversalResult(1, 0);
      vi.mocked(singlePassTraversal).mockResolvedValueOnce(traversalResult);
      vi.mocked(hasAnyParsedType).mockReturnValueOnce(true);

      const sheetData = createMockSheetData([
        {
          name: 'Sheet1',
          rows: { Title: ['/50%'] }, // Opacity value
        },
      ]);

      const result = await runSync({
        sheetData,
        scope: 'page',
      });

      expect(result.success).toBe(true);
      expect(parseChainedSpecialTypes).toHaveBeenCalled();
    });

    it('captures errors in result when layers fail', async () => {
      vi.mocked(singlePassTraversal).mockResolvedValueOnce(createMockTraversalResult(2, 0));
      vi.mocked(syncTextLayer)
        .mockResolvedValueOnce({ success: true, contentChanged: true })
        .mockRejectedValueOnce(new Error('Font not available'));

      const result = await runSync({
        sheetData: createMockSheetData(),
        scope: 'page',
      });

      // At least one layer was updated before the error
      expect(result.layersUpdated).toBeGreaterThanOrEqual(1);
      // Should have captured the error
      expect(result.errors.length).toBeGreaterThanOrEqual(1);
    });

    it('handles worksheet not found by not updating the layer', async () => {
      const traversalResult = createMockTraversalResult(1, 0);
      traversalResult.layers[0].resolvedBinding.worksheet = 'NonExistent';
      vi.mocked(singlePassTraversal).mockResolvedValueOnce(traversalResult);

      const result = await runSync({
        sheetData: createMockSheetData(),
        scope: 'page',
      });

      // Either has an error or the layer wasn't updated due to worksheet not found
      expect(result.errors.length + (result.layersProcessed - result.layersUpdated)).toBeGreaterThanOrEqual(1);
    });
  });

  describe('runTargetedSync', () => {
    beforeEach(() => {
      mockFigma.getNodeByIdAsync.mockImplementation((id: string) =>
        Promise.resolve({
          id,
          name: '#Title',
          type: 'TEXT',
        })
      );
    });

    it('returns warning when no layer IDs provided', async () => {
      const result = await runTargetedSync({
        sheetData: createMockSheetData(),
        layerIds: [],
      });

      expect(result.success).toBe(true);
      expect(result.warnings).toContain('No layer IDs provided for targeted sync');
    });

    it('processes layers by ID without full traversal', async () => {
      const result = await runTargetedSync({
        sheetData: createMockSheetData(),
        layerIds: ['node-1', 'node-2'],
      });

      expect(result.success).toBe(true);
      expect(mockFigma.getNodeByIdAsync).toHaveBeenCalledTimes(2);
      expect(singlePassTraversal).not.toHaveBeenCalled(); // No full traversal
    });

    it('handles missing nodes gracefully', async () => {
      mockFigma.getNodeByIdAsync
        .mockResolvedValueOnce({ id: 'node-1', name: '#Title', type: 'TEXT' })
        .mockResolvedValueOnce(null); // Missing node

      const result = await runTargetedSync({
        sheetData: createMockSheetData(),
        layerIds: ['node-1', 'node-2'],
      });

      expect(result.success).toBe(true);
      // Should only process the found node
    });

    it('skips document and page nodes', async () => {
      mockFigma.getNodeByIdAsync
        .mockResolvedValueOnce({ id: 'doc', name: 'Document', type: 'DOCUMENT' })
        .mockResolvedValueOnce({ id: 'page', name: 'Page', type: 'PAGE' })
        .mockResolvedValueOnce({ id: 'text', name: '#Title', type: 'TEXT' });

      const result = await runTargetedSync({
        sheetData: createMockSheetData(),
        layerIds: ['doc', 'page', 'text'],
      });

      // Should only process the text node
      expect(syncTextLayer).toHaveBeenCalledTimes(1);
    });

    it('reports progress during targeted sync', async () => {
      const progressCalls: Array<{ message: string; percent: number }> = [];

      await runTargetedSync({
        sheetData: createMockSheetData(),
        layerIds: ['node-1'],
        onProgress: (message, percent) => progressCalls.push({ message, percent }),
      });

      expect(progressCalls.length).toBeGreaterThan(0);
      expect(progressCalls.some((p) => p.message.includes('Fetching'))).toBe(true);
    });

    it('handles layers without bindings', async () => {
      mockFigma.getNodeByIdAsync.mockResolvedValueOnce({
        id: 'node-1',
        name: 'Plain Layer', // No # binding
        type: 'TEXT',
      });

      const result = await runTargetedSync({
        sheetData: createMockSheetData(),
        layerIds: ['node-1'],
      });

      expect(result.layersProcessed).toBe(1);
      expect(result.layersUpdated).toBe(0);
      expect(syncTextLayer).not.toHaveBeenCalled();
    });
  });

  describe('applyFetchedImage', () => {
    it('applies image to valid node', async () => {
      const mockNode = {
        id: 'frame-1',
        type: 'FRAME',
        fills: [],
      };
      mockFigma.getNodeByIdAsync.mockResolvedValueOnce(mockNode);
      vi.mocked(canHaveImageFill).mockReturnValueOnce(true);

      const imageData = new Uint8Array([1, 2, 3, 4, 5]);
      const result = await applyFetchedImage('frame-1', imageData);

      expect(result).toBe(true);
      expect(mockFigma.createImage).toHaveBeenCalledWith(imageData);
      expect(mockNode.fills).toEqual([
        {
          type: 'IMAGE',
          imageHash: 'mock-hash',
          scaleMode: 'FILL',
        },
      ]);
    });

    it('returns false for non-existent node', async () => {
      mockFigma.getNodeByIdAsync.mockResolvedValueOnce(null);

      const result = await applyFetchedImage('missing', new Uint8Array([1, 2, 3]));

      expect(result).toBe(false);
    });

    it('returns false for node that cannot have image fill', async () => {
      mockFigma.getNodeByIdAsync.mockResolvedValueOnce({
        id: 'text-1',
        type: 'TEXT',
      });
      vi.mocked(canHaveImageFill).mockReturnValueOnce(false);

      const result = await applyFetchedImage('text-1', new Uint8Array([1, 2, 3]));

      expect(result).toBe(false);
    });

    it('handles image creation error', async () => {
      const mockNode = {
        id: 'frame-1',
        type: 'FRAME',
        fills: [],
      };
      mockFigma.getNodeByIdAsync.mockResolvedValueOnce(mockNode);
      vi.mocked(canHaveImageFill).mockReturnValueOnce(true);
      mockFigma.createImage.mockImplementationOnce(() => {
        throw new Error('Invalid image data');
      });

      const result = await applyFetchedImage('frame-1', new Uint8Array([1, 2, 3]));

      expect(result).toBe(false);
    });
  });
});
