import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyPreparedSync, prepareSync } from '../../src/core/sync-engine';
import { captureScopeRoots } from '../../src/core/traversal';
import type { InterpretationPreferences, Worksheet } from '../../src/core/types';
import {
  cleanupMockFigma, createMockComponent, createMockDocument, createMockFigma,
  createMockFrame, createMockInstance, createMockPage, createMockText,
  resetNodeIdCounter, setupMockFigma, type MockFrameNode, type MockSceneNode,
} from '../mocks/figma';

const preferences: InterpretationPreferences = { orientations: {}, blankText: 'clear-and-hide' };
function sheet(values: string[], name = 'Sheet1'): Worksheet {
  return { name, labels: ['Title'], rows: { Title: values }, orientation: 'columns' };
}
function repeat(name: string, children: MockSceneNode[]): MockFrameNode {
  return createMockFrame(name, children, [], { layoutMode: 'VERTICAL' });
}
function setup(children: MockSceneNode[]): void {
  const page = createMockPage('Page', children);
  setupMockFigma(createMockFigma(createMockDocument([page]), page));
}
async function prepare(worksheets = [sheet(['A', 'B'])]) {
  return prepareSync({
    preferences, roots: captureScopeRoots('page'),
    snapshot: {
      id: 'snapshot', spreadsheetId: 'test', fetchedAt: 1, preferences,
      sourceUrl: 'https://docs.google.com/spreadsheets/d/test/edit',
      data: { activeWorksheet: worksheets[0].name, worksheets },
    },
  });
}
function textChildren(frame: MockFrameNode): string[] {
  return frame.children.map((child) => (child as ReturnType<typeof createMockText>).characters);
}

