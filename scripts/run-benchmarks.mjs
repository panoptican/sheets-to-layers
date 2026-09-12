#!/usr/bin/env node

import { build } from 'esbuild';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const valueFor = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const mode = valueFor('--mode', 'current');
const sourceRoot = path.resolve(valueFor('--source', projectRoot));
const outputPath = path.resolve(valueFor(
  '--output',
  path.join(os.tmpdir(), `sheets-to-layers-benchmarks-${mode}.json`)
));

function resolveChromium() {
  const cacheRoot = path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
  return fs.readdir(cacheRoot)
    .then((entries) => entries
      .filter((entry) => entry.startsWith('chromium_headless_shell-'))
      .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
      .map((entry) => path.join(
        cacheRoot,
        entry,
        'chrome-headless-shell-mac-arm64',
        'chrome-headless-shell'
      ))
    )
    .then(async (candidates) => {
      for (const candidate of candidates) {
        try {
          await fs.access(candidate);
          return candidate;
        } catch {
          // Try the next cached browser.
        }
      }
      return chromium.executablePath();
    });
}

async function runCoreBenchmark() {
  const runnerPath = path.join(projectRoot, 'tests', 'benchmarks', 'suite.ts');
  const enginePath = path.join(sourceRoot, 'src', 'core', 'sync-engine.ts');
  const engineSource = await fs.readFile(enginePath, 'utf8');
  const runSyncLine = /export\s+(?:async\s+)?function\s+runSync/.test(engineSource)
    ? '  runSync: engine.runSync,\n'
    : '';
  const preparedLines =
    /export[^;\n]*\bprepareSync\b/.test(engineSource) &&
    /export[^;\n]*\bapplyPreparedSync\b/.test(engineSource)
      ? '  prepareSync: engine.prepareSync,\n  applyPreparedSync: engine.applyPreparedSync,\n'
      : '';
  const entryPath = path.join(os.tmpdir(), `sheets-to-layers-benchmark-entry-${process.pid}.ts`);
  const bundlePath = path.join(os.tmpdir(), `sheets-to-layers-benchmark-${process.pid}.mjs`);
  const source = `
import { runCoreBenchmarks, runCancellationBenchmark } from ${JSON.stringify(runnerPath)};
import * as engine from ${JSON.stringify(enginePath)};
import * as performance from ${JSON.stringify(path.join(sourceRoot, 'src', 'core', 'performance.ts'))};
import * as mocks from ${JSON.stringify(path.join(sourceRoot, 'tests', 'mocks', 'figma.ts'))};
const modules = {
${runSyncLine}${preparedLines}
  resetGlobalFontCache: performance.resetGlobalFontCache,
  ...mocks,
};
const result = {
  core: await runCoreBenchmarks(modules),
  cancellation: await runCancellationBenchmark(modules),
};
process.stdout.write('__BENCHMARK_JSON__' + JSON.stringify(result) + '\\n');
`;
  await fs.writeFile(entryPath, source);
  try {
    await build({
      bundle: true,
      entryPoints: [entryPath],
      format: 'esm',
      platform: 'node',
      target: 'node20',
      outfile: bundlePath,
    });
    const output = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [bundlePath], { stdio: ['ignore', 'pipe', 'inherit'] });
      let stdout = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.on('error', reject);
      child.on('close', (code) => code === 0 ? resolve(stdout) : reject(new Error(`Core benchmark exited ${code}`)));
    });
    const line = String(output).split('\n').find((entry) => entry.startsWith('__BENCHMARK_JSON__'));
    if (!line) throw new Error('Core benchmark did not emit JSON output');
    return JSON.parse(line.slice('__BENCHMARK_JSON__'.length));
  } finally {
    await Promise.allSettled([fs.rm(entryPath, { force: true }), fs.rm(bundlePath, { force: true })]);
  }
}

async function buildUiHtml() {
  const uiSource = path.join(sourceRoot, 'src', 'ui', 'ui.ts');
  const cssPath = path.join(sourceRoot, 'src', 'ui', 'styles.css');
  const result = await build({
    bundle: true,
    entryPoints: [uiSource],
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    write: false,
  });
  return `<!doctype html><html><head><meta charset="utf-8"><style>${await fs.readFile(cssPath, 'utf8')}</style></head><body><div id="app"></div><script>${result.outputFiles[0].text}</script></body></html>`;
}

