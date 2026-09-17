import { describe, expect, it } from 'vitest';
import {
  groupOutcomes, outcomeCountsText, repeatSummaryText, summarizeRepeats, unrepresentedErrors,
} from '../../src/core/result-summary';
import type { LayerOutcome, RepeatChange } from '../../src/core/types';

function repeat(overrides: Partial<RepeatChange> & { layerId: string }): RepeatChange {
  return {
    layerName: 'Cards @#', worksheet: 'Products', currentCount: 3, targetCount: 240,
    additions: 237, removals: 0, removeIds: [], parentName: 'Products // Products',
    ...overrides,
  };
}

function outcome(overrides: Partial<LayerOutcome> & { bindingId: string }): LayerOutcome {
  return { layerId: overrides.bindingId, layerName: 'Title #Title', status: 'changed', ...overrides };
}

describe('summarizeRepeats', () => {
  it('folds identical repeat frames into one line', () => {
    const lines = summarizeRepeats(Array.from({ length: 18 }, (_, i) => repeat({ layerId: `cards-${i}` })));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ name: 'Cards', frames: 18, additions: 237 });
    expect(lines[0].parentName).toBeUndefined();
    expect(lines[0].layerIds).toHaveLength(18);
    expect(repeatSummaryText(lines[0])).toBe('Cards will add 237 repeated items in each of 18 frames.');
  });

  it('keeps the original wording for a single frame', () => {
    const [line] = summarizeRepeats([repeat({ layerId: 'a', additions: 0, removals: 1, removeIds: ['x'] })]);
    expect(repeatSummaryText(line)).toBe('Cards will remove 1 repeated item.');
  });

  it('drops frames with nothing to add or remove', () => {
    expect(summarizeRepeats([repeat({ layerId: 'a', additions: 0, removals: 0 })])).toEqual([]);
  });

  it('names the parent only when same-named frames differ', () => {
    const lines = summarizeRepeats([
      repeat({ layerId: 'a', parentName: 'Section A' }),
      repeat({ layerId: 'b', parentName: 'Section B', additions: 4 }),
      repeat({ layerId: 'c', layerName: 'Rows @#', parentName: 'Section A', additions: 2 }),
    ]);
    expect(lines.map(repeatSummaryText)).toEqual([
      'Cards in Section A will add 237 repeated items.',
      'Cards in Section B will add 4 repeated items.',
      'Rows will add 2 repeated items.',
    ]);
  });

  it('separates same-named frames under different parents even with equal counts', () => {
    const lines = summarizeRepeats([
      repeat({ layerId: 'a', parentName: 'Section A' }),
      repeat({ layerId: 'b', parentName: 'Section A' }),
      repeat({ layerId: 'c', parentName: 'Section B' }),
    ]);
    expect(lines.map(repeatSummaryText)).toEqual([
      'Cards in Section A will add 237 repeated items in each of 2 frames.',
      'Cards in Section B will add 237 repeated items.',
    ]);
  });
});

describe('groupOutcomes', () => {
  it('groups by layer name with per-status counts and puts attention first', () => {
    const groups = groupOutcomes([
      outcome({ bindingId: 't1' }),
      outcome({ bindingId: 'i1', layerName: 'Photo #Image', status: 'unchanged' }),
      outcome({ bindingId: 't2', status: 'unchanged' }),
      outcome({ bindingId: 'i2', layerName: 'Photo #Image', status: 'failed', message: 'Timed out' }),
      outcome({ bindingId: 'c1', layerName: 'Cards @#', message: 'Added 237, removed 0 repeat child(ren).' }),
    ]);
    expect(groups.map((group) => group.name)).toEqual(['Photo #Image', 'Title #Title', 'Cards @#']);
    expect(groups[0]).toMatchObject({ status: 'failed', counts: { changed: 0, unchanged: 1, skipped: 0, failed: 1 } });
    expect(groups[1]).toMatchObject({ status: 'changed', counts: { changed: 1, unchanged: 1, skipped: 0, failed: 0 } });
    expect(groups[1].outcomes.map((entry) => entry.bindingId)).toEqual(['t1', 't2']);
  });

  it('moves failed and skipped rows to the front of a group, keeping execution order within a status', () => {
    const many = Array.from({ length: 450 }, (_, index) => outcome({ bindingId: `t${index}` }));
    const groups = groupOutcomes([
      ...many,
      outcome({ bindingId: 'late-skip', status: 'skipped' }),
      outcome({ bindingId: 'late-fail', status: 'failed', message: 'Font missing' }),
      outcome({ bindingId: 'later-fail', status: 'failed' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].outcomes.slice(0, 3).map((entry) => entry.bindingId)).toEqual(['late-fail', 'later-fail', 'late-skip']);
    expect(groups[0].outcomes.slice(3, 6).map((entry) => entry.bindingId)).toEqual(['t0', 't1', 't2']);
    expect(groups[0].outcomes).toHaveLength(453);
  });

  it('formats counts without zero entries', () => {
    expect(outcomeCountsText({ changed: 2844, unchanged: 1422, skipped: 0, failed: 0 })).toBe('2844 changed, 1422 unchanged');
    expect(outcomeCountsText({ changed: 0, unchanged: 0, skipped: 1, failed: 3 })).toBe('3 failed, 1 skipped');
  });
});

describe('unrepresentedErrors', () => {
  it('keeps fatal errors and drops errors already shown as failed outcomes', () => {
    const errors = unrepresentedErrors({
      errors: [
        { layerId: '', layerName: '', error: 'Document changed during apply.' },
        { layerId: 'a', layerName: 'Title #Title', error: 'Font missing' },
        { layerId: 'orphan', layerName: 'Ghost', error: 'No outcome recorded' },
      ],
      outcomes: [
        outcome({ bindingId: 'a', status: 'failed', message: 'Font missing' }),
        outcome({ bindingId: 'b' }),
      ],
    });
    expect(errors.map((error) => error.error)).toEqual(['Document changed during apply.', 'No outcome recorded']);
  });
});
