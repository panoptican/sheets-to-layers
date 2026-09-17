import { afterEach, describe, expect, it } from 'vitest';
import {
  launchPluginBrowser,
  readPluginMessages,
  sendPluginMessage,
  type PluginBrowser,
} from './harness';
import {
  chooseDropdown,
  waitForSettings,
  worksheetFixture,
  sheetSnapshot,
  preflightSummary,
  operationResult,
  lastMessage,
  enterPreview,
} from './fixtures';

describe('built plugin UI lifecycle', () => {
  let fixture: PluginBrowser | null = null;
  afterEach(async () => {
    await fixture?.browser.close();
    fixture = null;
  });
  it('shows the matching terminal result after cancelling a fetch and ignores its late snapshot', async () => {
    fixture = await launchPluginBrowser();
    const { page } = fixture;
    await page
      .locator('#sheets-url')
      .fill('https://docs.google.com/spreadsheets/d/source-a/edit');
    await page.locator('#sync-btn').click();
    const start = await lastMessage(page, 'FETCH_AND_SYNC');
    await page.locator('#cancel-sync-btn').click();
    expect(await readPluginMessages(page)).toContainEqual({
      pluginMessage: { type: 'CANCEL_SYNC', runId: start.pluginMessage.runId },
    });
    await sendPluginMessage(
      page,
      'FETCH_SUCCESS',
      {
        snapshot: sheetSnapshot({
          id: 'late-snapshot',
          spreadsheetId: 'source-a',
          data: {
            activeWorksheet: 'Sheet1',
            worksheets: [
              worksheetFixture({ name: 'Sheet1', rows: { Title: ['Late'] } }),
            ],
          },
        }),
      },
      { runId: start.pluginMessage.runId },
    );
    expect(await page.locator('.preview-mode').count()).toBe(0);
    expect(await page.locator('.progress-text').textContent()).toContain(
      'Cancelling',
    );
    await sendPluginMessage(
      page,
      'SYNC_COMPLETE',
      operationResult({
        status: 'cancelled',
        success: false,
        snapshotId: 'late-snapshot',
        counts: { changed: 0, unchanged: 2, skipped: 1, failed: 0 },
        layersProcessed: 3,
        layersUpdated: 0,
        warnings: ['Cancelled before changes were made.'],
      }),
      { runId: start.pluginMessage.runId },
    );
    expect(await page.locator('.result-summary').textContent()).toContain(
      'cancelled: 0 changed, 2 unchanged, 1 skipped, 0 failed.',
    );
  });

  it('requires an explicit exclusion before applying a blocking preflight issue', async () => {
    fixture = await launchPluginBrowser();
    const { page } = fixture;
    await enterPreview(
      page,
      sheetSnapshot({
        id: 'preflight-snapshot',
        spreadsheetId: 'source-b',
        data: {
          activeWorksheet: 'Sheet1',
          worksheets: [
            worksheetFixture({ name: 'Sheet1', rows: { Title: ['A'] } }),
          ],
        },
      }),
    );
    await page.locator('#sync-preview-btn').click();
    const sync = await lastMessage(page, 'SYNC');
    await sendPluginMessage(
      page,
      'PREFLIGHT',
      preflightSummary({
        preflightId: 'preflight-1',
        snapshotId: 'preflight-snapshot',
        sourceUrl: 'https://docs.google.com/spreadsheets/d/source-b/edit',
        preferences: { orientations: {}, blankText: 'clear-and-hide' },
        matchedBindings: 0,
        repeats: [
          {
            layerId: 'repeat-1',
            layerName: 'Cards @#',
            worksheet: 'Sheet1',
            currentCount: 2,
            targetCount: 1,
            additions: 0,
            removals: 1,
            removeIds: ['child-2'],
          },
          {
            layerId: 'repeat-unchanged',
            layerName: 'Unchanged cards @#',
            worksheet: 'Sheet1',
            currentCount: 2,
            targetCount: 2,
            additions: 0,
            removals: 0,
            removeIds: [],
          },
        ],
        issues: [
          {
            id: 'missing-title',
            code: 'missing-label',
            message: 'Title is missing',
            severity: 'error',
            blocking: true,
            layerId: 'layer-1',
            layerName: 'Title',
          },
        ],
      }),
      { runId: sync.pluginMessage.runId },
    );
    expect(await page.locator('#apply-btn').isDisabled()).toBe(true);
    expect(await page.locator('#apply-btn').textContent()).toBe('Sync layers');
    expect(await page.locator('.preflight-summary').count()).toBe(0);
    expect(await page.locator('.repeat-change').count()).toBe(1);
    expect(await page.locator('.repeat-change').textContent()).toBe(
      'Cards will remove 1 repeated item.',
    );
    expect(await page.locator('.preflight-source').textContent()).toContain(
      'source-b',
    );
    expect(await page.locator('.preflight-details').textContent()).toContain(
      'Current page (0 roots)',
    );
    expect(await page.locator('.preflight-details').textContent()).toContain(
      'Default worksheetSheet1',
    );
    expect(await page.locator('.preflight-details').textContent()).toContain(
      'Auto-detect headers in the first row or first column',
    );
    expect(await page.locator('.preflight-details').textContent()).toContain(
      'Clear and hide blank text',
    );

    await page.locator('#preview-settings-btn').click();
    await waitForSettings(page);
    await chooseDropdown(page, 'blank-text-policy', 'leave-unchanged');
    await page.locator('#preview-settings-save-btn').click();
    const settingsUpdate = await lastMessage(page, 'UPDATE_PREFLIGHT_SETTINGS');
    expect(settingsUpdate.pluginMessage).toMatchObject({
      runId: sync.pluginMessage.runId,
      payload: {
        snapshotId: 'preflight-snapshot',
        preflightId: 'preflight-1',
        preferences: { blankText: 'leave-unchanged' },
      },
    });
    await sendPluginMessage(
      page,
      'PREFLIGHT',
      preflightSummary({
        preflightId: 'preflight-2',
        snapshotId: 'preflight-snapshot',
        sourceUrl: 'https://docs.google.com/spreadsheets/d/source-b/edit',
        preferences: { orientations: {}, blankText: 'leave-unchanged' },
        matchedBindings: 0,
        issues: [
          {
            id: 'missing-title',
            code: 'missing-label',
            message: 'Title is missing',
            severity: 'error',
            blocking: true,
            layerId: 'layer-1',
            layerName: 'Title',
          },
        ],
      }),
      { runId: sync.pluginMessage.runId },
    );
    expect(await page.locator('.preflight-details').textContent()).toContain(
      'Leave blank text unchanged',
    );
    await page.locator('#preflight-issue-missing-title').check();
    expect(await page.locator('#apply-btn').isDisabled()).toBe(false);
    await page.locator('#apply-btn').click();
    expect(await readPluginMessages(page)).toContainEqual({
      pluginMessage: {
        type: 'APPLY',
        runId: sync.pluginMessage.runId,
        payload: {
          snapshotId: 'preflight-snapshot',
          preflightId: 'preflight-2',
          excludedIssueIds: ['missing-title'],
        },
      },
    });
  });

  it('shows counts and outcomes when an applied sync completes after cancellation', async () => {
    fixture = await launchPluginBrowser();
    const { page } = fixture;
    await enterPreview(
      page,
      sheetSnapshot({
        id: 'cancel-applied-snapshot',
        spreadsheetId: 'cancel-applied',
        data: {
          activeWorksheet: 'Sheet1',
          worksheets: [
            worksheetFixture({ name: 'Sheet1', rows: { Title: ['A'] } }),
          ],
        },
      }),
    );
    await page.locator('#sync-preview-btn').click();
    const sync = await lastMessage(page, 'SYNC');
    await sendPluginMessage(
      page,
      'PREFLIGHT',
      preflightSummary({
        preflightId: 'cancel-applied-preflight',
        snapshotId: 'cancel-applied-snapshot',
        sourceUrl: 'https://docs.google.com/spreadsheets/d/cancel-applied/edit',
        scope: 'selection',
        rootIds: ['root-a'],
        preferences: { orientations: {}, blankText: 'clear-and-hide' },
      }),
      { runId: sync.pluginMessage.runId },
    );
    await page.locator('#apply-btn').click();
    await page.locator('#cancel-sync-btn').click();
    await sendPluginMessage(
      page,
      'SYNC_COMPLETE',
      operationResult({
        status: 'partial',
        success: false,
        snapshotId: 'cancel-applied-snapshot',
        counts: { changed: 1, unchanged: 1, skipped: 1, failed: 1 },
        layersProcessed: 4,
        layersUpdated: 1,
        warnings: ['Cancelled after one completed change.'],
        errors: [
          { layerId: 'failed', layerName: 'Failed', error: 'Timed out' },
        ],
        outcomes: [
          {
            bindingId: 'changed',
            layerId: 'changed',
            layerName: 'Changed title',
            status: 'changed',
          },
          {
            bindingId: 'failed',
            layerId: 'failed',
            layerName: 'Failed',
            status: 'failed',
            message: 'Timed out',
          },
        ],
      }),
      { runId: sync.pluginMessage.runId },
    );
    expect(await page.locator('.result-summary').textContent()).toContain(
      'partial: 1 changed, 1 unchanged, 1 skipped, 1 failed.',
    );
    expect(await page.locator('.outcome.failed').textContent()).toContain(
      'Failed: failed — Timed out',
    );
  });

  it('folds identical repeat lines and groups layer outcomes by name', async () => {
    fixture = await launchPluginBrowser();
    const { page } = fixture;
    // The plugin asks Figma for 960 x 600 in preview and result modes.
    await page.setViewportSize({ width: 960, height: 600 });
    await enterPreview(
      page,
      sheetSnapshot({ id: 'grouped-snapshot', spreadsheetId: 'source-grouped' }),
    );
    await page.locator('#sync-preview-btn').click();
    const sync = await lastMessage(page, 'SYNC');
    const cards = (id: string, parentName: string, additions = 237) => ({
      layerId: id, layerName: 'Cards @#', parentName, worksheet: 'Products',
      currentCount: 3, targetCount: 3 + additions, additions, removals: 0, removeIds: [],
    });
    await sendPluginMessage(
      page,
      'PREFLIGHT',
      preflightSummary({
        preflightId: 'grouped-preflight',
        snapshotId: 'grouped-snapshot',
        sourceUrl: 'https://docs.google.com/spreadsheets/d/source-grouped/edit',
        repeats: [
          cards('a', 'Products'), cards('b', 'Products'), cards('c', 'Products'),
          cards('d', 'Archive', 4),
        ],
      }),
      { runId: sync.pluginMessage.runId },
    );
    expect(await page.locator('.repeat-change').allTextContents()).toEqual([
      'Cards in Products will add 237 repeated items in each of 3 frames.',
      'Cards in Archive will add 4 repeated items.',
    ]);
    await page.locator('#apply-btn').click();
    const titles = Array.from({ length: 450 }, (_, index) => ({
      bindingId: `title-${index}`, layerId: `title-${index}`, layerName: 'Title #Title',
      status: index % 3 === 2 ? ('unchanged' as const) : ('changed' as const),
    }));
    await sendPluginMessage(
      page,
      'SYNC_COMPLETE',
      operationResult({
        status: 'partial',
        success: false,
        snapshotId: 'grouped-snapshot',
        counts: { changed: 302, unchanged: 150, skipped: 0, failed: 1 },
        layersProcessed: 453,
        layersUpdated: 302,
        errors: [{ layerId: 'title-failed', layerName: 'Title #Title', error: 'Font missing' }],
        outcomes: [
          ...titles,
          // A failure that happened last must still surface on the first page.
          { bindingId: 'title-failed', layerId: 'title-failed', layerName: 'Title #Title', status: 'failed', message: 'Font missing' },
          { bindingId: 'photo-0', layerId: 'photo-0', layerName: 'Photo #Image', status: 'changed' },
          { bindingId: 'photo-1', layerId: 'photo-1', layerName: 'Photo #Image', status: 'changed' },
        ],
      }),
      { runId: sync.pluginMessage.runId },
    );
    const headers = page.locator('.outcome-group-header');
    expect(await headers.allTextContents()).toEqual([
      '▾Title #Title1 failed, 300 changed, 150 unchanged',
      '▸Photo #Image2 changed',
    ]);
    // The group with a failure starts open with the failure first; the
    // healthy group starts closed; the failure is not listed a second time.
    expect(await page.locator('.outcome').count()).toBe(200);
    expect(await page.locator('.outcome').first().textContent()).toBe('Title #Title: failed — Font missing');
    expect(await page.locator('.result-error').count()).toBe(0);

    // The results panel owns scrolling: the expanded group is not clipped and
    // an ordinary wheel scroll reaches the pagination control.
    const layout = await page.evaluate(() => {
      const main = document.querySelector('main')!;
      const group = document.querySelector('.outcome-group')!;
      return {
        mainScrolls: main.scrollHeight > main.clientHeight,
        groupClipped: group.scrollHeight > group.clientHeight,
      };
    });
    expect(layout).toEqual({ mainScrolls: true, groupClipped: false });
    const mainBox = (await page.locator('main').boundingBox())!;
    await page.mouse.move(mainBox.x + mainBox.width / 2, mainBox.y + mainBox.height / 2);
    await page.mouse.wheel(0, 100_000);
    // Wheel scrolling settles asynchronously; wait for the panel to reach the end.
    await page.waitForFunction(() => {
      const main = document.querySelector('main')!;
      return main.scrollTop > 0 && main.scrollTop + main.clientHeight >= main.scrollHeight - 1;
    });
    const more = page.locator('.outcome-group-more');
    expect(await more.textContent()).toBe('Show 200 more of 251 remaining');
    const moreBox = (await more.boundingBox())!;
    expect(moreBox.y).toBeGreaterThanOrEqual(mainBox.y);
    expect(moreBox.y + moreBox.height).toBeLessThanOrEqual(mainBox.y + mainBox.height);
    await more.click();
    expect(await page.locator('.outcome').count()).toBe(400);
    expect(await more.textContent()).toBe('Show 51 more of 51 remaining');
    await headers.nth(1).click();
    expect(await page.locator('.outcome').count()).toBe(402);
    await page.locator('.outcome').first().click();
    expect(await readPluginMessages(page)).toContainEqual({
      pluginMessage: { type: 'SELECT_LAYER', payload: { layerId: 'title-failed' } },
    });
  });

  it('shows each layer failure once and keeps errors that have no outcome', async () => {
    fixture = await launchPluginBrowser();
    const { page } = fixture;
    await enterPreview(
      page,
      sheetSnapshot({ id: 'failures-snapshot', spreadsheetId: 'source-failures' }),
    );
    const runSync = async (result: Parameters<typeof operationResult>[0]) => {
      await page.locator('#sync-preview-btn').click();
      const sync = await lastMessage(page, 'SYNC');
      await sendPluginMessage(
        page,
        'PREFLIGHT',
        preflightSummary({ preflightId: `failures-${Date.now()}`, snapshotId: 'failures-snapshot' }),
        { runId: sync.pluginMessage.runId },
      );
      await page.locator('#apply-btn').click();
      await sendPluginMessage(page, 'SYNC_COMPLETE', operationResult(result), { runId: sync.pluginMessage.runId });
    };
    const failed = (index: number) => ({
      bindingId: `t${index}`, layerId: `t${index}`, layerName: 'Title #Title',
      status: 'failed' as const, message: 'Font missing',
    });
    await runSync({
      status: 'failed', success: false, snapshotId: 'failures-snapshot',
      counts: { changed: 0, unchanged: 0, skipped: 0, failed: 3 },
      layersProcessed: 3, layersUpdated: 0,
      errors: [0, 1, 2].map((index) => ({ layerId: `t${index}`, layerName: 'Title #Title', error: 'Font missing' })),
      outcomes: [failed(0), failed(1), failed(2)],
    });
    expect(await page.locator('.outcome-group-header').allTextContents()).toEqual(['▾Title #Title3 failed']);
    expect(await page.locator('.outcome.failed').count()).toBe(3);
    expect(await page.locator('.result-error').count()).toBe(0);

    await page.locator('#result-back-btn').click();
    await runSync({
      status: 'failed', success: false, snapshotId: 'failures-snapshot',
      counts: { changed: 0, unchanged: 0, skipped: 0, failed: 0 },
      layersProcessed: 0, layersUpdated: 0,
      errors: [{ layerId: '', layerName: '', error: 'The sync scope changed during apply.' }],
      outcomes: [],
    });
    expect(await page.locator('.outcome').count()).toBe(0);
    expect(await page.locator('.result-error').allTextContents()).toEqual([
      'The sync scope changed during apply.',
    ]);
  });

  it('keeps partial results actionable through retry, back, and refresh', async () => {
    fixture = await launchPluginBrowser();
    const { page } = fixture;
    await enterPreview(
      page,
      sheetSnapshot({
        id: 'result-snapshot',
        spreadsheetId: 'source-c',
        data: {
          activeWorksheet: 'Sheet1',
          worksheets: [
            worksheetFixture({ name: 'Sheet1', rows: { Title: ['A'] } }),
          ],
        },
      }),
    );
    await page.locator('#sync-preview-btn').click();
    const sync = await lastMessage(page, 'SYNC');
    await sendPluginMessage(
      page,
      'SYNC_COMPLETE',
      operationResult({
        status: 'partial',
        success: false,
        snapshotId: 'result-snapshot',
        counts: { changed: 1, unchanged: 0, skipped: 0, failed: 1 },
        layersProcessed: 2,
        layersUpdated: 1,
        errors: [
          { layerId: 'bad', layerName: 'Bad layer', error: 'Missing font' },
        ],
        outcomes: [
          {
            bindingId: 'ok',
            layerId: 'ok',
            layerName: 'Good layer',
            status: 'changed',
          },
          {
            bindingId: 'bad',
            layerId: 'bad',
            layerName: 'Bad layer',
            status: 'failed',
            message: 'Missing font',
          },
        ],
      }),
      { runId: sync.pluginMessage.runId },
    );
    expect(await page.locator('.result-summary').textContent()).toContain(
      'partial',
    );
    await page.locator('#retry-btn').click();
    expect(
      (await readPluginMessages(page)).some(
        (message) =>
          (message as { pluginMessage?: { type?: string } }).pluginMessage
            ?.type === 'RETRY_FAILED',
      ),
    ).toBe(true);
  });
});
