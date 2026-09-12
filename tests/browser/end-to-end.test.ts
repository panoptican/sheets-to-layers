import { afterEach, describe, expect, it } from 'vitest';
import {
  createMainThreadFixture,
  type MainThreadFixture,
} from '../integration/main-thread-harness';
import {
  createMockFrame,
  createMockPage,
  createMockRectangle,
  createMockText,
} from '../mocks/figma';
import {
  launchPluginBrowser,
  readPluginMessages,
  sendPluginMessage,
  type PluginBrowser,
} from './harness';

const spreadsheetUrl =
  'https://docs.google.com/spreadsheets/d/abcdefghijklmnopqrst/edit';
const workerUrl = 'https://worker.example';
const pngBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

interface Bridge {
  pump: () => Promise<void>;
  waitFor: (predicate: () => Promise<boolean>, timeoutMs?: number) => Promise<void>;
}

function createBridge(
  page: PluginBrowser['page'],
  main: MainThreadFixture,
): Bridge {
  let uiCursor = 0;
  let mainCursor = 0;

  const pump = async (): Promise<void> => {
    const uiMessages = await readPluginMessages(page);
    while (uiCursor < uiMessages.length) {
      const message = (uiMessages[uiCursor++] as { pluginMessage?: unknown }).pluginMessage;
      if (message) await main.sendUiMessage(message);
    }

    while (mainCursor < main.messages.length) {
      const message = main.messages[mainCursor++] as {
        type: string;
        payload?: unknown;
        runId?: string;
      };
      await sendPluginMessage(
        page,
        message.type,
        message.payload,
        message.runId ? { runId: message.runId } : {},
      );
    }
  };

  const waitFor = async (
    predicate: () => Promise<boolean>,
    timeoutMs = 15_000,
  ): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await pump();
      if (await predicate()) return;
      await page.waitForTimeout(20);
    }
    const uiTypes = (await readPluginMessages(page)).map((entry: any) => entry?.pluginMessage?.type);
    const mainTypes = main.messages.map((entry: any) => entry?.type);
    throw new Error(
      `Timed out while driving the UI/main-thread bridge (ui=${JSON.stringify(uiTypes)}, main=${JSON.stringify(mainTypes)}, body=${JSON.stringify((await page.locator('body').innerText()).slice(0, 500))}).`,
    );
  };

  return { pump, waitFor };
}

function settingsStorage(): Map<string, unknown> {
  return new Map([
    ['settings', { workerUrl, allowThirdPartyFallback: false }],
  ]);
}

async function routeWorker(
  browser: PluginBrowser,
  options: {
    values: string[][];
    holdSheets?: boolean;
    onSheetRequest?: () => void;
    onImageRequest?: (url: string) => { status: number; body?: Buffer; contentType: string };
  },
): Promise<{ releaseSheets: () => void }> {
  let releaseSheets!: () => void;
  const sheetsReleased = new Promise<void>((resolve) => {
    releaseSheets = resolve;
  });

  await browser.page.route(`${workerUrl}/**`, async (route) => {
    const requestUrl = new URL(route.request().url());
    const imageUrl = requestUrl.searchParams.get('imageUrl');
    if (imageUrl) {
      const image = options.onImageRequest?.(imageUrl) ?? {
        status: 200,
        body: pngBytes,
        contentType: 'image/png',
      };
      await route.fulfill({
        status: image.status,
        body: image.body,
        contentType: image.contentType,
        headers: { 'Access-Control-Allow-Origin': '*' },
      });
      return;
    }

    options.onSheetRequest?.();
    if (options.holdSheets) await sheetsReleased;

    const tabName = requestUrl.searchParams.get('tabName');
    const isBoldInfo = requestUrl.searchParams.get('boldInfo') === 'true';
    const body = isBoldInfo
      ? { tabName, firstRowBold: options.values[0].map(() => true), firstColBold: [] }
      : tabName
        ? { tabName, values: options.values }
        : { sheets: [{ title: 'Sheet1', sheetId: 0, index: 0 }] };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  });

  return { releaseSheets };
}

async function closeFixture(
  browser: PluginBrowser | null,
  main: MainThreadFixture | null,
): Promise<void> {
  await browser?.browser.close();
  // Let any aborted Worker request settle before the next test starts.
  await main?.flush(2);
}

