import { describe, expect, it } from 'vitest';
import { createMainThreadFixture } from './main-thread-harness';
import { createMockFrame, createMockPage, createMockRectangle, createMockText } from '../mocks/figma';
import type { InterpretationPreferences, SheetData } from '../../src/core/types';

const preferences: InterpretationPreferences = { orientations: {}, blankText: 'clear-and-hide' };

function data(rows: Record<string, string[]>): SheetData {
  return {
    activeWorksheet: 'Sheet1',
    worksheets: [{ name: 'Sheet1', labels: Object.keys(rows), rows, orientation: 'columns' }],
  };
}

function message<T extends string>(messages: unknown[], type: T, runId?: string): any {
  return messages.find((item: any) => item?.type === type && (!runId || item.runId === runId));
}

describe('main-thread operation boundary', () => {
  it('initializes with document settings and treats legacy URL as a suggestion', async () => {
    const fixture = await createMainThreadFixture();
    fixture.storage.set('lastUrl', 'https://docs.google.com/spreadsheets/d/saved/edit');
    await fixture.sendUiMessage({ type: 'UI_READY' });
    expect(message(fixture.messages, 'INIT')?.payload).toMatchObject({
      hasSelection: false,
      lastUrl: 'https://docs.google.com/spreadsheets/d/saved/edit',
    });
    expect(message(fixture.messages, 'INIT')?.payload.config).toBeUndefined();
  });

  it('allocates a snapshot before fetch and correlates the network request', async () => {
    const fixture = await createMainThreadFixture();
    const url = 'https://docs.google.com/spreadsheets/d/integration-test/edit';
    await fixture.sendUiMessage({ type: 'FETCH', runId: 'fetch-1', payload: { url, preferences } });
    expect(message(fixture.messages, 'REQUEST_SHEET_FETCH', 'fetch-1')?.payload).toMatchObject({ url, preferences });
    expect(message(fixture.messages, 'REQUEST_SHEET_FETCH', 'fetch-1')?.payload.snapshotId).toEqual(expect.any(String));
  });

  it('cancels during fetch with zero mutation and ignores the late response', async () => {
    const fixture = await createMainThreadFixture();
    const url = 'https://docs.google.com/spreadsheets/d/integration-test/edit';
    await fixture.sendUiMessage({ type: 'FETCH_AND_SYNC', runId: 'sync-1',
      payload: { url, scope: 'page', preferences } });
    await fixture.sendUiMessage({ type: 'CANCEL_SYNC', runId: 'sync-1' });
    expect(message(fixture.messages, 'CANCEL_FETCH', 'sync-1')).toBeDefined();
    expect(message(fixture.messages, 'SYNC_COMPLETE', 'sync-1')?.payload.status).toBe('cancelled');
    await fixture.sendUiMessage({ type: 'SHEET_DATA', runId: 'sync-1',
      payload: { data: data({ Title: ['new'] }), fetchedAt: 1 } });
    expect(fixture.text.characters).toBe('Old value');
    expect(fixture.figma.root.getPluginData('sheets-to-layers:sync-config:v1')).toBe('');
  });

  it('keeps the previous document configuration when a newer run is cancelled', async () => {
    const fixture = await createMainThreadFixture();
    const originalUrl = 'https://docs.google.com/spreadsheets/d/original-source/edit';
    await fixture.sendUiMessage({ type: 'FETCH_AND_SYNC', runId: 'first',
      payload: { url: originalUrl, scope: 'page', preferences } });
    await fixture.sendUiMessage({ type: 'SHEET_DATA', runId: 'first',
      payload: { data: data({ Title: ['first value'] }), fetchedAt: 1 } });
    const before = fixture.figma.root.getPluginData('sheets-to-layers:sync-config:v1');
    expect(before).toContain('original-source');

    await fixture.sendUiMessage({ type: 'FETCH_AND_SYNC', runId: 'second',
      payload: { url: 'https://docs.google.com/spreadsheets/d/new-source/edit', scope: 'page', preferences } });
    await fixture.sendUiMessage({ type: 'CANCEL_SYNC', runId: 'second' });
    await fixture.sendUiMessage({ type: 'SHEET_DATA', runId: 'second',
      payload: { data: data({ Title: ['late value'] }), fetchedAt: 2 } });
    expect(fixture.figma.root.getPluginData('sheets-to-layers:sync-config:v1')).toBe(before);
    expect(fixture.text.characters).toBe('first value');
  });

  it('preserves the preview source URL through Sync and saves document-owned roots', async () => {
    const fixture = await createMainThreadFixture();
    const url = 'https://docs.google.com/spreadsheets/d/from-preview/edit';
    await fixture.sendUiMessage({ type: 'FETCH', runId: 'fetch-1', payload: { url, preferences } });
    await fixture.sendUiMessage({ type: 'SHEET_DATA', runId: 'fetch-1',
      payload: { data: data({ Title: ['new'] }), fetchedAt: 1 } });
    const snapshotId = message(fixture.messages, 'FETCH_SUCCESS', 'fetch-1')?.payload.snapshot.id;
    fixture.storage.set('lastUrl', 'https://docs.google.com/spreadsheets/d/another-source/edit');
    await fixture.sendUiMessage({ type: 'SYNC', runId: 'sync-1', payload: { scope: 'page', snapshotId, preferences } });
    const preflight = message(fixture.messages, 'PREFLIGHT', 'sync-1')?.payload;
    expect(preflight?.requiresConfirmation).toBe(true);
    expect(fixture.text.characters).toBe('Old value');
    expect(fixture.figma.root.getPluginData('sheets-to-layers:sync-config:v1')).toBe('');
    await fixture.sendUiMessage({ type: 'APPLY', runId: 'sync-1', payload: {
      snapshotId, preflightId: preflight.preflightId, excludedIssueIds: [],
    } });
    expect(fixture.text.characters).toBe('new');
    const config = JSON.parse(fixture.figma.root.getPluginData('sheets-to-layers:sync-config:v1'));
    expect(config).toMatchObject({
      sourceUrl: url, spreadsheetId: 'from-preview', scope: 'page',
      pageId: fixture.page.id, rootIds: [fixture.page.id],
    });
    expect(message(fixture.messages, 'SYNC_COMPLETE', 'sync-1')?.payload.counts.changed).toBe(1);
  });

  it('rebuilds an active review when its data settings change', async () => {
    const fixture = await createMainThreadFixture();
    const url = 'https://docs.google.com/spreadsheets/d/review-settings/edit';
    await fixture.sendUiMessage({ type: 'FETCH', runId: 'fetch-1', payload: { url, preferences } });
    await fixture.sendUiMessage({ type: 'SHEET_DATA', runId: 'fetch-1',
      payload: { data: data({ Title: ['new'] }), fetchedAt: 1 } });
    const snapshotId = message(fixture.messages, 'FETCH_SUCCESS', 'fetch-1')?.payload.snapshot.id;
    await fixture.sendUiMessage({ type: 'SYNC', runId: 'sync-1',
      payload: { scope: 'page', snapshotId, preferences } });
    const initial = message(fixture.messages, 'PREFLIGHT', 'sync-1')?.payload;
    const updatedPreferences: InterpretationPreferences = {
      orientations: {},
      blankText: 'leave-unchanged',
    };

    await fixture.sendUiMessage({
      type: 'UPDATE_PREFLIGHT_SETTINGS',
      runId: 'sync-1',
      payload: {
        snapshotId,
        preflightId: initial.preflightId,
        preferences: updatedPreferences,
      },
    });

    const reviews = fixture.messages.filter(
      (entry: any) => entry?.type === 'PREFLIGHT' && entry.runId === 'sync-1',
    ) as any[];
    expect(reviews).toHaveLength(2);
    const updated = reviews.at(-1)?.payload;
    expect(updated.preflightId).not.toBe(initial.preflightId);
    expect(updated.preferences).toEqual(updatedPreferences);

    await fixture.sendUiMessage({ type: 'APPLY', runId: 'sync-1', payload: {
      snapshotId, preflightId: updated.preflightId, excludedIssueIds: [],
    } });
    const config = JSON.parse(fixture.figma.root.getPluginData('sheets-to-layers:sync-config:v1'));
    expect(config.preferences.blankText).toBe('leave-unchanged');
  });

  it('commits each completed sync as its own undo boundary while the UI remains open', async () => {
    const fixture = await createMainThreadFixture();
    const url = 'https://docs.google.com/spreadsheets/d/integration-test/edit';
    for (const [runId, value] of [['first', 'first value'], ['second', 'second value']]) {
      await fixture.sendUiMessage({ type: 'FETCH_AND_SYNC', runId,
        payload: { url, scope: 'page', preferences } });
      await fixture.sendUiMessage({ type: 'SHEET_DATA', runId,
        payload: { data: data({ Title: [value] }), fetchedAt: 1 } });
      expect(message(fixture.messages, 'SYNC_COMPLETE', runId)?.payload.status).toBe('success');
      expect(fixture.figma._undoCommits).toHaveLength(runId === 'first' ? 1 : 2);
    }
    expect(fixture.text.characters).toBe('second value');
  });

  it('sends one fatal terminal result with partial outcomes and no separate ERROR', async () => {
    const image = createMockRectangle('#Image');
    const text = createMockText('#Title', 'old');
    const fixture = await createMainThreadFixture({ page: createMockPage('Page', [text, image]) });
    const url = 'https://docs.google.com/spreadsheets/d/integration-test/edit';
    await fixture.sendUiMessage({ type: 'FETCH_AND_SYNC', runId: 'fatal-1',
      payload: { url, scope: 'page', preferences } });
    await fixture.sendUiMessage({ type: 'SHEET_DATA', runId: 'fatal-1', payload: {
      data: data({ Title: ['new'], Image: ['https://example.com/a.png'] }), fetchedAt: 1,
    } });
    const request = message(fixture.messages, 'REQUEST_IMAGE_FETCH', 'fatal-1');
    const originalGet = fixture.figma.getNodeByIdAsync;
    fixture.figma.getNodeByIdAsync = async (id: string) => {
      if (id === image.id) throw new Error('Host image lookup failed');
      return originalGet(id);
    };
    await fixture.sendUiMessage({ type: 'IMAGE_DATA', runId: 'fatal-1', payload: {
      ...request.payload, data: new Uint8Array([1, 2, 3]),
    } });

    const completions = fixture.messages.filter((entry: any) => entry?.type === 'SYNC_COMPLETE' && entry.runId === 'fatal-1') as any[];
    expect(completions).toHaveLength(1);
    expect(message(fixture.messages, 'ERROR', 'fatal-1')).toBeUndefined();
    expect(completions[0].payload).toMatchObject({
      status: 'failed', counts: { changed: 1, skipped: 1, failed: 0 },
    });
    expect(completions[0].payload.errors[0].error).toContain('Host image lookup failed');
    expect(completions[0].payload.outcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({ layerId: text.id, status: 'changed' }),
      expect.objectContaining({ layerId: image.id, status: 'skipped' }),
    ]));
    expect(fixture.figma._undoCommits).toHaveLength(1);
    expect(fixture.figma.root.getPluginData('sheets-to-layers:sync-config:v1')).toBe('');
  });

  it('includes a fetch failure in the single terminal result', async () => {
    const fixture = await createMainThreadFixture();
    const url = 'https://docs.google.com/spreadsheets/d/integration-test/edit';
    await fixture.sendUiMessage({ type: 'FETCH_AND_SYNC', runId: 'fetch-fatal',
      payload: { url, scope: 'page', preferences } });
    await fixture.sendUiMessage({ type: 'FETCH_ERROR', runId: 'fetch-fatal',
      payload: { error: 'Sheet request failed' } });

    expect(message(fixture.messages, 'ERROR', 'fetch-fatal')).toBeUndefined();
    expect(message(fixture.messages, 'SYNC_COMPLETE', 'fetch-fatal')?.payload).toMatchObject({
      status: 'failed', errors: [{ error: 'Sheet request failed' }],
    });
    expect(fixture.figma._undoCommits).toHaveLength(0);
  });

  it('rejects overlap, duplicate run IDs, and stale sheet responses', async () => {
    const fixture = await createMainThreadFixture();
    const url = 'https://docs.google.com/spreadsheets/d/integration-test/edit';
    await fixture.sendUiMessage({ type: 'FETCH_AND_SYNC', runId: 'sync-1',
      payload: { url, scope: 'page', preferences } });
    await fixture.sendUiMessage({ type: 'FETCH', runId: 'fetch-2', payload: { url, preferences } });
    expect(message(fixture.messages, 'ERROR', 'fetch-2')?.payload.message).toContain('still running');
    await fixture.sendUiMessage({ type: 'SHEET_DATA', runId: 'other',
      payload: { data: data({ Title: ['wrong'] }), fetchedAt: 1 } });
    expect(fixture.text.characters).toBe('Old value');
    await fixture.sendUiMessage({ type: 'CANCEL_SYNC', runId: 'sync-1' });
    await fixture.sendUiMessage({ type: 'FETCH', runId: 'sync-1', payload: { url, preferences } });
    expect(message(fixture.messages, 'ERROR', 'sync-1')?.payload.message).toContain('already been used');
  });

  it('requires reviewed preflight before removing repeated children', async () => {
    const frame = createMockFrame('Cards @#', [createMockText('#Title'), createMockText('#Title')], [], { layoutMode: 'VERTICAL' });
    const fixture = await createMainThreadFixture({ page: createMockPage('Page', [frame]) });
    const url = 'https://docs.google.com/spreadsheets/d/integration-test/edit';
    await fixture.sendUiMessage({ type: 'FETCH_AND_SYNC', runId: 'sync-1',
      payload: { url, scope: 'page', preferences } });
    await fixture.sendUiMessage({ type: 'SHEET_DATA', runId: 'sync-1',
      payload: { data: data({ Title: ['one'] }), fetchedAt: 1 } });
    const preflight = message(fixture.messages, 'PREFLIGHT', 'sync-1')?.payload;
    expect(preflight?.repeats[0]).toMatchObject({ removals: 1, removeIds: [frame.children[1].id] });
    expect(frame.children).toHaveLength(2);
    await fixture.sendUiMessage({ type: 'APPLY', runId: 'sync-1', payload: {
      snapshotId: preflight.snapshotId, preflightId: preflight.preflightId, excludedIssueIds: [],
    } });
    expect(frame.children).toHaveLength(1);
    expect(message(fixture.messages, 'SYNC_COMPLETE', 'sync-1')?.payload.status).toBe('success');
  });

  it('waits for every concurrent image reply before terminal result and metadata save', async () => {
    const first = createMockRectangle('#First');
    const second = createMockRectangle('#Second');
    const fixture = await createMainThreadFixture({ page: createMockPage('Page', [first, second]) });
    const url = 'https://docs.google.com/spreadsheets/d/integration-test/edit';
    await fixture.sendUiMessage({ type: 'FETCH_AND_SYNC', runId: 'sync-1',
      payload: { url, scope: 'page', preferences } });
    await fixture.sendUiMessage({ type: 'SHEET_DATA', runId: 'sync-1', payload: {
      data: data({ First: ['https://example.com/a.png'], Second: ['https://example.com/b.png'] }), fetchedAt: 1,
    } });
    const requests = fixture.messages.filter((item: any) => item?.type === 'REQUEST_IMAGE_FETCH') as any[];
    expect(requests).toHaveLength(2);

    const originalGet = fixture.figma.getNodeByIdAsync;
    let releaseFirst!: () => void;
    const held = new Promise<void>((resolve) => { releaseFirst = resolve; });
    fixture.figma.getNodeByIdAsync = async (id: string) => {
      if (id === first.id) await held;
      return originalGet(id);
    };
    const firstReply = fixture.figma.ui.onmessage!({ type: 'IMAGE_DATA', runId: 'sync-1', payload: {
      ...requests[0].payload, data: new Uint8Array([1, 2, 3]),
    } });
    await fixture.sendUiMessage({ type: 'IMAGE_DATA', runId: 'sync-1', payload: {
      ...requests[1].payload, data: new Uint8Array([4, 5, 6]),
    } });
    expect(message(fixture.messages, 'SYNC_COMPLETE', 'sync-1')).toBeUndefined();
    expect(fixture.figma.root.getPluginData('sheets-to-layers:sync-config:v1')).toBe('');
    releaseFirst();
    await firstReply;
    await fixture.flush();
    expect(message(fixture.messages, 'SYNC_COMPLETE', 'sync-1')?.payload.counts.changed).toBe(2);
    expect(fixture.figma.root.getPluginData('sheets-to-layers:sync-config:v1')).not.toBe('');
  });

  it('keeps an image failure visible in a partial result', async () => {
    const image = createMockRectangle('#Image');
    const text = createMockText('#Title', 'old');
    const fixture = await createMainThreadFixture({ page: createMockPage('Page', [text, image]) });
    const url = 'https://docs.google.com/spreadsheets/d/integration-test/edit';
    await fixture.sendUiMessage({ type: 'FETCH_AND_SYNC', runId: 'sync-1',
      payload: { url, scope: 'page', preferences } });
    await fixture.sendUiMessage({ type: 'SHEET_DATA', runId: 'sync-1', payload: {
      data: data({ Title: ['new'], Image: ['https://example.com/a.png'] }), fetchedAt: 1,
    } });
    const request = message(fixture.messages, 'REQUEST_IMAGE_FETCH', 'sync-1');
    await fixture.sendUiMessage({ type: 'IMAGE_FETCH_ERROR', runId: 'sync-1', payload: {
      ...request.payload, error: 'Image HTTP 503',
    } });
    const result = message(fixture.messages, 'SYNC_COMPLETE', 'sync-1')?.payload;
    expect(result.status).toBe('partial');
    expect(result.counts).toMatchObject({ changed: 1, failed: 1 });
    expect(result.outcomes.find((entry: any) => entry.status === 'failed')).toMatchObject({
      layerId: image.id, layerName: image.name, label: 'Image', resolvedRow: 1,
    });
  });

  it('blocks binding edits during a run and navigates to a result on another page', async () => {
    const fixture = await createMainThreadFixture();
    const other = createMockPage('Other', [createMockText('#Elsewhere', 'old')]);
    fixture.figma.root.children.push(other);
    other.parent = fixture.figma.root;
    fixture.page.selection = [fixture.text];
    const url = 'https://docs.google.com/spreadsheets/d/integration-test/edit';
    await fixture.sendUiMessage({ type: 'FETCH_AND_SYNC', runId: 'sync-1',
      payload: { url, scope: 'page', preferences } });
    await fixture.sendUiMessage({ type: 'RENAME_SELECTION', payload: {
      action: { type: 'label', label: 'Changed' },
    } });
    expect(fixture.text.name).toBe('#Title');
    await fixture.sendUiMessage({ type: 'SELECT_LAYER', payload: { layerId: other.children[0].id } });
    expect(fixture.figma.currentPage.id).toBe(other.id);
    expect(fixture.figma.currentPage.selection.map((node: any) => node.id)).toEqual([other.children[0].id]);
  });
});
