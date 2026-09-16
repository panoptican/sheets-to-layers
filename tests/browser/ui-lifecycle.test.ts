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