async function runPreviewBenchmark() {
  const html = await buildUiHtml();
  const uiSource = path.join(sourceRoot, 'src', 'ui', 'ui.ts');
  const uiSourceText = await fs.readFile(uiSource, 'utf8');
  const currentProtocol = /payload\.snapshot/.test(uiSourceText);
  const workerOrigin = currentProtocol ? 'https://127.0.0.1:8787' : 'https://sheets-proxy.spidleweb.workers.dev';
  const htmlPath = path.join(os.tmpdir(), `sheets-to-layers-preview-${process.pid}.html`);
  await fs.writeFile(htmlPath, html);
  const executablePath = await resolveChromium();
  const browser = await chromium.launch({ headless: true, executablePath });
  const runs = [];
  try {
    for (let run = 1; run <= 5; run += 1) {
      const page = await browser.newPage();
      await page.addInitScript(() => {
        const messages = [];
        Object.defineProperty(window, '__pluginMessages', {
          configurable: false,
          value: messages,
          writable: false,
        });
        Object.defineProperty(window.parent, 'postMessage', {
          configurable: true,
          value: (message) => messages.push(message),
          writable: true,
        });
      });
      const network = {
        totalRequests: 0,
        sheetRequests: 0,
        imageFetchCount: 0,
        peakInFlightRequests: 0,
        maxWorksheetTasks: 0,
        maxImageInFlight: 0,
      };
      let inFlight = 0;
      let activeImageRequests = 0;
      let activeWorksheetTasks = 0;
      const worksheetRequests = new Map();
      const imageUrls = new Set();
      await page.route(`${workerOrigin}/**`, async (route) => {
        const requestUrl = new URL(route.request().url());
        const imageUrl = requestUrl.searchParams.get('imageUrl');
        const tabName = requestUrl.searchParams.get('tabName');
        const isImage = imageUrl !== null;
        const isDiscovery = !isImage && tabName === null;
        network.totalRequests += 1;
        if (isImage) {
          network.imageFetchCount += 1;
          imageUrls.add(imageUrl);
          activeImageRequests += 1;
          network.maxImageInFlight = Math.max(network.maxImageInFlight, activeImageRequests);
        } else if (!isDiscovery) {
          network.sheetRequests += 1;
          const previous = worksheetRequests.get(tabName) ?? 0;
          if (previous === 0) activeWorksheetTasks += 1;
          worksheetRequests.set(tabName, previous + 1);
          network.maxWorksheetTasks = Math.max(network.maxWorksheetTasks, activeWorksheetTasks);
        }
        inFlight += 1;
        network.peakInFlightRequests = Math.max(network.peakInFlightRequests, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 15));
        try {
          if (isImage) {
            await route.fulfill({
              status: 200,
              headers: { 'content-type': 'image/png', 'access-control-allow-origin': '*' },
              body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
            });
          } else if (isDiscovery) {
            await route.fulfill({
              status: 200,
              headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
              body: JSON.stringify({
                sheets: Array.from({ length: 20 }, (_, index) => ({
                  title: index === 0 ? 'Preview' : `Tab ${index + 1}`,
                  sheetId: index + 1,
                  index,
                })),
              }),
            });
          } else if (requestUrl.searchParams.get('boldInfo') === 'true') {
            await route.fulfill({
              status: 200,
              headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
              body: JSON.stringify({ tabName, firstRowBold: [true], firstColBold: [false] }),
            });
          } else {
            await route.fulfill({
              status: 200,
              headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
              body: JSON.stringify({ tabName, values: [['Title'], ['Network fixture']] }),
            });
          }
        } finally {
          inFlight -= 1;
          if (isImage) {
            activeImageRequests -= 1;
          } else if (!isDiscovery) {
            const remaining = (worksheetRequests.get(tabName) ?? 1) - 1;
            if (remaining === 0) {
              worksheetRequests.delete(tabName);
              activeWorksheetTasks -= 1;
            } else {
              worksheetRequests.set(tabName, remaining);
            }
          }
        }
      });
      const started = performance.now();
      await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'domcontentloaded' });
      const sendHost = async (type, payload, fields = {}) => {
        await page.evaluate(({ type: messageType, payload: messagePayload, fields: messageFields }) => {
          window.dispatchEvent(new MessageEvent('message', {
            data: { pluginMessage: { type: messageType, payload: messagePayload, ...messageFields } },
          }));
        }, { type, payload, fields });
      };
      const waitForStep = async (label, predicate, arg, options) => {
        try {
          return await page.waitForFunction(predicate, arg, options);
        } catch (error) {
          const messages = await page.evaluate(() => ((window).__pluginMessages ?? [])
            .map((entry) => entry?.pluginMessage?.type || 'unknown'));
          throw new Error(`${label}: ${error instanceof Error ? error.message : String(error)}; messages=${JSON.stringify(messages)}`);
        }
      };
      await waitForStep('UI_READY', () => ((window).__pluginMessages ?? [])
        .some((entry) => entry?.pluginMessage?.type === 'UI_READY'));
      await sendHost('INIT', currentProtocol
        ? { hasSelection: false, settings: { workerUrl: workerOrigin, allowThirdPartyFallback: false } }
        : { hasSelection: false, lastUrl: '' });
      await page.locator('#sheets-url').fill('https://docs.google.com/spreadsheets/d/benchmark-source-fixture-12345/edit');
      await page.locator('#fetch-btn').click();
      await waitForStep('FETCH', () => ((window).__pluginMessages ?? [])
        .some((entry) => entry?.pluginMessage?.type === 'FETCH'));
      const fetchRunId = await page.evaluate(() => {
        const entry = ((window).__pluginMessages ?? [])
          .find((candidate) => candidate?.pluginMessage?.type === 'FETCH');
        return entry?.pluginMessage?.runId;
      });
      if (currentProtocol && typeof fetchRunId !== 'string') throw new Error('Preview benchmark did not allocate a run ID');
      await sendHost('REQUEST_SHEET_FETCH', {
        url: 'https://docs.google.com/spreadsheets/d/benchmark-source-fixture-12345/edit',
        ...(currentProtocol ? {
          snapshotId: `preview-${run}`,
          preferences: { orientations: {}, blankText: 'clear-and-hide' },
        } : {}),
      }, currentProtocol ? { runId: fetchRunId } : {});
      await waitForStep('SHEET_DATA', () => ((window).__pluginMessages ?? [])
        .some((entry) => entry?.pluginMessage?.type === 'SHEET_DATA'));
      const previewData = {
        activeWorksheet: 'Preview',
        worksheets: [{
          name: 'Preview',
          labels: ['Title'],
          rows: { Title: Array.from({ length: 10_000 }, (_, index) => `Preview ${index + 1}`) },
          orientation: 'columns',
        }],
      };
      await sendHost('FETCH_SUCCESS', currentProtocol ? {
        snapshot: {
          id: `preview-${run}`,
          sourceUrl: 'https://docs.google.com/spreadsheets/d/benchmark-source-fixture-12345/edit',
          spreadsheetId: 'benchmark-source-fixture-12345',
          fetchedAt: Date.now(),
          data: previewData,
          preferences: { orientations: {}, blankText: 'clear-and-hide' },
        },
      } : { sheetData: previewData }, currentProtocol ? { runId: fetchRunId } : {});
      try {
        await page.waitForSelector('.preview-mode');
      } catch (error) {
        throw new Error(`PREVIEW_MODE: ${error instanceof Error ? error.message : String(error)}`);
      }
      const renderedCells = await page.locator('.value-cell').count();
      for (let index = 0; index < 12; index += 1) {
        await sendHost('REQUEST_IMAGE_FETCH', currentProtocol ? {
          requestId: `image-${run}-${index}`,
          nodeId: `node-${index}`,
          url: `https://images.example.test/${run}-${index % 6}.png`,
        } : {
          nodeId: `node-${index}`,
          url: `https://images.example.test/${run}-${index % 6}.png`,
        }, currentProtocol ? { runId: fetchRunId } : {});
      }
      await waitForStep('IMAGE_RESPONSES', (expected) => ((window).__pluginMessages ?? [])
        .filter((entry) => entry?.pluginMessage?.type === 'IMAGE_DATA' || entry?.pluginMessage?.type === 'IMAGE_FETCH_ERROR').length >= expected, 12, { timeout: 30_000 });
      network.imageErrors = await page.evaluate(() => ((window).__pluginMessages ?? [])
        .filter((entry) => entry?.pluginMessage?.type === 'IMAGE_FETCH_ERROR')
        .map((entry) => entry?.pluginMessage?.payload?.error));
      network.uniqueImageUrls = imageUrls.size;
      runs.push({
        run,
        elapsedMs: Number((performance.now() - started).toFixed(3)),
        renderedCells,
        ...network,
      });
      await page.close();
    }
  } finally {
    await browser.close();
    await fs.rm(htmlPath, { force: true });
  }
  const sorted = runs.map((run) => run.elapsedMs).sort((left, right) => left - right);
  return {
    rowCount: 10_000,
    renderedCellCap: 2_000,
    runs,
    medianMs: sorted[Math.floor(sorted.length / 2)],
    renderedCells: runs[runs.length - 1].renderedCells,
  };
}

