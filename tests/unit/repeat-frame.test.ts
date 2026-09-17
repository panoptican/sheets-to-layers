/**
 * Unit tests for layer repetition (auto-duplication).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createMockFrame,
  createMockText,
  createMockRectangle,
  createMockComponent,
  createMockPage,
  createMockDocument,
  createMockFigma,
  setupMockFigma,
  cleanupMockFigma,
  resetNodeIdCounter,
  type MockFrameNode,
  type MockSceneNode,
} from '../mocks/figma';
import {
  detectRepeatFrame,
  isValidRepeatFrame,
  findFirstLabel,
  planRepeatFrame,
  getValueCountForRepeatFrame,
  processRepeatFrame,
  batchProcessRepeatFrames,
  filterRepeatFrames,
  validateRepeatFrames,
  getRepeatFrameStats,
} from '../../src/core/repeat-frame';
import type { Worksheet } from '../../src/core/types';

describe('Repeat Frame', () => {
  beforeEach(() => {
    resetNodeIdCounter();
    const page = createMockPage('Page 1');
    const doc = createMockDocument([page]);
    const mockFigma = createMockFigma(doc, page);
    setupMockFigma(mockFigma);
  });

  afterEach(() => {
    cleanupMockFigma();
  });

  // Helper to create a test worksheet
  function createTestWorksheet(labels: string[], rows: Record<string, string[]>): Worksheet {
    return {
      name: 'Sheet1',
      labels,
      rows,
      orientation: 'columns',
    };
  }

  // ============================================================================
  // Detection Tests
  // ============================================================================

  describe('detectRepeatFrame', () => {
    it('detects @# syntax in frame name', () => {
      const frame = createMockFrame('Products @#', [], [], { layoutMode: 'VERTICAL' });
      const config = detectRepeatFrame(frame as unknown as SceneNode);

      expect(config.isRepeatFrame).toBe(true);
      expect(config.hasAutoLayout).toBe(true);
    });

    it('detects missing auto-layout', () => {
      const frame = createMockFrame('Products @#', [], [], { layoutMode: 'NONE' });
      const config = detectRepeatFrame(frame as unknown as SceneNode);

      expect(config.isRepeatFrame).toBe(true);
      expect(config.hasAutoLayout).toBe(false);
    });

    it('returns false for non-frame nodes', () => {
      const text = createMockText('Products @#');
      const config = detectRepeatFrame(text as unknown as SceneNode);

      expect(config.isRepeatFrame).toBe(false);
      expect(config.hasAutoLayout).toBe(false);
    });

    it('returns false for frames without @#', () => {
      const frame = createMockFrame('Products', [], [], { layoutMode: 'VERTICAL' });
      const config = detectRepeatFrame(frame as unknown as SceneNode);

      expect(config.isRepeatFrame).toBe(false);
    });

    it('does not treat quoted, escaped, or ignored markers as repetition', () => {
      const names = ['Cards #"literal @#"', 'Cards \\@#', '-Cards @#'];

      for (const name of names) {
        const frame = createMockFrame(name, [], [], { layoutMode: 'VERTICAL' });
        expect(detectRepeatFrame(frame as unknown as SceneNode).isRepeatFrame).toBe(false);
      }
    });

    it('counts current children', () => {
      const child1 = createMockText('#Title');
      const child2 = createMockText('#Title');
      const frame = createMockFrame('Products @#', [child1, child2], [], { layoutMode: 'VERTICAL' });
      const config = detectRepeatFrame(frame as unknown as SceneNode);

      expect(config.currentChildCount).toBe(2);
    });
  });

  describe('isValidRepeatFrame', () => {
    it('returns true for valid repeat frame', () => {
      const frame = createMockFrame('Products @#', [], [], { layoutMode: 'VERTICAL' });
      expect(isValidRepeatFrame(frame as unknown as SceneNode)).toBe(true);
    });

    it('returns false for frame without auto-layout', () => {
      const frame = createMockFrame('Products @#', [], [], { layoutMode: 'NONE' });
      expect(isValidRepeatFrame(frame as unknown as SceneNode)).toBe(false);
    });

    it('returns false for frame without @#', () => {
      const frame = createMockFrame('Products', [], [], { layoutMode: 'VERTICAL' });
      expect(isValidRepeatFrame(frame as unknown as SceneNode)).toBe(false);
    });
  });

  // ============================================================================
  // Label Finding Tests
  // ============================================================================

  describe('findFirstLabel', () => {
    it('finds label in direct child', () => {
      const text = createMockText('#Title');
      const frame = createMockFrame('Row', [text]);

      const label = findFirstLabel(frame);

      expect(label).toBe('Title');
    });

    it('finds label in nested children', () => {
      const text = createMockText('#ProductName');
      const innerFrame = createMockFrame('Inner', [text]);
      const outerFrame = createMockFrame('Outer', [innerFrame]);

      const label = findFirstLabel(outerFrame);

      expect(label).toBe('ProductName');
    });

    it('returns first label when multiple exist', () => {
      const text1 = createMockText('#First');
      const text2 = createMockText('#Second');
      const frame = createMockFrame('Row', [text1, text2]);

      const label = findFirstLabel(frame);

      expect(label).toBe('First');
    });

    it('returns null when no labels found', () => {
      const text = createMockText('No Label');
      const frame = createMockFrame('Row', [text]);

      const label = findFirstLabel(frame);

      expect(label).toBeNull();
    });

    it('returns null for empty frame', () => {
      const frame = createMockFrame('Row');

      const label = findFirstLabel(frame);

      expect(label).toBeNull();
    });

    it('skips ignored subtrees and unforced main components', () => {
      const ignored = createMockFrame('-Ignored', [createMockText('#Other')]);
      const mainComponent = createMockComponent('Main component', [createMockText('#Other')]);
      const eligible = createMockText('#Title');
      const frame = createMockFrame('Row', [ignored, mainComponent, eligible]);

      expect(findFirstLabel(frame)).toBe('Title');
    });

    it('includes explicitly forced main components', () => {
      const component = createMockComponent('+Main component', [createMockText('#Title')]);

      expect(findFirstLabel(component)).toBe('Title');
    });
  });

  // ============================================================================
  // Value Counting Tests
  // ============================================================================

  describe('getValueCountForRepeatFrame', () => {
    it('returns count of values for first label', () => {
      const text = createMockText('#Title');
      const frame = createMockFrame('Row @#', [text], [], { layoutMode: 'VERTICAL' });
      const worksheet = createTestWorksheet(['Title'], {
        Title: ['Product 1', 'Product 2', 'Product 3'],
      });

      const count = getValueCountForRepeatFrame(frame as unknown as FrameNode, worksheet);

      expect(count).toBe(3);
    });

    it('matches labels case-insensitively', () => {
      const text = createMockText('#title');
      const frame = createMockFrame('Row @#', [text], [], { layoutMode: 'VERTICAL' });
      const worksheet = createTestWorksheet(['Title'], {
        Title: ['Product 1', 'Product 2'],
      });

      const count = getValueCountForRepeatFrame(frame as unknown as FrameNode, worksheet);

      expect(count).toBe(2);
    });

    it('returns 0 when no label found', () => {
      const text = createMockText('No Label');
      const frame = createMockFrame('Row @#', [text], [], { layoutMode: 'VERTICAL' });
      const worksheet = createTestWorksheet(['Title'], {
        Title: ['Product 1'],
      });

      const count = getValueCountForRepeatFrame(frame as unknown as FrameNode, worksheet);

      expect(count).toBe(0);
    });

    it('returns 0 when label not in worksheet', () => {
      const text = createMockText('#MissingLabel');
      const frame = createMockFrame('Row @#', [text], [], { layoutMode: 'VERTICAL' });
      const worksheet = createTestWorksheet(['Title'], {
        Title: ['Product 1'],
      });

      const count = getValueCountForRepeatFrame(frame as unknown as FrameNode, worksheet);

      expect(count).toBe(0);
    });
  });

  // ============================================================================
  // Processing Tests
  // ============================================================================

  describe('processRepeatFrame', () => {
    it('uses the first eligible descendant to plan repetition count', () => {
      const ignored = createMockText('-#Other');
      const eligible = createMockText('#Title');
      const frame = createMockFrame('Products @#', [ignored, eligible], [], { layoutMode: 'VERTICAL' });
      const worksheet = createTestWorksheet(['Other', 'Title'], {
        Other: ['Wrong count'],
        Title: ['One', 'Two', 'Three'],
      });

      const plan = planRepeatFrame(frame as unknown as FrameNode, worksheet);

      expect(plan.targetCount).toBe(3);
      expect(plan.additions).toBe(1);
    });

    it('duplicates children to match data count', async () => {
      const template = createMockText('#Title');
      const frame = createMockFrame('Products @#', [template], [], { layoutMode: 'VERTICAL' });
      const worksheet = createTestWorksheet(['Title'], {
        Title: ['Product 1', 'Product 2', 'Product 3'],
      });

      const result = await processRepeatFrame(frame as unknown as FrameNode, worksheet);

      expect(result.success).toBe(true);
      expect(result.childrenAdded).toBe(2);
      expect(result.targetCount).toBe(3);
      expect(frame.children.length).toBe(3);
    });

    it('removes excess children', async () => {
      const child1 = createMockText('#Title');
      const child2 = createMockText('#Title');
      const child3 = createMockText('#Title');
      const frame = createMockFrame('Products @#', [child1, child2, child3], [], { layoutMode: 'VERTICAL' });
      const worksheet = createTestWorksheet(['Title'], {
        Title: ['Product 1'],
      });

      const result = await processRepeatFrame(frame as unknown as FrameNode, worksheet);

      expect(result.success).toBe(true);
      expect(result.childrenRemoved).toBe(2);
      expect(result.targetCount).toBe(1);
      expect(frame.children.length).toBe(1);
    });

    it('preserves template (first child)', async () => {
      const template = createMockText('#Title');
      template.name = 'OriginalTemplate';
      const frame = createMockFrame('Products @#', [template], [], { layoutMode: 'VERTICAL' });
      const worksheet = createTestWorksheet(['Title'], {
        Title: ['Product 1', 'Product 2'],
      });

      await processRepeatFrame(frame as unknown as FrameNode, worksheet);

      // First child should still be the original template
      expect(frame.children[0].name).toBe('OriginalTemplate');
    });

    it('does nothing when count matches', async () => {
      const child1 = createMockText('#Title');
      const child2 = createMockText('#Title');
      const frame = createMockFrame('Products @#', [child1, child2], [], { layoutMode: 'VERTICAL' });
      const worksheet = createTestWorksheet(['Title'], {
        Title: ['Product 1', 'Product 2'],
      });

      const result = await processRepeatFrame(frame as unknown as FrameNode, worksheet);

      expect(result.success).toBe(true);
      expect(result.childrenAdded).toBe(0);
      expect(result.childrenRemoved).toBe(0);
      expect(frame.children.length).toBe(2);
    });

    it('rolls back partial child additions when clone fails mid-operation', async () => {
      const template = createMockText('#Title');
      const frame = createMockFrame('Products @#', [template], [], { layoutMode: 'VERTICAL' });
      const worksheet = createTestWorksheet(['Title'], {
        Title: ['Product 1', 'Product 2', 'Product 3'],
      });

      let cloneAttempts = 0;
      template.clone = () => {
        cloneAttempts++;
        if (cloneAttempts === 2) {
          throw new Error('Clone failed');
        }
        return createMockText('#Title');
      };

      const result = await processRepeatFrame(frame as unknown as FrameNode, worksheet);

      expect(result.success).toBe(false);
      expect(result.error?.error).toContain('Clone failed');
      expect(frame.children.length).toBe(1);
      expect(result.childrenAdded).toBe(0);
    });

    it('processes a queued cancellation during cloning and rolls back all additions', async () => {
      const template = createMockText('#Title');
      const frame = createMockFrame('Products @#', [template], [], { layoutMode: 'VERTICAL' });
      const worksheet = createTestWorksheet(['Title'], {
        Title: Array.from({ length: 121 }, (_, i) => `Product ${i}`),
      });
      const signal = { aborted: false };
      let cloneAttempts = 0;
      const clone = template.clone;
      template.clone = () => {
        cloneAttempts++;
        return clone();
      };
      setTimeout(() => { signal.aborted = true; }, 0);

      const result = await processRepeatFrame(frame as unknown as FrameNode, worksheet, signal);

      expect(signal.aborted).toBe(true);
      expect(cloneAttempts).toBeGreaterThan(0);
      expect(cloneAttempts).toBeLessThan(120);
      expect(result.success).toBe(false);
      expect(result.error?.error).toContain('cancelled');
      expect(result.childrenAdded).toBe(0);
      expect(frame.children).toEqual([template]);
    });

    it('reports actual partial removals when a later remove fails', async () => {
      const child1 = createMockText('#Title');
      const child2 = createMockText('#Title');
      const child3 = createMockText('#Title');
      const frame = createMockFrame('Products @#', [child1, child2, child3], [], { layoutMode: 'VERTICAL' });
      const worksheet = createTestWorksheet(['Title'], {
        Title: ['Only One'],
      });

      let removeCalls = 0;
      child2.remove = () => {
        removeCalls++;
        if (removeCalls >= 1) {
          throw new Error('Remove failed');
        }
      };

      const result = await processRepeatFrame(frame as unknown as FrameNode, worksheet);

      expect(result.success).toBe(false);
      expect(result.error?.error).toContain('Remove failed');
      expect(frame.children.length).toBe(2);
      expect(result.childrenRemoved).toBe(1);
    });

    it('processes a queued cancellation during removal and reports irreversible edits', async () => {
      const children = Array.from({ length: 121 }, () => createMockText('#Title'));
      const frame = createMockFrame('Products @#', children, [], { layoutMode: 'VERTICAL' });
      const originalCount = frame.children.length;
      const worksheet = createTestWorksheet(['Title'], { Title: ['Only one'] });
      const signal = { aborted: false };
      setTimeout(() => { signal.aborted = true; }, 0);

      const result = await processRepeatFrame(frame as unknown as FrameNode, worksheet, signal);

      expect(signal.aborted).toBe(true);
      expect(result.success).toBe(false);
      expect(result.error?.error).toContain('cancelled');
      expect(result.childrenRemoved).toBeGreaterThan(0);
      expect(result.childrenRemoved).toBeLessThan(120);
      expect(frame.children.length).toBe(originalCount - result.childrenRemoved);
      expect(frame.children[0]).toBe(children[0]);
    });

    it('fails gracefully for frame without auto-layout', async () => {
      const template = createMockText('#Title');
      const frame = createMockFrame('Products @#', [template], [], { layoutMode: 'NONE' });
      const worksheet = createTestWorksheet(['Title'], {
        Title: ['Product 1', 'Product 2'],
      });

      const result = await processRepeatFrame(frame as unknown as FrameNode, worksheet);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.error).toContain('Auto-layout');
      expect(frame.children.length).toBe(1); // Unchanged
    });

    it('warns for empty frame', async () => {
      const frame = createMockFrame('Products @#', [], [], { layoutMode: 'VERTICAL' });
      const worksheet = createTestWorksheet(['Title'], {
        Title: ['Product 1'],
      });

      const result = await processRepeatFrame(frame as unknown as FrameNode, worksheet);

      expect(result.success).toBe(false);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('template child');
    });

    it('warns when no values found', async () => {
      const template = createMockText('#MissingLabel');
      const frame = createMockFrame('Products @#', [template], [], { layoutMode: 'VERTICAL' });
      const worksheet = createTestWorksheet(['Title'], {
        Title: ['Product 1'],
      });

      const result = await processRepeatFrame(frame as unknown as FrameNode, worksheet);

      expect(result.success).toBe(false);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('unavailable');
    });

    it('does nothing for non-repeat frames', async () => {
      const template = createMockText('#Title');
      const frame = createMockFrame('Products', [template], [], { layoutMode: 'VERTICAL' });
      const worksheet = createTestWorksheet(['Title'], {
        Title: ['Product 1', 'Product 2'],
      });

      const result = await processRepeatFrame(frame as unknown as FrameNode, worksheet);

      expect(result.success).toBe(true);
      expect(result.childrenAdded).toBe(0);
      expect(frame.children.length).toBe(1); // Unchanged
    });

    it('clones nested structures', async () => {
      const innerText = createMockText('#Title');
      const innerFrame = createMockFrame('Inner', [innerText]);
      const frame = createMockFrame('Products @#', [innerFrame], [], { layoutMode: 'VERTICAL' });
      const worksheet = createTestWorksheet(['Title'], {
        Title: ['Product 1', 'Product 2'],
      });

      await processRepeatFrame(frame as unknown as FrameNode, worksheet);

      expect(frame.children.length).toBe(2);
      // Both children should be frames with nested text
      expect(frame.children[0].type).toBe('FRAME');
      expect(frame.children[1].type).toBe('FRAME');
      expect((frame.children[1] as MockFrameNode).children.length).toBe(1);
    });
  });

  // ============================================================================
  // Batch Processing Tests
  // ============================================================================

  describe('batchProcessRepeatFrames', () => {
    it('processes multiple frames', async () => {
      const template1 = createMockText('#Title');
      const frame1 = createMockFrame('Products @#', [template1], [], { layoutMode: 'VERTICAL' });
      const template2 = createMockText('#Name');
      const frame2 = createMockFrame('Users @#', [template2], [], { layoutMode: 'HORIZONTAL' });
      const worksheet = createTestWorksheet(['Title', 'Name'], {
        Title: ['Product 1', 'Product 2'],
        Name: ['User 1', 'User 2', 'User 3'],
      });

      const result = await batchProcessRepeatFrames(
        [frame1 as unknown as FrameNode, frame2 as unknown as FrameNode],
        worksheet
      );

      expect(result.totalProcessed).toBe(2);
      expect(result.successCount).toBe(2);
      expect(result.failureCount).toBe(0);
      expect(result.totalChildrenAdded).toBe(3); // 1 + 2
      expect(frame1.children.length).toBe(2);
      expect(frame2.children.length).toBe(3);
    });

    it('continues after individual failures', async () => {
      const template1 = createMockText('#Title');
      const frame1 = createMockFrame('Products @#', [template1], [], { layoutMode: 'NONE' }); // Will fail
      const template2 = createMockText('#Name');
      const frame2 = createMockFrame('Users @#', [template2], [], { layoutMode: 'VERTICAL' }); // Will succeed
      const worksheet = createTestWorksheet(['Title', 'Name'], {
        Title: ['Product 1', 'Product 2'],
        Name: ['User 1', 'User 2'],
      });

      const result = await batchProcessRepeatFrames(
        [frame1 as unknown as FrameNode, frame2 as unknown as FrameNode],
        worksheet
      );

      expect(result.totalProcessed).toBe(2);
      expect(result.successCount).toBe(1);
      expect(result.failureCount).toBe(1);
      expect(result.errors.length).toBe(1);
      expect(frame2.children.length).toBe(2); // frame2 was processed
    });

    it('includes irreversible partial removals in batch totals', async () => {
      const children = Array.from({ length: 3 }, () => createMockText('#Title'));
      const frame = createMockFrame('Products @#', children, [], { layoutMode: 'VERTICAL' });
      const worksheet = createTestWorksheet(['Title'], { Title: ['Only one'] });
      children[1].remove = () => { throw new Error('Remove failed'); };

      const result = await batchProcessRepeatFrames([frame as unknown as FrameNode], worksheet);

      expect(result.failureCount).toBe(1);
      expect(result.totalChildrenRemoved).toBe(1);
      expect(frame.children.length).toBe(2);
    });

    it('handles empty batch', async () => {
      const worksheet = createTestWorksheet(['Title'], { Title: ['Product 1'] });

      const result = await batchProcessRepeatFrames([], worksheet);

      expect(result.totalProcessed).toBe(0);
      expect(result.successCount).toBe(0);
    });
  });

  // ============================================================================
  // Utility Tests
  // ============================================================================

  describe('filterRepeatFrames', () => {
    it('filters to only repeat frames', () => {
      const frame1 = createMockFrame('Products @#', [], [], { layoutMode: 'VERTICAL' });
      const frame2 = createMockFrame('Regular', [], [], { layoutMode: 'VERTICAL' });
      const frame3 = createMockFrame('Users @#', [], [], { layoutMode: 'HORIZONTAL' });
      const text = createMockText('#Title');

      const repeatFrames = filterRepeatFrames([
        frame1 as unknown as SceneNode,
        frame2 as unknown as SceneNode,
        frame3 as unknown as SceneNode,
        text as unknown as SceneNode,
      ]);

      expect(repeatFrames.length).toBe(2);
      expect(repeatFrames[0].name).toBe('Products @#');
      expect(repeatFrames[1].name).toBe('Users @#');
    });

    it('excludes frames with quoted repeat markers', () => {
      const frame = createMockFrame('Cards #"literal @#"', [], [], { layoutMode: 'VERTICAL' });

      expect(filterRepeatFrames([frame as unknown as SceneNode])).toEqual([]);
    });
  });

  describe('validateRepeatFrames', () => {
    it('warns for frames without auto-layout', () => {
      // Frame has no auto-layout but has a child (so only 1 warning)
      const child = createMockText('#Title');
      const frame = createMockFrame('Products @#', [child], [], { layoutMode: 'NONE' });

      const warnings = validateRepeatFrames([frame as unknown as FrameNode]);

      expect(warnings.length).toBe(1);
      expect(warnings[0]).toContain('no auto-layout');
    });

    it('warns for frames without children', () => {
      const frame = createMockFrame('Products @#', [], [], { layoutMode: 'VERTICAL' });

      const warnings = validateRepeatFrames([frame as unknown as FrameNode]);

      expect(warnings.length).toBe(1);
      expect(warnings[0]).toContain('no children');
    });

    it('returns no warnings for valid frames', () => {
      const child = createMockText('#Title');
      const frame = createMockFrame('Products @#', [child], [], { layoutMode: 'VERTICAL' });

      const warnings = validateRepeatFrames([frame as unknown as FrameNode]);

      expect(warnings.length).toBe(0);
    });
  });

  describe('getRepeatFrameStats', () => {
    it('returns correct statistics', () => {
      const validFrame = createMockFrame('Products @#', [createMockText('#T')], [], { layoutMode: 'VERTICAL' });
      const noAutoLayout = createMockFrame('Users @#', [], [], { layoutMode: 'NONE' });
      const noChildren = createMockFrame('Items @#', [], [], { layoutMode: 'VERTICAL' });
      const regularFrame = createMockFrame('Regular', [], [], { layoutMode: 'VERTICAL' });

      const stats = getRepeatFrameStats([
        validFrame as unknown as SceneNode,
        noAutoLayout as unknown as SceneNode,
        noChildren as unknown as SceneNode,
        regularFrame as unknown as SceneNode,
      ]);

      expect(stats.total).toBe(3);
      expect(stats.valid).toBe(1);
      expect(stats.missingAutoLayout).toBe(1);
      expect(stats.missingChildren).toBe(1);
    });
  });
});