describe('executable repeat plans', () => {
  beforeEach(() => resetNodeIdCounter());
  afterEach(() => { cleanupMockFigma(); vi.restoreAllMocks(); });

  it.each([0, 1, 40])('performs one unrelated component lookup with %i sibling repeats', async (count) => {
    const source = createMockComponent('Source');
    const unrelated = createMockInstance('Unbound', source);
    const lookup = vi.spyOn(unrelated, 'getMainComponentAsync');
    const frames = Array.from({ length: count }, (_, index) =>
      repeat(`Cards ${index} @#`, [createMockText('#Title.1', 'A')]));
    setup([source, unrelated, ...frames]);
    const plan = await prepare([sheet(['A'])]);
    lookup.mockClear();
    const applied = await applyPreparedSync(plan, []);
    expect(applied.outcomes.filter((entry) => entry.status === 'failed')).toEqual([]);
    expect(lookup).toHaveBeenCalledTimes(1); // The single pre-Apply freshness check.
    expect(frames.every((frame) => frame.children.length === 1)).toBe(true);
  });

  it('uses captured counts and values for sibling growth, shrink, and no-op', async () => {
    const frames = [1, 3, 2].map((count) => repeat('Cards @#',
      Array.from({ length: count }, () => createMockText('#Title.1', 'old'))));
    setup(frames);
    const worksheet = sheet(['A', 'B']);
    const removed = frames[1].children[2];
    const plan = await prepare([worksheet]);
    expect(plan.summary.repeats.map(({ additions, removals }) => [additions, removals]))
      .toEqual([[1, 0], [0, 1], [0, 0]]);
    expect(Object.isFrozen(plan.repeats)).toBe(true);
    expect(plan.repeats.every((entry) => Object.isFrozen(entry.plan) &&
      Object.isFrozen(entry.path) && Object.isFrozen(entry.plan?.removeIds))).toBe(true);
    Object.defineProperty(worksheet, 'rows', { get: () => { throw new Error('Apply re-read source rows'); } });
    const applied = await applyPreparedSync(plan, []);
    expect(applied.fatalError).toBeUndefined();
    expect(frames.map(textChildren)).toEqual([['A', 'A'], ['A', 'A'], ['A', 'A']]);
    expect(removed.removed).toBe(true);
  });

  it('creates parent clones before expanding each nested repeat', async () => {
    const inner = repeat('Inner @# // Inner', [createMockText('#Title.1', 'old')]);
    const outer = repeat('Outer @# // Outer', [inner]);
    setup([outer]);
    const plan = await prepare([sheet(['outer 1', 'outer 2'], 'Outer'), sheet(['A', 'B', 'C'], 'Inner')]);
    expect(plan.repeats.map((entry) => entry.path)).toEqual([[0], [0, 0], [0, 1]]);
    expect(outer.children).toHaveLength(1);
    expect(inner.children).toHaveLength(1);
    const applied = await applyPreparedSync(plan, []);
    expect(applied.outcomes.filter((entry) => entry.status === 'failed')).toEqual([]);
    expect(outer.children.map((child) => textChildren(child as MockFrameNode)))
      .toEqual([['A', 'A', 'A'], ['A', 'A', 'A']]);
    expect(plan.repeats.map((entry) => entry.plan?.additions)).toEqual([1, 2, 2]);
  });

  it('resolves reviewed removal positions in a generated nested frame', async () => {
    const inner = repeat('Inner @# // Inner', [createMockText('#Title.1', 'old'),
      createMockText('#Title.1', 'old'), createMockText('#Title.1', 'old')]);
    const removed = inner.children.slice(1);
    const outer = repeat('Outer @# // Outer', [inner]);
    setup([outer]);
    const plan = await prepare([sheet(['outer 1', 'outer 2'], 'Outer'), sheet(['A'], 'Inner')]);
    const applied = await applyPreparedSync(plan, []);
    expect(applied.fatalError).toBeUndefined();
    expect(outer.children.map((child) => textChildren(child as MockFrameNode))).toEqual([['A'], ['A']]);
    expect(removed.every((child) => child.removed)).toBe(true);
    expect(applied.outcomes.filter((entry) => entry.bindingId.startsWith('repeat:'))
      .map((entry) => entry.message)).toEqual([
        'Added 1, removed 0 repeat child(ren).',
        'Added 0, removed 2 repeat child(ren).',
        'Added 0, removed 2 repeat child(ren).',
      ]);
  });

  it('skips captured invalid repeat operations when their issue is excluded', async () => {
    const frame = createMockFrame('Cards @#', [createMockText('#Title.1', 'old')]);
    setup([frame]);
    const plan = await prepare();
    const invalid = plan.summary.issues.find((issue) => issue.code === 'repeat-invalid')!;
    const applied = await applyPreparedSync(plan, [invalid.id]);
    expect(frame.children).toHaveLength(1);
    expect(applied.outcomes.find((entry) => entry.bindingId.startsWith('repeat:')))
      .toMatchObject({ status: 'skipped', message: 'Auto-layout required for layer repetition.' });
    expect(textChildren(frame)).toEqual(['A']);
  });

  it('refuses to remove replacement children introduced during an earlier repeat', async () => {
    const victim = repeat('Victim @#', [createMockText('#Title.1'),
      createMockText('#Title.1'), createMockText('#Title.1')]);
    const replacement = createMockText('#Title.1', 'Do not remove');
    const template = createMockText('#Title.1');
    const clone = template.clone;
    template.clone = () => {
      victim.children[2].remove();
      victim.appendChild(replacement);
      return clone();
    };
    setup([repeat('Grow @#', [template]), victim]);
    const plan = await prepare();
    const applied = await applyPreparedSync(plan, []);
    expect(victim.children).toHaveLength(3);
    expect(replacement.removed).toBe(false);
    expect(replacement.characters).toBe('Do not remove');
    expect(applied.outcomes.find((entry) => entry.layerId === victim.id)?.status).toBe('failed');
    expect(applied.warnings).toContain('Repeat children changed after planning. Refresh preflight.');
  });

  it('retains actual removal counts and skips bindings after a partial failure', async () => {
    const children = Array.from({ length: 3 }, () => createMockText('#Title.1', 'old'));
    children[1].remove = () => { throw new Error('Removal failed'); };
    const frame = repeat('Cards @#', children);
    setup([frame]);
    const plan = await prepare([sheet(['A'])]);
    const applied = await applyPreparedSync(plan, []);
    expect(applied.fatalError).toContain('1 removal(s)');
    expect(frame.children).toHaveLength(2);
    expect(textChildren(frame)).toEqual(['old', 'old']);
    expect(applied.outcomes[0]).toMatchObject({ status: 'changed', message: 'Added 0, removed 1 repeat child(ren).' });
    expect(applied.outcomes[1]).toMatchObject({ status: 'skipped' });
  });

  it('retains removal counts when cancellation stops the structural phase', async () => {
    const signal = { aborted: false };
    const children = Array.from({ length: 3 }, () => createMockText('#Title.1', 'old'));
    const remove = children[2].remove;
    children[2].remove = () => { remove(); signal.aborted = true; };
    const frame = repeat('Cards @#', children);
    setup([frame]);
    const plan = await prepare([sheet(['A'])]);
    const applied = await applyPreparedSync(plan, [], signal);
    expect(applied.cancelled).toBe(true);
    expect(applied.fatalError).toContain('1 removal(s)');
    expect(textChildren(frame)).toEqual(['old', 'old']);
    expect(applied.outcomes[0].status).toBe('changed');
    expect(applied.outcomes[1].status).toBe('skipped');
  });

  it.each(['apply', 'retry'])('materializes repeat paths after their projected component swap during %s', async (mode) => {
    const source = createMockComponent('Source');
    const target = createMockComponent('Target', [repeat('Cards @#', [createMockText('#Title.1', 'old')])]);
    const instance = createMockInstance('#Variant.1', source);
    instance.swapComponent = (component) => {
      instance.mainComponent = component;
      instance.children = component.children.map((child) => child.clone() as MockSceneNode);
      for (const child of instance.children) child.parent = instance;
    };
    setup([source, target, instance]);
    const plan = await prepare([{
      ...sheet(['A', 'B']), labels: ['Title', 'Variant'], rows: { Title: ['A', 'B'], Variant: ['Target'] },
    }]);
    expect(instance.children).toHaveLength(0);
    expect(plan.repeats[0].afterBindingId).toBe(plan.bindings[0].bindingId);
    let retryBindings: Set<string> | undefined;
    if (mode === 'retry') {
      const swap = instance.swapComponent;
      instance.swapComponent = () => { throw new Error('Temporary swap failure'); };
      const failed = await applyPreparedSync(plan, []);
      expect(instance.children).toHaveLength(0);
      retryBindings = new Set(failed.outcomes.filter((entry) => entry.status === 'failed').map((entry) => entry.bindingId));
      instance.swapComponent = swap;
    }
    const applied = await applyPreparedSync(plan, [], undefined, undefined, retryBindings);
    expect(applied.outcomes.filter((entry) => entry.status === 'failed')).toEqual([]);
    expect(textChildren(instance.children[0] as MockFrameNode)).toEqual(['A', 'A']);
    expect((target.children[0] as MockFrameNode).children).toHaveLength(1);
  });
});
