import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const projectRoot = process.cwd();
const uiHtmlPath = path.join(projectRoot, 'dist', 'ui.html');
const figmaThemeCssPath = path.join(
  projectRoot,
  'node_modules',
  '@create-figma-plugin',
  'ui',
  'lib',
  'css',
  'theme.css',
);

export interface PluginBrowser {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

interface BrowserOptions {
  /** Override the executable path for debugging or CI. */
  executablePath?: string;
}

/**
 * Resolve the Playwright headless shell recommended by the local macOS
 * browser-validation workflow. The Playwright package fallback keeps the
 * harness portable when a CI runner uses a different cache layout.
 */
export function resolveBundledChromium(): string {
  const cacheRoot = path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
  const candidates = fs.existsSync(cacheRoot)
    ? fs.readdirSync(cacheRoot)
        .filter((entry) => entry.startsWith('chromium_headless_shell-'))
        .map((entry) => path.join(
          cacheRoot,
          entry,
          'chrome-headless-shell-mac-arm64',
          'chrome-headless-shell'
        ))
        .filter((candidate) => fs.existsSync(candidate))
    : [];

  return candidates.sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))[0]
    ?? chromium.executablePath();
}

/**
 * Start a browser against the production UI bundle and capture plugin-bound
 * messages without mocking the UI module or its DOM.
 */
export async function launchPluginBrowser(options: BrowserOptions = {}): Promise<PluginBrowser> {
  if (!fs.existsSync(uiHtmlPath)) {
    throw new Error(`Built UI not found at ${uiHtmlPath}; run npm run build:ui first`);
  }

  const browser = await chromium.launch({
    headless: true,
    executablePath: options.executablePath ?? resolveBundledChromium(),
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.addInitScript(() => {
    const messages: unknown[] = [];
    Object.defineProperty(window, '__pluginMessages', {
      configurable: false,
      value: messages,
      writable: false,
    });

    // The plugin iframe's parent is the host boundary. Capturing this one
    // method keeps the actual UI message serialization and DOM behavior live.
    const parentWindow = window.parent;
    Object.defineProperty(parentWindow, 'postMessage', {
      configurable: true,
      value: (message: unknown) => messages.push(message),
      writable: true,
    });
  });

  await page.goto(pathToFileURL(uiHtmlPath).href, {
    waitUntil: 'domcontentloaded',
  });
  // Figma supplies these UI3 color variables and the theme class at runtime.
  // Recreate that host contract so browser tests catch missing toolkit styles
  // instead of silently rendering controls against undefined CSS variables.
  await page.addStyleTag({ path: figmaThemeCssPath });
  await page.evaluate(() => document.body.classList.add('figma-light'));
  return { browser, context, page };
}

/** Dispatch a host-to-plugin message through the real window listener. */
export async function sendPluginMessage(
  page: Page,
  type: string,
  payload?: unknown,
  fields: Record<string, unknown> = {}
): Promise<void> {
  await page.evaluate(({ type: messageType, payload: messagePayload, fields: messageFields }) => {
    window.dispatchEvent(new MessageEvent('message', {
      data: {
        pluginMessage: {
          type: messageType,
          payload: messagePayload,
          ...messageFields,
        },
      },
    }));
  }, { type, payload, fields });
}

/** Return a copy of messages emitted to the plugin host boundary. */
export async function readPluginMessages(page: Page): Promise<unknown[]> {
  return await page.evaluate(() => [
    ...((window as unknown as { __pluginMessages: unknown[] }).__pluginMessages ?? []),
  ]);
}

/** Clear captured host-boundary messages between assertions. */
export async function clearPluginMessages(page: Page): Promise<void> {
  await page.evaluate(() => {
    const messages = (window as unknown as { __pluginMessages: unknown[] }).__pluginMessages;
    messages.splice(0, messages.length);
  });
}

/** Wait until the host boundary has emitted a message of the requested type. */
export async function waitForPluginMessage(page: Page, type: string): Promise<void> {
  await page.waitForFunction((messageType) => {
    const messages = (window as unknown as {
      __pluginMessages: Array<{ pluginMessage?: { type?: string } }>;
    }).__pluginMessages;
    return messages.some((message) => message?.pluginMessage?.type === messageType);
  }, type);
}

/** Wait for a rendered UI state without depending on arbitrary sleeps. */
export async function waitForSelector(page: Page, selector: string): Promise<void> {
  await page.waitForSelector(selector, { state: 'visible' });
}