const coreBenchmark = await runCoreBenchmark();
let preview;
try {
  preview = await runPreviewBenchmark();
} catch (error) {
  preview = {
    status: 'blocked',
    error: error instanceof Error ? error.message : String(error),
  };
  process.exitCode = 1;
}
const result = {
  schemaVersion: 1,
  mode,
  sourceRoot,
  host: { node: process.version, platform: process.platform, arch: process.arch },
  generatedAt: new Date().toISOString(),
  fiveRunMedianRule: 'Investigate if final median exceeds baseline by more than max(15%, 100ms) on the same fixture/host.',
  measurementCoverage: {
    coreElapsed: 'Includes the selected source engine call from fixture setup through its returned result; Figma and network boundaries are mocked.',
    previewElapsed: 'Includes built UI startup, host message round-trip, Worker sheet/image fetches, and preview rendering in bundled Chromium.',
  },
  comparisonLimitations: [
    'Baseline runSync and current prepareSync/applyPreparedSync are different pipelines; compare timings as evidence, not as a functional equivalence proof.',
    'Core imageRequests are pending UI requests; preview imageFetchCount is actual browser network fetches after URL deduplication.',
  ],
  core: coreBenchmark.core,
  cancellation: coreBenchmark.cancellation,
  preview,
};
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, JSON.stringify(result, null, 2) + '\n');
console.log(`Benchmark written to ${outputPath}`);
console.log(JSON.stringify(result, null, 2));
