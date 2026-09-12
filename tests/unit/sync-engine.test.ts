import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyPendingImage, applyPreparedSync, finalOperationResult, prepareSync, StalePreflightError,
} from '../../src/core/sync-engine';
import { captureScopeRoots } from '../../src/core/traversal';
import type { InterpretationPreferences, SheetData, SheetSnapshot } from '../../src/core/types';
import {
  cleanupMockFigma, createMockComponent, createMockComponentSet, createMockDocument,
  createMockFigma, createMockFrame, createMockInstance, createMockPage, createMockRectangle,
  createMockText, resetNodeIdCounter, setupMockFigma,
  type MockPageNode, type MockSceneNode,
} from '../mocks/figma';

const preferences: InterpretationPreferences = { orientations: {}, blankText: 'clear-and-hide' };

function sheet(rows: Record<string, string[]>, name = 'Sheet1'): SheetData {
  return {
    activeWorksheet: name,
    worksheets: [{ name, labels: Object.keys(rows), rows, orientation: 'columns' }],
  };
}

function snapshot(data: SheetData, id = 'snapshot-1'): SheetSnapshot {
  return {
    id, sourceUrl: 'https://docs.google.com/spreadsheets/d/example-id/edit',
    spreadsheetId: 'example-id', fetchedAt: 1, data, preferences,
  };
}

function setup(page: MockPageNode): void {
  setupMockFigma(createMockFigma(createMockDocument([page]), page));
}

async function planPage(data: SheetData, prefs = preferences) {
  return prepareSync({ snapshot: snapshot(data), roots: captureScopeRoots('page'), preferences: prefs });
}

async function applyAndFinish(plan: Awaited<ReturnType<typeof planPage>>, excludedIssueIds: string[] = []) {
  const applied = await applyPreparedSync(plan, excludedIssueIds);
  return { applied, result: finalOperationResult(plan, applied.outcomes, applied.warnings) };
}

