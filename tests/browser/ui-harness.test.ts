import { afterEach, describe, expect, it } from 'vitest';
import type { Page } from 'playwright';
import {
  clearPluginMessages,
  launchPluginBrowser,
  readPluginMessages,
  sendPluginMessage,
  type PluginBrowser,
} from './harness';

async function chooseDropdown(
  page: Page,
  dropdownId: string,
  value: string,
): Promise<void> {
  await page.locator(`#${dropdownId}`).click();
  // The UI3 dropdown closes and unmounts its menu as soon as an option is
  // chosen, so click the transient radio option without waiting for its
  // checked state to persist in the DOM.
  await page.locator(`input[type="radio"][value="${value}"]`).last().click();
}

async function waitForSettings(page: Page): Promise<void> {
  await page.getByRole('dialog', { name: 'Data settings' }).waitFor();
}

describe('built plugin UI browser harness', () => {
  let fixture: PluginBrowser | null = null;

  afterEach(async () => {
    await fixture?.browser.close();
    fixture = null;
  });

  it('renders UI3 controls with Figma theme styles and visible labels', async () => {
    fixture = await launchPluginBrowser();
    const { page } = fixture;

    const appearance = await page.evaluate(() => {
      const body = getComputedStyle(document.body);
      const container = getComputedStyle(
        document.querySelector<HTMLElement>('.plugin-container')!,
      );
      const primary = getComputedStyle(
        document.querySelector<HTMLElement>('#sync-btn')!,
      );

      return {
        bodyBackground: body.backgroundColor,
        containerBackground: container.backgroundColor,
        primaryBackground: primary.backgroundColor,
        injectedStyleCount: document.head.querySelectorAll('style[id]').length,
      };
    });

    expect(appearance.bodyBackground).toBe('rgb(255, 255, 255)');
    expect(appearance.containerBackground).not.toBe('rgb(255, 205, 41)');
    expect(appearance.primaryBackground).toBe('rgb(13, 153, 255)');
    expect(appearance.injectedStyleCount).toBeGreaterThan(1);
    await page.locator('#plugin-title').waitFor({ state: 'visible' });
    await page.getByText('Google Sheets URL', { exact: true }).waitFor();
    await page.locator('#sheets-url').waitFor({ state: 'visible' });
    await page.getByText('Sync scope', { exact: true }).waitFor();
    await page.getByText('Entire document', { exact: true }).waitFor();
    await page.getByText('Current page', { exact: true }).waitFor();
    await page.locator('#fetch-btn').waitFor({ state: 'visible' });
    await page.locator('#sync-btn').waitFor({ state: 'visible' });
    expect(await page.locator('#fetch-btn').textContent()).toContain('Fetch');
    expect(await page.locator('#sync-btn').textContent()).toContain(
      'Fetch & Sync',
    );
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
      },
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
    const settingsUpdate = (await readPluginMessages(page)).find(
      (message) =>
        (message as { pluginMessage?: { type?: string } }).pluginMessage
          ?.type === 'UPDATE_PREFLIGHT_SETTINGS',
    ) as {
      pluginMessage: {
        runId: string;
        payload: {
          snapshotId: string;
          preflightId: string;
          preferences: { blankText: string };
        };
      };
    };
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
      {
        preflightId: 'preflight-2',
        snapshotId: 'preflight-snapshot',
        sourceUrl: 'https://docs.google.com/spreadsheets/d/source-b/edit',
        scope: 'page',
        rootIds: [],
        defaultWorksheet: 'Sheet1',
        preferences: { orientations: {}, blankText: 'leave-unchanged' },
        totalBindings: 1,
        matchedBindings: 0,
        requiresConfirmation: true,
        repeats: [],
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
        sourceUrl: 'https://docs.google.com/spreadsheets/d/cancel-applied/edit',
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
          document
            .elementFromPoint(
              rect.left + rect.width / 2,
              rect.top + rect.height / 2,
            )
            ?.closest('.value-cell') === cell
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

  it('aborts stalled Worker image bodies after bounded retries without an unhandled rejection', async () => {
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
        (
          window as unknown as { __unhandledImageErrors: string[] }
        ).__unhandledImageErrors.push(String(event.reason));
      });
      window.fetch = async (input, init) => {
        const requestUrl = new URL(String(input));
        if (
          requestUrl.searchParams.get('imageUrl') !==
          'https://images.example/stalled.png'
        )
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
    // Advance each deadline and backoff separately so promise continuations can
    // schedule the next retry against the fake clock.
    await page.clock.fastForward(15_000);
    await page.clock.fastForward(250);
    await page.clock.fastForward(15_000);
    await page.clock.fastForward(500);
    await page.clock.fastForward(15_000);
    await page.waitForFunction(() =>
      (
        window as unknown as {
          __pluginMessages: Array<{
            pluginMessage?: { type?: string; payload?: { error?: string } };
          }>;
        }
      ).__pluginMessages.some(
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
    expect(
      await page.getByRole('button', { name: 'Back' }).locator('svg').count(),
    ).toBe(1);
    expect(await page.locator('#default-worksheet').count()).toBe(0);
    await page.locator('#preview-settings-btn').click();
    await waitForSettings(page);
    expect(
      await page.getByRole('dialog', { name: 'Data settings' }).isVisible(),
    ).toBe(true);
    expect(await page.locator('#preview-settings-close-btn svg').count()).toBe(
      1,
    );
    const dropdowns = page.locator(
      '#default-worksheet, #orientation-select, #blank-text-policy',
    );
    expect(await dropdowns.count()).toBe(3);
    expect(
      await dropdowns.evaluateAll((nodes) =>
        nodes.every(
          (node) =>
            node.tagName === 'DIV' && node.getAttribute('tabindex') === '0',
        ),
      ),
    ).toBe(true);
    expect(await dropdowns.locator('svg').count()).toBe(3);
    expect(await page.locator('#worker-url').count()).toBe(0);
    expect(await page.locator('#allow-third-party-fallback').count()).toBe(0);
    expect(await page.locator('#default-worksheet').textContent()).toBe(
      'Products',
    );
    await chooseDropdown(page, 'default-worksheet', 'Archive');
    await page.locator('#preview-settings-cancel-btn').click();
    await page.locator('#preview-settings-btn').click();
    await waitForSettings(page);
    expect(await page.locator('#default-worksheet').textContent()).toBe(
      'Products',
    );
    await chooseDropdown(page, 'default-worksheet', 'Archive');
    await page.locator('#preview-settings-save-btn').click();
    await page.getByRole('tab', { name: 'Matrix' }).click();
    await page.locator('#preview-settings-btn').click();
    await waitForSettings(page);
    await chooseDropdown(page, 'orientation-select', 'rows');
    await page.locator('#preview-settings-save-btn').click();
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

  it('dismisses data settings without applying changes and restores focus', async () => {
    fixture = await launchPluginBrowser();
    const { page } = fixture;
    await page
      .locator('#sheets-url')
      .fill('https://docs.google.com/spreadsheets/d/modal-settings/edit');
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
          id: 'modal-settings-snapshot',
          sourceUrl:
            'https://docs.google.com/spreadsheets/d/modal-settings/edit',
          spreadsheetId: 'modal-settings',
          fetchedAt: Date.now(),
          preferences: {
            orientations: {},
            blankText: 'clear-and-hide',
            defaultWorksheet: 'Sheet1',
          },
          data: {
            activeWorksheet: 'Sheet1',
            worksheets: [
              {
                name: 'Sheet1',
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
            ],
          },
        },
      },
      { runId: fetch.pluginMessage.runId },
    );

    expect(await page.locator('.table-pagination').count()).toBe(0);
    expect(await page.locator('#bind-worksheet-btn').count()).toBe(0);
    await sendPluginMessage(page, 'SELECTION_CHANGED', {
      hasSelection: true,
    });
    expect(await page.locator('#bind-worksheet-btn').count()).toBe(0);
    const archiveTab = page.getByRole('tab', { name: 'Archive' });
    await archiveTab.click();
    expect(await page.locator('#bind-worksheet-btn').textContent()).toBe(
      'Use Archive for selected layers',
    );
    const tabLayout = await archiveTab.evaluate((tab) => {
      const strip = tab.parentElement!;
      const tabRect = tab.getBoundingClientRect();
      const stripRect = strip.getBoundingClientRect();
      return {
        overflowY: getComputedStyle(strip).overflowY,
        scrollHeight: strip.scrollHeight,
        clientHeight: strip.clientHeight,
        tabTop: tabRect.top,
        tabBottom: tabRect.bottom,
        stripTop: stripRect.top,
        stripBottom: stripRect.bottom,
      };
    });
    expect(tabLayout.overflowY).toBe('hidden');
    expect(tabLayout.scrollHeight).toBe(tabLayout.clientHeight);
    expect(tabLayout.tabTop).toBeGreaterThanOrEqual(tabLayout.stripTop);
    expect(tabLayout.tabBottom).toBeLessThanOrEqual(tabLayout.stripBottom);

    await page.locator('#preview-settings-btn').click();
    await waitForSettings(page);
    expect(
      await page
        .locator('#default-worksheet')
        .evaluate((node) => node === document.activeElement),
    ).toBe(true);
    await chooseDropdown(page, 'blank-text-policy', 'leave-unchanged');
    await page.keyboard.press('Escape');
    expect(await page.getByRole('dialog').count()).toBe(0);
    expect(
      await page
        .locator('#preview-settings-btn')
        .evaluate((node) => node === document.activeElement),
    ).toBe(true);

    await page.locator('#preview-settings-btn').click();
    await waitForSettings(page);
    expect(await page.locator('#blank-text-policy').textContent()).toBe(
      'Clear and hide blank text',
    );
    await page.locator('#preview-settings-dialog + div').click({
      position: { x: 2, y: 2 },
    });
    expect(await page.getByRole('dialog').count()).toBe(0);

    await page.locator('#preview-settings-btn').click();
    await waitForSettings(page);
    await chooseDropdown(page, 'default-worksheet', 'Archive');
    await page.locator('#preview-settings-save-btn').click();
    expect(await page.locator('#bind-worksheet-btn').count()).toBe(0);
  });

  it('keeps data settings contextual to a fetched sheet', async () => {
    fixture = await launchPluginBrowser();
    const { page } = fixture;
    await sendPluginMessage(page, 'INIT', { hasSelection: false });
    expect(await page.locator('#settings-btn').count()).toBe(0);
    expect(await page.locator('#preview-settings-btn').count()).toBe(0);
    expect(await page.locator('#worker-url').count()).toBe(0);
    expect(await page.locator('#allow-third-party-fallback').count()).toBe(0);
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
    expect(await page.locator('.pagination-label').textContent()).toBe(
      'Rows 1–100 of 10,000',
    );
    expect(
      await page
        .locator(
          '.table-pagination button[id$="-prev-btn"] svg, .table-pagination button[id$="-next-btn"] svg',
        )
        .count(),
    ).toBe(2);
    const stripStyles = await page.evaluate(() => {
      const pagination = getComputedStyle(
        document.querySelector<HTMLElement>('.table-pagination')!,
      );
      const body = getComputedStyle(document.body);
      const worksheetBar = getComputedStyle(
        document.querySelector<HTMLElement>('.worksheet-bar')!,
      );
      return {
        paginationBackground: pagination.backgroundColor,
        bodyBackground: body.backgroundColor,
        worksheetPadding: [
          worksheetBar.paddingTop,
          worksheetBar.paddingRight,
          worksheetBar.paddingBottom,
          worksheetBar.paddingLeft,
        ],
      };
    });
    expect(stripStyles.paginationBackground).toBe(stripStyles.bodyBackground);
    expect(new Set(stripStyles.worksheetPadding).size).toBe(1);
    await page.locator('#row-next-btn').press('Enter');
    expect(await page.locator('.index-cell').first().textContent()).toBe('101');
    expect(await page.locator('.pagination-label').textContent()).toBe(
      'Rows 101–200 of 10,000',
    );
    await page.getByRole('tab', { name: 'Wide' }).click();
    expect(
      await page.locator('.preview-table .value-cell').count(),
    ).toBeLessThanOrEqual(2000);
    expect(await page.locator('.pagination-label').allTextContents()).toEqual([
      'Rows 1–100 of 1,000',
      'Columns 1–20 of 40',
    ]);
    await page.locator('#column-next-btn').click();
    expect(await page.locator('.clickable-header').first().textContent()).toBe(
      'Column 21',
    );
    expect(await page.locator('.pagination-label').nth(1).textContent()).toBe(
      'Columns 21–40 of 40',
    );
    const firstTab = page.getByRole('tab').first();
    await firstTab.focus();
    await firstTab.press('End');
    expect(
      await page.getByRole('tab').last().getAttribute('aria-selected'),
    ).toBe('true');
  });
});