describe('built UI and main-thread end-to-end boundary', () => {
  let browser: PluginBrowser | null = null;
  let main: MainThreadFixture | null = null;

  afterEach(async () => {
    await closeFixture(browser, main);
    browser = null;
    main = null;
  });

  it('fetches through the Worker, reviews preflight, applies, and shows the terminal result', async () => {
    const text = createMockText('#Title', 'Old value');
    const repeat = createMockFrame(
      'Cards @#',
      [createMockText('#Title', 'Old card 1'), createMockText('#Title', 'Old card 2')],
      [],
      { layoutMode: 'VERTICAL' },
    );
    const page = createMockPage('Page 1', [text, repeat]);
    main = await createMainThreadFixture({ page, text, storage: settingsStorage() });
    browser = await launchPluginBrowser();
    await routeWorker(browser, { values: [['Title'], ['New value']] });
    const bridge = createBridge(browser.page, main);

    await bridge.waitFor(async () => (await browser!.page.locator('#sheets-url').count()) === 1);
    await browser.page.locator('#sheets-url').fill(spreadsheetUrl);
    await browser.page.locator('#fetch-btn').click();
    await bridge.waitFor(async () => (await browser!.page.locator('.preview-mode').count()) === 1);

    await browser.page.locator('#sync-preview-btn').click();
    await bridge.waitFor(async () => (await browser!.page.locator('#apply-btn').count()) === 1);
    expect(await browser.page.locator('.preflight-summary').textContent()).toContain('matched');
    expect(await browser.page.locator('.repeat-change').textContent()).toContain('remove 1');
    expect(repeat.children).toHaveLength(2);

    await browser.page.locator('#apply-btn').click();
    await bridge.waitFor(async () => (await browser!.page.locator('.result-summary').count()) === 1);
    expect(await browser.page.locator('.result-summary').textContent()).toContain('success');
    expect(text.characters).toBe('New value');
    expect(repeat.children).toHaveLength(1);
    expect(main.figma.root.getPluginData('sheets-to-layers:sync-config:v1')).not.toBe('');
  });

  it('cancels a fetch into a visible terminal result without mutating nodes or saved config', async () => {
    const text = createMockText('#Title', 'Old value');
    const page = createMockPage('Page 1', [text]);
    main = await createMainThreadFixture({ page, text, storage: settingsStorage() });
    browser = await launchPluginBrowser();
    let sheetRequestSeen = false;
    await routeWorker(browser, {
      values: [['Title'], ['Never applied']],
      holdSheets: true,
      onSheetRequest: () => { sheetRequestSeen = true; },
    });
    const bridge = createBridge(browser.page, main);

    await bridge.waitFor(async () => (await browser!.page.locator('#sheets-url').count()) === 1);
    await browser.page.locator('#sheets-url').fill(spreadsheetUrl);
    await browser.page.locator('#sync-btn').click();
    await bridge.waitFor(async () => sheetRequestSeen && (await browser!.page.locator('#cancel-sync-btn').count()) === 1);
    await browser.page.locator('#cancel-sync-btn').click();
    await bridge.waitFor(async () => (await browser!.page.locator('.result-summary').count()) === 1);

    expect(await browser.page.locator('.result-summary').textContent()).toContain('cancelled');
    expect(text.characters).toBe('Old value');
    expect(main.figma.root.getPluginData('sheets-to-layers:sync-config:v1')).toBe('');
  }, 30_000);

  it('shows a partial image failure and retries the failed binding', async () => {
    const text = createMockText('#Title', 'Old value');
    const rectangle = createMockRectangle('#Photo');
    const page = createMockPage('Page 1', [text, rectangle]);
    main = await createMainThreadFixture({ page, text, storage: settingsStorage() });
    browser = await launchPluginBrowser();
    let imageAttempts = 0;
    await routeWorker(browser, {
      values: [['Title', 'Photo'], ['New value', 'https://images.example/bad.png']],
      onImageRequest: () => {
        imageAttempts += 1;
        return imageAttempts <= 3
          ? { status: 502, contentType: 'application/json', body: Buffer.from('{"error":"temporary"}') }
          : { status: 200, contentType: 'image/png', body: pngBytes };
      },
    });
    const bridge = createBridge(browser.page, main);

    await bridge.waitFor(async () => (await browser!.page.locator('#sheets-url').count()) === 1);
    await browser.page.locator('#sheets-url').fill(spreadsheetUrl);
    await browser.page.locator('#sync-btn').click();
    await bridge.waitFor(async () => (await browser!.page.locator('#retry-btn').count()) === 1, 10_000);
    expect(await browser.page.locator('.result-summary').textContent()).toContain('partial');
    expect(await browser.page.locator('.result-error').count()).toBeGreaterThan(0);
    expect(text.characters).toBe('New value');

    await browser.page.locator('#retry-btn').click();
    await bridge.waitFor(async () => (await browser!.page.locator('.result-summary').count()) === 1 && imageAttempts === 4, 10_000);
    expect(await browser.page.locator('.result-summary').textContent()).toContain('success');
    expect(imageAttempts).toBe(4);
  }, 30_000);
});
