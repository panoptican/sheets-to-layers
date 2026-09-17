import { afterEach, describe, expect, it } from 'vitest';
import {
  clearPluginMessages,
  launchPluginBrowser,
  readPluginMessages,
  sendPluginMessage,
  type PluginBrowser,
} from './harness';
import { lastMessage } from './fixtures';

describe('built plugin UI images', () => {
  let fixture: PluginBrowser | null = null;
  afterEach(async () => {
    await fixture?.browser.close();
    fixture = null;
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
    const start = await lastMessage(page, 'FETCH_AND_SYNC');
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
    const start = await lastMessage(page, 'FETCH_AND_SYNC');
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
});
