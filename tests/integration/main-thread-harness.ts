import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {
  createMockDocument,
  createMockFigma,
  type MockDocumentNode,
  createMockPage,
  createMockText,
  resetNodeIdCounter,
  type MockFigma,
  type MockPageNode,
  type MockTextNode,
} from '../mocks/figma';

interface MainThreadOptions {
  command?: string;
  storage?: Map<string, unknown>;
  root?: MockDocumentNode;
  pages?: MockPageNode[];
  page?: MockPageNode;
  text?: MockTextNode;
}

export interface MainThreadFixture {
  figma: MockFigma & {
    command: string;
    ui: {
      onmessage?: (message: unknown) => Promise<void>;
      postMessage: (message: unknown) => void;
      resize: (width: number, height: number) => void;
    };
    clientStorage: {
      getAsync: (key: string) => Promise<unknown>;
      setAsync: (key: string, value: unknown) => Promise<void>;
    };
    showUI: (...args: unknown[]) => void;
    notify: (...args: unknown[]) => void;
    commitUndo: () => void;
    closePlugin: () => void;
    on: (event: string, handler: () => void) => void;
    _events: Map<string, () => void>;
    _shownUIs: unknown[];
    _notifications: unknown[];
    _undoCommits: number[];
    _closed: boolean;
  };
  text: MockTextNode;
  page: MockPageNode;
  storage: Map<string, unknown>;
  messages: unknown[];
  sendUiMessage: (message: unknown) => Promise<void>;
  flush: (turns?: number) => Promise<void>;
}

let bundlePromise: Promise<string> | null = null;

async function loadMainBundle(): Promise<string> {
  bundlePromise ??= (async () => {
    const result = await build({
      bundle: true,
      entryPoints: [path.join(process.cwd(), 'src', 'code.ts')],
      format: 'iife',
      platform: 'browser',
      target: 'es2020',
      write: false,
    });
    return result.outputFiles[0].text;
  })();
  return await bundlePromise;
}

/** Execute the actual main-thread bundle with only the Figma host boundary mocked. */
export async function createMainThreadFixture(
  options: MainThreadOptions = {}
): Promise<MainThreadFixture> {
  resetNodeIdCounter();
  const text = options.text ?? createMockText('#Title', 'Old value');
  const page = options.page ?? options.pages?.[0] ?? createMockPage('Page 1', [text]);
  const root = options.root ?? createMockDocument(options.pages ?? [page]);
  const baseFigma = createMockFigma(root, page);
  const storage = options.storage ?? new Map<string, unknown>();
  const messages: unknown[] = [];
  const shownUIs: unknown[] = [];
  const notifications: unknown[] = [];
  const undoCommits: number[] = [];
  const events = new Map<string, () => void>();
  const command = options.command ?? 'open';

  const figma = Object.assign(baseFigma, {
    command,
    ui: {
      onmessage: undefined as ((message: unknown) => Promise<void>) | undefined,
      postMessage: (message: unknown) => messages.push(message),
      resize: (..._dimensions: number[]) => undefined,
    },
    clientStorage: {
      getAsync: async (key: string) => storage.get(key),
      setAsync: async (key: string, value: unknown) => {
        storage.set(key, value);
      },
    },
    showUI: (...args: unknown[]) => shownUIs.push(args),
    notify: (...args: unknown[]) => notifications.push(args),
    commitUndo: () => { undoCommits.push(messages.length); },
    closePlugin: () => undefined,
    on: (event: string, handler: () => void) => {
      events.set(event, handler);
    },
    _events: events,
    _shownUIs: shownUIs,
    _notifications: notifications,
    _undoCommits: undoCommits,
    _closed: false,
  });

  const context = vm.createContext({
    AbortController,
    Promise,
    Uint8Array,
    __html__: '<div id="plugin">test</div>',
    clearTimeout,
    console,
    figma,
    setImmediate,
    setTimeout,
    clearImmediate,
  });
  vm.runInContext(await loadMainBundle(), context);

  const flush = async (turns = 4): Promise<void> => {
    for (let index = 0; index < turns; index += 1) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  };
  await flush();

  return {
    figma,
    text,
    page,
    storage,
    messages,
    sendUiMessage: async (message: unknown) => {
      if (!figma.ui.onmessage) throw new Error('Main-thread message handler is not ready');
      await figma.ui.onmessage(message);
      await flush();
    },
    flush,
  };
}

export function readMainBundleSource(): string {
  return fs.readFileSync(path.join(process.cwd(), 'src', 'code.ts'), 'utf8');
}
