import { afterEach, describe, expect, it } from 'vitest';
import {
  clearPluginMessages,
  launchPluginBrowser,
  readPluginMessages,
  sendPluginMessage,
  type PluginBrowser,
} from './harness';

describe('built plugin UI browser harness', () => {
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
    const messages = await readPluginMessages(page);
    const start = messages.find(
      (message) =>
        (message as { pluginMessage?: { type?: string } }).pluginMessage
          ?.type === 'FETCH_AND_SYNC',
    ) as { pluginMessage: { runId: string } };
    await page.locator('#cancel-sync-btn').click();
    expect(await readPluginMessages(page)).toContainEqual({
      pluginMessage: { type: 'CANCEL_SYNC', runId: start.pluginMessage.runId },
    });
    await sendPluginMessage(
      page,
      'FETCH_SUCCESS',
      {
        snapshot: {
          id: 'late-snapshot',
          sourceUrl: 'https://docs.google.com/spreadsheets/d/source-a/edit',
          spreadsheetId: 'source-a',
          fetchedAt: Date.now(),
          preferences: { orientations: {}, blankText: 'clear-and-hide' },
          data: {
            activeWorksheet: 'Sheet1',
            worksheets: [
              {
                name: 'Sheet1',
                labels: ['Title'],
                rows: { Title: ['Late'] },
                orientation: 'columns',
              },
            ],
          },
        },
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
      {
        status: 'cancelled',
        success: false,
        snapshotId: 'late-snapshot',
        counts: { changed: 0, unchanged: 2, skipped: 1, failed: 0 },
        layersProcessed: 3,
        layersUpdated: 0,
        warnings: ['Cancelled before changes were made.'],
        errors: [],
        outcomes: [],
      },
      { runId: start.pluginMessage.runId },
    );
    expect(await page.locator('.result-summary').textContent()).toContain(
      'cancelled: 0 changed, 2 unchanged, 1 skipped, 0 failed.',
    );
  });

  it('requires an explicit exclusion before applying a blocking preflight issue', async () => {
    fixture = await launchPluginBrowser();
    const { page } = fixture;
    await page
      .locator('#sheets-url')
      .fill('https://docs.google.com/spreadsheets/d/source-b/edit');
    await page.locator('#fetch-btn').click();
    const fetch = (await readPluginMessages(page)).find(
      (message) =>
        (message as { pluginMessage?: { type?: string } }).pluginMessage
          ?.type === 'FETCH',
    ) as { pluginMessage: { runId: string } };
    await sendPluginMessage(
      page,
      'FETCH_SUCCESS',
      {
        snapshot: {
          id: 'preflight-snapshot',
          sourceUrl: 'https://docs.google.com/spreadsheets/d/source-b/edit',
          spreadsheetId: 'source-b',
          fetchedAt: Date.now(),
          preferences: { orientations: {}, blankText: 'clear-and-hide' },
          data: {
            activeWorksheet: 'Sheet1',
            worksheets: [
              {
                name: 'Sheet1',
                labels: ['Title'],
                rows: { Title: ['A'] },
                orientation: 'columns',
              },
            ],
          },
        },
      },
      { runId: fetch.pluginMessage.runId },
    );
    await page.locator('#sync-preview-btn').click();
    const sync = (await readPluginMessages(page))
      .filter(
        (message) =>
          (message as { pluginMessage?: { type?: string } }).pluginMessage
            ?.type === 'SYNC',
      )
      .at(-1) as { pluginMessage: { runId: string } };
    await sendPluginMessage(
      page,
      'PREFLIGHT',
      {
        preflightId: 'preflight-1',
        snapshotId: 'preflight-snapshot',
        sourceUrl: 'https://docs.google.com/spreadsheets/d/source-b/edit',
        scope: 'page',
        rootIds: [],
        defaultWorksheet: 'Sheet1',
        preferences: { orientations: {}, blankText: 'clear-and-hide' },
        totalBindings: 1,
        matchedBindings: 0,
        requiresConfirmation: true,
        repeats: [
          {
            layerId: 'repeat-1',
            layerName: 'Cards',
            worksheet: 'Sheet1',
            currentCount: 2,
            targetCount: 1,
            additions: 0,
            removals: 1,
            removeIds: ['child-2'],
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
      },
      { runId: sync.pluginMessage.runId },
    );
    expect(await page.locator('#apply-btn').isDisabled()).toBe(true);
    expect(await page.locator('.repeat-change').textContent()).toContain(
      'child-2',
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
    await page.locator('[data-issue-id="missing-title"]').check();
    expect(await page.locator('#apply-btn').isDisabled()).toBe(false);
    await page.locator('#apply-btn').click();
    expect(await readPluginMessages(page)).toContainEqual({
      pluginMessage: {
        type: 'APPLY',
        runId: sync.pluginMessage.runId,
        payload: {
          snapshotId: 'preflight-snapshot',
          preflightId: 'preflight-1',
          excludedIssueIds: ['missing-title'],
        },
      },
    });
  });

  it('shows counts and outcomes when an applied sync completes after cancellation', async () => {
    fixture = await launchPluginBrowser();
    const { page } = fixture;
    await page
      .locator('#sheets-url')
      .fill('https://docs.google.com/spreadsheets/d/cancel-applied/edit');
    await page.locator('#fetch-btn').click();
    const fetch = (await readPluginMessages(page)).find(
      (message) =>
        (message as { pluginMessage?: { type?: string } }).pluginMessage
          ?.type === 'FETCH',
    ) as { pluginMessage: { runId: string } };
    await sendPluginMessage(
      page,
      'FETCH_SUCCESS',
      {
        snapshot: {
          id: 'cancel-applied-snapshot',
          sourceUrl:
            'https://docs.google.com/spreadsheets/d/cancel-applied/edit',
          spreadsheetId: 'cancel-applied',
          fetchedAt: Date.now(),
          preferences: { orientations: {}, blankText: 'clear-and-hide' },
          data: {
            activeWorksheet: 'Sheet1',
            worksheets: [
              {
                name: 'Sheet1',
                labels: ['Title'],
                rows: { Title: ['A'] },
                orientation: 'columns',
              },
            ],
          },
        },
      },
      { runId: fetch.pluginMessage.runId },
    );
    await page.locator('#sync-preview-btn').click();
    const sync = (await readPluginMessages(page))
      .filter(
        (message) =>
          (message as { pluginMessage?: { type?: string } }).pluginMessage
            ?.type === 'SYNC',
      )
      .at(-1) as { pluginMessage: { runId: string } };
    await sendPluginMessage(
      page,
      'PREFLIGHT',
      {
        preflightId: 'cancel-applied-preflight',
        snapshotId: 'cancel-applied-snapshot',
        sourceUrl:
          'https://docs.google.com/spreadsheets/d/cancel-applied/edit',
        scope: 'selection',
        rootIds: ['root-a'],
        defaultWorksheet: 'Sheet1',
        preferences: { orientations: {}, blankText: 'clear-and-hide' },
        totalBindings: 1,
        matchedBindings: 1,
        requiresConfirmation: true,
        repeats: [],
        issues: [],
      },
      { runId: sync.pluginMessage.runId },
    );
    await page.locator('#apply-btn').click();
    await page.locator('#cancel-sync-btn').click();
    await sendPluginMessage(
      page,
      'SYNC_COMPLETE',
      {
        status: 'partial',
        success: false,
        snapshotId: 'cancel-applied-snapshot',
        counts: { changed: 1, unchanged: 1, skipped: 1, failed: 1 },
        layersProcessed: 4,
        layersUpdated: 1,
        warnings: ['Cancelled after one completed change.'],
        errors: [{ layerId: 'failed', layerName: 'Failed', error: 'Timed out' }],
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
      },
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
    await page
      .locator('#sheets-url')
      .fill('https://docs.google.com/spreadsheets/d/source-c/edit');
    await page.locator('#fetch-btn').click();
    const fetch = (await readPluginMessages(page)).find(
      (message) =>
        (message as { pluginMessage?: { type?: string } }).pluginMessage
          ?.type === 'FETCH',
    ) as { pluginMessage: { runId: string } };
    await sendPluginMessage(
      page,
      'FETCH_SUCCESS',
      {
        snapshot: {
          id: 'result-snapshot',
          sourceUrl: 'https://docs.google.com/spreadsheets/d/source-c/edit',
          spreadsheetId: 'source-c',
          fetchedAt: Date.now(),
          preferences: { orientations: {}, blankText: 'clear-and-hide' },
          data: {
            activeWorksheet: 'Sheet1',
            worksheets: [
              {
                name: 'Sheet1',
                labels: ['Title'],
                rows: { Title: ['A'] },
                orientation: 'columns',
              },
            ],
          },
        },
      },
      { runId: fetch.pluginMessage.runId },
    );
    await page.locator('#sync-preview-btn').click();
    const sync = (await readPluginMessages(page))
      .filter(
        (message) =>
          (message as { pluginMessage?: { type?: string } }).pluginMessage
            ?.type === 'SYNC',
      )
      .at(-1) as { pluginMessage: { runId: string } };
    await sendPluginMessage(
      page,
      'SYNC_COMPLETE',
      {
        status: 'partial',
        success: false,
        snapshotId: 'result-snapshot',
        counts: { changed: 1, unchanged: 0, skipped: 0, failed: 1 },
        layersProcessed: 2,
        layersUpdated: 1,
        warnings: [],
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
      },
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

  it('loads the built UI and round-trips host messages through the real DOM', async () => {
    fixture = await launchPluginBrowser();
    const { page } = fixture;

    expect(await page.locator('#plugin-title').textContent()).toBe(
      'Sheets to Layers',
    );
    expect(await readPluginMessages(page)).toContainEqual({
      pluginMessage: { type: 'UI_READY' },
    });

    await clearPluginMessages(page);
    await page
      .locator('#sheets-url')
      .fill('https://docs.google.com/spreadsheets/d/test/edit');
    await page.locator('#fetch-btn').click();
    const fetchMessage = (await readPluginMessages(page)).find(
      (message) =>
        (message as { pluginMessage?: { type?: string } }).pluginMessage
          ?.type === 'FETCH',
    ) as { pluginMessage: { runId: string } };
    const runId = 'browser-harness-run';
    await sendPluginMessage(
      page,
      'FETCH_SUCCESS',
      {
        snapshot: {
          id: 'snapshot-harness',
          sourceUrl: 'https://docs.google.com/spreadsheets/d/test/edit',
          spreadsheetId: 'test',
          fetchedAt: Date.now(),
          preferences: { orientations: {}, blankText: 'clear-and-hide' },
          data: {
            activeWorksheet: 'Sheet 1',
            worksheets: [
              {
                name: 'Sheet 1',
                labels: ['Title'],
                rows: { Title: ['Hello'] },
                orientation: 'columns',
              },
            ],
          },
        },
      },
      { runId: fetchMessage.pluginMessage.runId },
    );

    await page.locator('.preview-mode').waitFor({ state: 'visible' });
    expect((await page.locator('.clickable-header').innerText()).trim()).toBe(
      'Title',
    );
    expect(await readPluginMessages(page)).toContainEqual({
      pluginMessage: {
        type: 'RESIZE_WINDOW',
        payload: { width: 960, height: 600 },
      },
    });
  });

  it('keeps preview value cells visible above the tabs and footer at 720 by 320', async () => {
    fixture = await launchPluginBrowser();
    const { page } = fixture;
    await page.setViewportSize({ width: 720, height: 320 });
    await page
      .locator('#sheets-url')
      .fill('https://docs.google.com/spreadsheets/d/compact-preview/edit');
    await page.locator('#fetch-btn').click();
    const fetch = (await readPluginMessages(page)).find(
      (message) =>
        (message as { pluginMessage?: { type?: string } }).pluginMessage
          ?.type === 'FETCH',
    ) as { pluginMessage: { runId: string } };
    await sendPluginMessage(
      page,
      'FETCH_SUCCESS',
      {
        snapshot: {
          id: 'compact-preview-snapshot',
          sourceUrl:
            'https://docs.google.com/spreadsheets/d/compact-preview/edit',
          spreadsheetId: 'compact-preview',
          fetchedAt: Date.now(),
          preferences: { orientations: {}, blankText: 'clear-and-hide' },
          data: {
            activeWorksheet: 'Sheet1',
            worksheets: [
              {
                name: 'Sheet1',
                labels: ['Title'],
                rows: { Title: ['Visible first row', 'Visible second row'] },
                orientation: 'columns',
              },
            ],
          },
        },
      },
      { runId: fetch.pluginMessage.runId },
    );
    const secondValue = page.locator('.preview-table .value-cell').nth(1);
    await secondValue.waitFor({ state: 'visible' });
    expect(
      await secondValue.evaluate((cell) => {
        const rect = cell.getBoundingClientRect();
        return (
          rect.top >= 0 &&
          rect.bottom <= window.innerHeight &&
          document.elementFromPoint(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2,
          )?.closest('.value-cell') === cell
        );
      }),
    ).toBe(true);
  });

  it('settles deduplicated Worker image requests without exceeding the shared image limit', async () => {
    fixture = await launchPluginBrowser();
    const { page } = fixture;
    let inFlight = 0;
    let peak = 0;
    let requests = 0;
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await page.route(
      'https://sheets-proxy.spidleweb.workers.dev/**',
      async (route) => {
        requests++;
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 20));
        inFlight--;
        await route.fulfill({
          status: 200,
          contentType: 'image/png',
          body: png,
        });
      },
    );

    await page
      .locator('#sheets-url')
      .fill('https://docs.google.com/spreadsheets/d/images/edit');
    await page.locator('#sync-btn').click();
    const start = (await readPluginMessages(page)).find(
      (message) =>
        (message as { pluginMessage?: { type?: string } }).pluginMessage
          ?.type === 'FETCH_AND_SYNC',
    ) as { pluginMessage: { runId: string } };
    const runId = start.pluginMessage.runId;
    await clearPluginMessages(page);
    const urls = Array.from(
      { length: 8 },
      (_, index) => `https://images.example/${index}.png`,
    );
    const identities = [...urls, urls[0], urls[0], urls[0]];
    await Promise.all(
      identities.map((url, index) =>
        sendPluginMessage(
          page,
          'REQUEST_IMAGE_FETCH',
          {
            requestId: `image-${index}`,
            nodeId: `node-${index}`,
            url,
          },
          { runId },
        ),
      ),
    );
    await page.waitForFunction(
      (expected) => {
        const messages = (
          window as unknown as {
            __pluginMessages: Array<{ pluginMessage?: { type?: string } }>;
          }
        ).__pluginMessages;
        return (
          messages.filter(
            (message) => message.pluginMessage?.type === 'IMAGE_DATA',
          ).length === expected
        );
      },
      identities.length,
      { timeout: 10_000 },
    );

    const responses = (await readPluginMessages(page)).filter(
      (message) =>
        (message as { pluginMessage?: { type?: string } }).pluginMessage
          ?.type === 'IMAGE_DATA',
    );
    expect(responses).toHaveLength(identities.length);
    expect(requests).toBe(8);
    expect(peak).toBeLessThanOrEqual(4);
  }, 15_000);

  it('aborts a stalled direct-image body at the 15-second deadline without an unhandled rejection', async () => {
    fixture = await launchPluginBrowser();
    const { page } = fixture;
    const pageErrors: Error[] = [];
    page.on('pageerror', (error) => pageErrors.push(error));
    await page.clock.install({ time: new Date('2026-09-12T12:00:00Z') });
    await page.evaluate(() => {
      const originalFetch = window.fetch.bind(window);
      Object.defineProperty(window, '__unhandledImageErrors', {
        configurable: true,
        value: [],
      });
      window.addEventListener('unhandledrejection', (event) => {
        (window as unknown as { __unhandledImageErrors: string[] })
          .__unhandledImageErrors.push(String(event.reason));
      });
      window.fetch = async (input, init) => {
        if (String(input) !== 'https://images.example/stalled.png')
          return originalFetch(input, init);
        return new Response(
          new ReadableStream<Uint8Array>({
            pull: () => new Promise<void>(() => undefined),
            cancel: () => Promise.reject(new Error('stream cleanup failed')),
          }),
          { headers: { 'content-type': 'image/png' } },
        );
      };
    });
    await sendPluginMessage(page, 'INIT', {
      hasSelection: false,
      settings: { workerUrl: '', allowThirdPartyFallback: false },
    });
    await page
      .locator('#sheets-url')
      .fill('https://docs.google.com/spreadsheets/d/stalled-image/edit');
    await page.locator('#sync-btn').click();
    const start = (await readPluginMessages(page)).find(
      (message) =>
        (message as { pluginMessage?: { type?: string } }).pluginMessage
          ?.type === 'FETCH_AND_SYNC',
    ) as { pluginMessage: { runId: string } };
    await sendPluginMessage(
      page,
      'REQUEST_IMAGE_FETCH',
      {
        requestId: 'stalled-image',
        nodeId: 'image-node',
        url: 'https://images.example/stalled.png',
      },
      { runId: start.pluginMessage.runId },
    );
    await page.clock.fastForward(15_000);
    await page.waitForFunction(
      () =>
        (window as unknown as {
          __pluginMessages: Array<{
            pluginMessage?: { type?: string; payload?: { error?: string } };
          }>;
        }).__pluginMessages.some(
          (message) =>
            message.pluginMessage?.type === 'IMAGE_FETCH_ERROR' &&
            message.pluginMessage.payload?.error?.includes(
              'timed out after 15 seconds',
            ),
        ),
    );
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { __unhandledImageErrors: string[] })
            .__unhandledImageErrors,
      ),
    ).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  it('keeps the sync default separate from the worksheet being browsed and reorients raw preview data locally', async () => {
    fixture = await launchPluginBrowser();
    const { page } = fixture;
    await page
      .locator('#sheets-url')
      .fill('https://docs.google.com/spreadsheets/d/preferences/edit');
    await page.locator('#fetch-btn').click();
    const fetch = (await readPluginMessages(page)).find(
      (message) =>
        (message as { pluginMessage?: { type?: string } }).pluginMessage
          ?.type === 'FETCH',
    ) as { pluginMessage: { runId: string } };
    await sendPluginMessage(
      page,
      'FETCH_SUCCESS',
      {
        snapshot: {
          id: 'preferences-snapshot',
          sourceUrl: 'https://docs.google.com/spreadsheets/d/preferences/edit',
          spreadsheetId: 'preferences',
          fetchedAt: Date.now(),
          preferences: {
            orientations: {},
            blankText: 'clear-and-hide',
            defaultWorksheet: 'Products',
          },
          data: {
            activeWorksheet: 'Products',
            worksheets: [
              {
                name: 'Products',
                labels: ['Title'],
                rows: { Title: ['A'] },
                orientation: 'columns',
                rawData: [['Title'], ['A']],
              },
              {
                name: 'Archive',
                labels: ['Title'],
                rows: { Title: ['Old'] },
                orientation: 'columns',
                rawData: [['Title'], ['Old']],
              },
              {
                name: 'Matrix',
                labels: ['Name', 'Ada'],
                rows: { Name: ['Ada'], Ada: ['Grace'] },
                orientation: 'columns',
                rawData: [
                  ['Name', 'Ada'],
                  ['Grace', 'Hopper'],
                ],
              },
            ],
          },
        },
      },
      { runId: fetch.pluginMessage.runId },
    );
    await page.getByRole('tab', { name: 'Archive' }).click();
    expect(await page.locator('#default-worksheet').inputValue()).toBe(
      'Products',
    );
    await page.locator('#default-worksheet').selectOption('Archive');
    expect(await page.locator('#default-worksheet').inputValue()).toBe(
      'Archive',
    );
    await page.getByRole('tab', { name: 'Matrix' }).click();
    await page.locator('#orientation-select').selectOption('rows');
    expect(await page.locator('.clickable-header').first().textContent()).toBe(
      'Name',
    );
    expect(await page.locator('.clickable-header').nth(1).textContent()).toBe(
      'Grace',
    );
    expect(
      (await readPluginMessages(page)).filter(
        (message) =>
          (message as { pluginMessage?: { type?: string } }).pluginMessage
            ?.type === 'FETCH',
      ),
    ).toHaveLength(1);
  });

  it('restores settings with third-party fallback off and validates settings saves', async () => {
    fixture = await launchPluginBrowser();
    const { page } = fixture;
    await sendPluginMessage(page, 'INIT', {
      hasSelection: false,
      settings: {
        workerUrl: 'https://worker.example/path',
        allowThirdPartyFallback: false,
      },
    });
    await page.locator('#settings-btn').click();
    expect(await page.locator('#worker-url').inputValue()).toBe(
      'https://worker.example/path',
    );
    expect(await page.locator('#allow-third-party-fallback').isChecked()).toBe(
      false,
    );
    await page.locator('#allow-third-party-fallback').check();
    await page.locator('#settings-save-btn').click();
    expect(await readPluginMessages(page)).toContainEqual({
      pluginMessage: {
        type: 'SAVE_SETTINGS',
        payload: {
          settings: {
            workerUrl: 'https://worker.example/path',
            allowThirdPartyFallback: true,
          },
        },
      },
    });
  });

  it('bounds tall and wide previews within the message and render limits', async () => {
    fixture = await launchPluginBrowser();
    const { page } = fixture;
    const wideLabels = Array.from(
      { length: 40 },
      (_, index) => `Column ${index + 1}`,
    );
    const wideValues = Object.fromEntries(
      wideLabels.map((label, index) => [
        label,
        Array.from({ length: 1_000 }, (_, row) => `${index}:${row}`),
      ]),
    );
    await page
      .locator('#sheets-url')
      .fill('https://docs.google.com/spreadsheets/d/large/edit');
    await page.locator('#fetch-btn').click();
    const fetch = (await readPluginMessages(page)).find(
      (message) =>
        (message as { pluginMessage?: { type?: string } }).pluginMessage
          ?.type === 'FETCH',
    ) as { pluginMessage: { runId: string } };
    await sendPluginMessage(
      page,
      'FETCH_SUCCESS',
      {
        snapshot: {
          id: 'large-snapshot',
          sourceUrl: 'https://docs.google.com/spreadsheets/d/large/edit',
          spreadsheetId: 'large',
          fetchedAt: Date.now(),
          preferences: { orientations: {}, blankText: 'clear-and-hide' },
          data: {
            activeWorksheet: 'Tall',
            worksheets: [
              {
                name: 'Tall',
                labels: ['Title'],
                rows: {
                  Title: Array.from(
                    { length: 10_000 },
                    (_, row) => `Title ${row}`,
                  ),
                },
                orientation: 'columns',
              },
              {
                name: 'Wide',
                labels: wideLabels,
                rows: wideValues,
                orientation: 'columns',
              },
            ],
          },
        },
      },
      { runId: fetch.pluginMessage.runId },
    );
    expect(await page.locator('.preview-table tbody tr').count()).toBe(100);
    expect(
      await page.locator('.preview-table .value-cell').count(),
    ).toBeLessThanOrEqual(2000);
    await page.locator('#row-next-btn').press('Enter');
    expect(await page.locator('.index-cell').first().textContent()).toBe('101');
    await page.getByRole('tab', { name: 'Wide' }).click();
    expect(
      await page.locator('.preview-table .value-cell').count(),
    ).toBeLessThanOrEqual(2000);
    await page.locator('#column-next-btn').click();
    expect(await page.locator('.clickable-header').first().textContent()).toBe(
      'Column 21',
    );
    const firstTab = page.getByRole('tab').first();
    await firstTab.focus();
    await firstTab.press('End');
    expect(
      await page.getByRole('tab').last().getAttribute('aria-selected'),
    ).toBe('true');
  });
});