describe('prepared sync pipeline', () => {
  beforeEach(() => resetNodeIdCounter());
  afterEach(() => cleanupMockFigma());

  it('finds no bindings without changing the page', async () => {
    const text = createMockText('Plain text', 'old');
    setup(createMockPage('Page', [text]));
    const plan = await planPage(sheet({ Title: ['A'] }));
    const { result } = await applyAndFinish(plan);
    expect(plan.summary.totalBindings).toBe(0);
    expect(result.counts).toEqual({ changed: 0, unchanged: 0, skipped: 0, failed: 0 });
    expect(text.characters).toBe('old');
  });

  it('counts unchanged layers and keeps their row position on the next full run', async () => {
    const first = createMockText('#Title', 'A');
    const second = createMockText('#Title', 'old');
    setup(createMockPage('Page', [first, second]));
    const initial = await planPage(sheet({ Title: ['A', 'B'] }));
    const firstResult = await applyAndFinish(initial);
    expect(firstResult.result.counts).toEqual({ changed: 1, unchanged: 1, skipped: 0, failed: 0 });
    expect([first.characters, second.characters]).toEqual(['A', 'B']);

    const refreshed = await planPage(sheet({ Title: ['A2', 'B2'] }));
    const secondResult = await applyAndFinish(refreshed);
    expect(secondResult.result.counts.changed).toBe(2);
    expect([first.characters, second.characters]).toEqual(['A2', 'B2']);
  });

  it('uses the active worksheet for unqualified bindings', async () => {
    const text = createMockText('#Title', 'old');
    setup(createMockPage('Page', [text]));
    const data: SheetData = {
      activeWorksheet: 'Products',
      worksheets: [
        { name: 'Default', labels: ['Title'], rows: { Title: ['D'] }, orientation: 'columns' },
        { name: 'Products', labels: ['Title'], rows: { Title: ['P'] }, orientation: 'columns' },
      ],
    };
    const plan = await planPage(data);
    expect(plan.bindings[0].value).toBe('P');
    await applyAndFinish(plan);
    expect(text.characters).toBe('P');
  });

  it('loads other pages before fingerprinting cross-page component candidates', async () => {
    const text = createMockText('#Title', 'old');
    const page = createMockPage('Page', [text]);
    const other = createMockPage('Other', []);
    const remote = createMockComponent('Remote');
    other.loadAsync = async () => {
      if (other.children.length === 0) {
        other.children.push(remote);
        remote.parent = other;
      }
    };
    setupMockFigma(createMockFigma(createMockDocument([page, other]), page));
    const plan = await planPage(sheet({ Title: ['new'] }));
    expect(plan.summary.issues).toHaveLength(0);
    expect(plan.componentCache.components.get('remote')).toBe(remote);
  });

  it('retains actual ancestor worksheet and index context for selected descendants', async () => {
    const text = createMockText('#Title', 'old');
    const parent = createMockFrame('Card // Products .2', [text]);
    const page = createMockPage('Page', [parent]);
    page.selection = [text] as MockSceneNode[];
    setup(page);
    const data: SheetData = {
      activeWorksheet: 'Default',
      worksheets: [
        { name: 'Default', labels: ['Title'], rows: { Title: ['D1', 'D2'] }, orientation: 'columns' },
        { name: 'Products', labels: ['Title'], rows: { Title: ['P1', 'P2'] }, orientation: 'columns' },
      ],
    };
    const plan = await prepareSync({ snapshot: snapshot(data), roots: captureScopeRoots('selection'), preferences });
    expect(plan.bindings[0].value).toBe('P2');
    await applyAndFinish(plan);
    expect(text.characters).toBe('P2');
  });

  it('skips a selected child beneath an ignored ancestor', async () => {
    const text = createMockText('#Title', 'old');
    const parent = createMockFrame('-Ignored', [text]);
    const page = createMockPage('Page', [parent]);
    page.selection = [text] as MockSceneNode[];
    setup(page);
    const plan = await prepareSync({ snapshot: snapshot(sheet({ Title: ['new'] })),
      roots: captureScopeRoots('selection'), preferences });
    expect(plan.summary.totalBindings).toBe(0);
    await applyAndFinish(plan);
    expect(text.characters).toBe('old');
  });

  it('uses saved page roots even after currentPage changes', async () => {
    const first = createMockText('#Title', 'first');
    const second = createMockText('#Title', 'second');
    const pageA = createMockPage('A', [first]);
    const pageB = createMockPage('B', [second]);
    const figmaMock = createMockFigma(createMockDocument([pageA, pageB]), pageA);
    setupMockFigma(figmaMock);
    const roots = captureScopeRoots('page');
    figmaMock.currentPage = pageB;
    const plan = await prepareSync({ snapshot: snapshot(sheet({ Title: ['new'] })), roots, preferences });
    await applyAndFinish(plan);
    expect(first.characters).toBe('new');
    expect(second.characters).toBe('second');
  });

  it('retains missing roots for review and never widens to the current page', async () => {
    const text = createMockText('#Title', 'old');
    const page = createMockPage('Page', [text]);
    setup(page);
    const roots = { scope: 'selection' as const, rootIds: [text.id, 'missing-node'] };
    const plan = await prepareSync({ snapshot: snapshot(sheet({ Title: ['new'] })), roots, preferences });
    expect(plan.summary.issues.some((entry) => entry.code === 'missing-root')).toBe(true);
    expect(plan.summary.rootIds).toEqual([text.id, 'missing-node']);
    await expect(applyPreparedSync(plan, [])).rejects.toThrow('blocking preflight');
    await applyAndFinish(plan, plan.summary.issues.filter((entry) => entry.code === 'missing-root').map((entry) => entry.id));
    expect(text.characters).toBe('new');
  });

  it('requires explicit scope when every saved root is missing', async () => {
    setup(createMockPage('Page', [createMockText('#Title', 'old')]));
    const plan = await prepareSync({ snapshot: snapshot(sheet({ Title: ['new'] })),
      roots: { scope: 'selection', rootIds: ['missing'] }, preferences });
    await expect(applyPreparedSync(plan, plan.summary.issues.map((entry) => entry.id))).rejects.toThrow('explicit sync scope');
  });

  it('plans generated repeat children without touching the canvas, then applies every row', async () => {
    const template = createMockText('#Title', 'old');
    const frame = createMockFrame('Cards @#', [template], [], { layoutMode: 'VERTICAL' });
    setup(createMockPage('Page', [frame]));
    const plan = await planPage(sheet({ Title: ['A', 'B', 'C'] }));
    expect(frame.children).toHaveLength(1);
    expect(plan.summary.repeats[0]).toMatchObject({ additions: 2, removals: 0, targetCount: 3 });
    expect(plan.summary.totalBindings).toBe(3);
    const { result } = await applyAndFinish(plan);
    expect(result.counts.changed).toBe(4); // Three bindings plus the repeat structure.
    expect(frame.children.map((child) => (child as typeof template).characters)).toEqual(['A', 'B', 'C']);
  });

  it('shrinks repeats using the inherited worksheet and keeps the template', async () => {
    const repeated = createMockFrame('Cards @#', [
      createMockText('#Title'), createMockText('#Title'), createMockText('#Title'),
    ], [], { layoutMode: 'VERTICAL' });
    setup(createMockPage('Page', [createMockFrame('Section // Products', [repeated])]));
    const data: SheetData = {
      activeWorksheet: 'Default',
      worksheets: [
        { name: 'Default', labels: ['Title'], rows: { Title: ['D'] }, orientation: 'columns' },
        { name: 'Products', labels: ['Title'], rows: { Title: ['P1', 'P2'] }, orientation: 'columns' },
      ],
    };
    const plan = await planPage(data);
    expect(plan.summary.repeats[0]).toMatchObject({ worksheet: 'Products', removals: 1 });
    await applyAndFinish(plan);
    expect(repeated.children).toHaveLength(2);
    expect(repeated.children.map((child) => (child as ReturnType<typeof createMockText>).characters)).toEqual(['P1', 'P2']);
  });

  it('preserves repeat structure on valid zero-row data', async () => {
    const frame = createMockFrame('Cards @#', [createMockText('#Title')], [], { layoutMode: 'VERTICAL' });
    setup(createMockPage('Page', [frame]));
    const plan = await planPage(sheet({ Title: [] }));
    expect(plan.summary.issues.some((entry) => entry.code === 'repeat-empty')).toBe(true);
    await applyAndFinish(plan, plan.summary.issues.filter((entry) => entry.blocking).map((entry) => entry.id));
    expect(frame.children).toHaveLength(1);
  });

  it('reports missing labels as excluded operations with a reconciled count', async () => {
    const text = createMockText('#Missing', 'old');
    setup(createMockPage('Page', [text]));
    const plan = await planPage(sheet({ Title: ['new'] }));
    expect(plan.summary.issues.some((entry) => entry.code === 'missing-label')).toBe(true);
    const { result } = await applyAndFinish(plan, plan.summary.issues.map((entry) => entry.id));
    expect(result.counts).toEqual({ changed: 0, unchanged: 0, skipped: 1, failed: 0 });
    expect(text.characters).toBe('old');
  });

  it('diagnoses missing additional labels before any text mutation', async () => {
    const text = createMockText('#Title #Accent', 'old');
    setup(createMockPage('Page', [text]));
    const plan = await planPage(sheet({ Title: ['new'] }));
    expect(plan.summary.issues.some((entry) => entry.code === 'missing-additional-label')).toBe(true);
    const { result } = await applyAndFinish(plan, plan.summary.issues.map((entry) => entry.id));
    expect(result.counts.skipped).toBe(1);
    expect(text.characters).toBe('old');
  });

  it('flags missing fonts as affected skipped operations', async () => {
    const text = createMockText('#Title', 'old');
    text.hasMissingFont = true;
    setup(createMockPage('Page', [text]));
    const plan = await planPage(sheet({ Title: ['new'] }));
    expect(plan.summary.issues.some((entry) => entry.code === 'missing-font')).toBe(true);
    const { result } = await applyAndFinish(plan, plan.summary.issues.map((entry) => entry.id));
    expect(result.counts.skipped).toBe(1);
    expect(text.characters).toBe('old');
  });

  it('finds unavailable fonts during preflight while retaining both resolved rows', async () => {
    const first = createMockText('#Title', 'old');
    const second = createMockText('#Title', 'old');
    const page = createMockPage('Page', [first, second]);
    const host = createMockFigma(createMockDocument([page]), page);
    host.loadFontAsync = vi.fn().mockRejectedValue(new Error('Font unavailable'));
    setupMockFigma(host);
    const plan = await planPage(sheet({ Title: ['A', 'B'] }));
    expect(plan.bindings.map((entry) => entry.row)).toEqual([1, 2]);
    expect(plan.summary.issues.filter((entry) => entry.code === 'missing-font')).toHaveLength(2);
    expect(host.loadFontAsync).toHaveBeenCalledTimes(1);
    const { result } = await applyAndFinish(plan, plan.summary.issues.map((entry) => entry.id));
    expect(result.counts.skipped).toBe(2);
    expect([first.characters, second.characters]).toEqual(['old', 'old']);
  });

  it('stops later bindings after cancellation and records skipped rows', async () => {
    const first = createMockText('#Title', 'old');
    const second = createMockText('#Title', 'old');
    setup(createMockPage('Page', [first, second]));
    const plan = await planPage(sheet({ Title: ['A', 'B'] }));
    const signal = { aborted: false };
    let current = first.characters;
    Object.defineProperty(first, 'characters', {
      configurable: true,
      get: () => current,
      set: (value: string) => { current = value; signal.aborted = true; },
    });
    const applied = await applyPreparedSync(plan, [], signal);
    const result = finalOperationResult(plan, applied.outcomes, applied.warnings, applied.cancelled);
    expect(result.status).toBe('cancelled');
    expect(result.counts).toMatchObject({ changed: 1, skipped: 1 });
    expect(second.characters).toBe('old');
    expect(applied.outcomes[1].resolvedRow).toBe(2);
  });

  it('accepts a queued event-loop cancellation during a large apply batch', async () => {
    const layers = Array.from({ length: 600 }, () => createMockText('#Title', 'old'));
    setup(createMockPage('Page', layers));
    const plan = await planPage(sheet({ Title: Array.from({ length: 600 }, (_, index) => `Row ${index + 1}`) }));
    const signal = { aborted: false };
    let scheduled = false;
    const applied = await applyPreparedSync(plan, [], signal, (message) => {
      if (!scheduled && message.startsWith('Applying layers')) {
        scheduled = true;
        setTimeout(() => { signal.aborted = true; }, 0);
      }
    });
    expect(scheduled).toBe(true);
    expect(applied.cancelled).toBe(true);
    expect(applied.outcomes).toHaveLength(600);
    expect(applied.outcomes.some((outcome) => outcome.status === 'skipped')).toBe(true);
    expect(layers[599].characters).toBe('old');
  });

  it('counts styling-only changes from special values', async () => {
    const frame = createMockFrame('#Style');
    setup(createMockPage('Page', [frame]));
    const plan = await planPage(sheet({ Style: ['50%'] }));
    const { result } = await applyAndFinish(plan);
    expect(result.counts.changed).toBe(1);
    expect(frame.opacity).toBe(0.5);
  });

  it('leaves blank text unchanged when the saved preference requests it', async () => {
    const text = createMockText('#Title', 'old');
    setup(createMockPage('Page', [text]));
    const prefs: InterpretationPreferences = { orientations: {}, blankText: 'leave-unchanged' };
    const plan = await planPage(sheet({ Title: [''] }), prefs);
    const { result } = await applyAndFinish(plan);
    expect(result.counts.skipped).toBe(1);
    expect(text.characters).toBe('old');
  });

  it('rejects stale edits before repeat removals', async () => {
    const frame = createMockFrame('Cards @#', [createMockText('#Title'), createMockText('#Title')], [], { layoutMode: 'VERTICAL' });
    setup(createMockPage('Page', [frame]));
    const plan = await planPage(sheet({ Title: ['A'] }));
    frame.children[1].name = '#Edited';
    await expect(applyPreparedSync(plan, [])).rejects.toBeInstanceOf(StalePreflightError);
    expect(frame.children).toHaveLength(2);
  });

  it('keeps property-only variant changes in the current component family', async () => {
    const badgeSmall = createMockComponent('Size=Small');
    const badgeLarge = createMockComponent('Size=Large');
    const buttonSmall = createMockComponent('Size=Small');
    const buttonLarge = createMockComponent('Size=Large');
    const badge = createMockComponentSet('Badge', [badgeSmall, badgeLarge]);
    const button = createMockComponentSet('Button', [buttonSmall, buttonLarge]);
    const instance = createMockInstance('#Variant', buttonSmall);
    setup(createMockPage('Page', [badge, button, instance]));
    const plan = await planPage(sheet({ Variant: ['Size=Large'] }));
    expect(plan.summary.issues).toHaveLength(0);
    const { result } = await applyAndFinish(plan);
    expect(result.counts.changed).toBe(1);
    expect(instance.mainComponent).toBe(buttonLarge);
  });

  it('fingerprints an unbound instance through the dynamic-page async component getter', async () => {
    const source = createMockComponent('Source');
    const instance = createMockInstance('Unbound instance', source);
    Object.defineProperty(instance, 'mainComponent', {
      configurable: true,
      get: () => { throw new Error('mainComponent is unavailable with dynamic-page access'); },
    });
    instance.getMainComponentAsync = async () => source;
    const text = createMockText('#Title', 'old');
    setup(createMockPage('Page', [source, instance, text]));
    const plan = await planPage(sheet({ Title: ['new'] }));
    const { result } = await applyAndFinish(plan);
    expect(result.counts.changed).toBe(1);
    expect(text.characters).toBe('new');
  });

  it('detects an instance family change with the async getter before Apply', async () => {
    const source = createMockComponent('Source');
    const replacement = createMockComponent('Replacement');
    const instance = createMockInstance('#Variant', source);
    let current = source;
    Object.defineProperty(instance, 'mainComponent', {
      configurable: true,
      get: () => { throw new Error('mainComponent is unavailable with dynamic-page access'); },
    });
    instance.getMainComponentAsync = async () => current;
    setup(createMockPage('Page', [source, replacement, instance]));
    const plan = await planPage(sheet({ Variant: ['Source'] }));
    current = replacement;
    await expect(applyPreparedSync(plan, [])).rejects.toBeInstanceOf(StalePreflightError);
  });

  it('permits unambiguous explicit component family changes', async () => {
    const original = createMockComponent('Original');
    const replacement = createMockComponent('Replacement');
    const instance = createMockInstance('#Variant', original);
    setup(createMockPage('Page', [original, replacement, instance]));
    const plan = await planPage(sheet({ Variant: ['Replacement'] }));
    const { result } = await applyAndFinish(plan);
    expect(result.counts.changed).toBe(1);
    expect(instance.mainComponent).toBe(replacement);
  });

  it('selects a variant in an explicitly named different family', async () => {
    const buttonSmall = createMockComponent('Size=Small');
    const buttonLarge = createMockComponent('Size=Large');
    const badgeLarge = createMockComponent('Size=Large');
    const button = createMockComponentSet('Button', [buttonSmall, buttonLarge]);
    const badge = createMockComponentSet('Badge', [badgeLarge]);
    const instance = createMockInstance('#Variant', buttonSmall);
    setup(createMockPage('Page', [button, badge, instance]));
    const plan = await planPage(sheet({ Variant: ['Badge/Size=Large'] }));
    expect(plan.summary.issues).toHaveLength(0);
    const { result } = await applyAndFinish(plan);
    expect(result.counts.changed).toBe(1);
    expect(instance.mainComponent).toBe(badgeLarge);
  });

  it('blocks a family-qualified variant when the family name is duplicated', async () => {
    const buttonSmall = createMockComponent('Size=Small');
    const badgeA = createMockComponentSet('Badge', [createMockComponent('Size=Large')]);
    const badgeB = createMockComponentSet('Badge', [createMockComponent('Size=Large')]);
    const button = createMockComponentSet('Button', [buttonSmall]);
    const instance = createMockInstance('#Variant', buttonSmall);
    setup(createMockPage('Page', [button, badgeA, badgeB, instance]));
    const plan = await planPage(sheet({ Variant: ['Badge/Size=Large'] }));
    expect(plan.summary.issues[0].message).toContain('Ambiguous component set');
    await expect(applyPreparedSync(plan, [])).rejects.toThrow('blocking preflight');
  });

  it('blocks an ambiguous explicit component target', async () => {
    const original = createMockComponent('Original');
    const one = createMockComponent('Replacement');
    const two = createMockComponent('Replacement');
    const instance = createMockInstance('#Variant', original);
    setup(createMockPage('Page', [original, one, two, instance]));
    const plan = await planPage(sheet({ Variant: ['Replacement'] }));
    expect(plan.summary.issues[0].message).toContain('Ambiguous');
    await expect(applyPreparedSync(plan, [])).rejects.toThrow('blocking preflight');
  });

  it('blocks ambiguous variants inside a single family', async () => {
    const small = createMockComponent('Size=Small');
    const largeA = createMockComponent('Size=Large, Tone=A');
    const largeB = createMockComponent('Size=Large, Tone=B');
    const set = createMockComponentSet('Button', [small, largeA, largeB]);
    const instance = createMockInstance('#Variant', small);
    setup(createMockPage('Page', [set, instance]));
    const plan = await planPage(sheet({ Variant: ['Size=Large'] }));
    expect(plan.summary.issues[0].message).toContain('Ambiguous');
    await expect(applyPreparedSync(plan, [])).rejects.toThrow('blocking preflight');
  });

  it('queues images and rejects a user-edited paint before bytes arrive', async () => {
    const image = createMockRectangle('#Image', [{ type: 'IMAGE', imageHash: 'old', scaleMode: 'CROP' }]);
    setup(createMockPage('Page', [image]));
    const plan = await planPage(sheet({ Image: ['https://example.com/photo.png'] }));
    const applied = await applyPreparedSync(plan, []);
    expect(applied.pendingImages).toHaveLength(1);
    image.fills = [{ type: 'IMAGE', imageHash: 'user-change', scaleMode: 'CROP' }];
    const outcome = await applyPendingImage(applied.pendingImages[0], new Uint8Array([1, 2, 3]));
    expect(outcome.status).toBe('skipped');
    expect(image.fills[0]).toMatchObject({ imageHash: 'user-change' });
  });

  it('applies a matching image only after fetch and counts it as changed', async () => {
    const image = createMockRectangle('#Image', [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }]);
    setup(createMockPage('Page', [image]));
    const plan = await planPage(sheet({ Image: ['https://example.com/photo.png'] }));
    const applied = await applyPreparedSync(plan, []);
    const outcome = await applyPendingImage(applied.pendingImages[0], new Uint8Array([1, 2, 3]));
    expect(outcome.status).toBe('changed');
    const result = finalOperationResult(plan, [...applied.outcomes, outcome], applied.warnings);
    expect(result.counts.changed).toBe(1);
    expect(image.fills).toHaveLength(2);
  });

  it('reuses the exact random row and value when retrying a failed binding', async () => {
    const source = createMockComponent('Source');
    const targetA = createMockComponent('TargetA');
    const targetB = createMockComponent('TargetB');
    const instance = createMockInstance('#Variant.x', source);
    setup(createMockPage('Page', [source, targetA, targetB, instance]));
    const plan = await planPage(sheet({ Variant: ['TargetA', 'TargetB'] }));
    const chosen = plan.bindings[0];
    const originalSwap = instance.swapComponent;
    instance.swapComponent = () => { throw new Error('Temporary swap failure'); };
    const first = await applyPreparedSync(plan, []);
    expect(first.outcomes[0].status).toBe('failed');
    instance.swapComponent = originalSwap;
    const retry = await applyPreparedSync(plan, [], undefined, undefined, new Set([chosen.bindingId]));
    expect(retry.outcomes[0].status).toBe('changed');
    expect(chosen.row).toBe(plan.bindings[0].row);
    expect(instance.mainComponent?.name).toBe(chosen.value);
  });

  it('does not overwrite a user-edited failed target during retry', async () => {
    const text = createMockText('#Title', 'old');
    setup(createMockPage('Page', [text]));
    const plan = await planPage(sheet({ Title: ['planned'] }));
    text.characters = 'user edit';
    const retry = await applyPreparedSync(plan, [], undefined, undefined,
      new Set([plan.bindings[0].bindingId]));
    expect(retry.outcomes[0]).toMatchObject({ status: 'failed', layerId: text.id });
    expect(text.characters).toBe('user edit');
  });
});
