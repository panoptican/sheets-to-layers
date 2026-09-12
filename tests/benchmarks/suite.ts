import { performance } from 'node:perf_hooks';

interface BenchmarkModules {
  createMockDocument: (pages: unknown[]) => unknown;
  createMockFigma: (root: unknown, currentPage?: unknown) => unknown;
  createMockPage: (name: string, children?: unknown[]) => unknown;
  createMockRectangle: (name: string, fills?: unknown[]) => unknown;
  createMockText: (...args: unknown[]) => unknown;
  MOCK_MIXED_SYMBOL: symbol;
  createMockFrame?: (name: string, children?: unknown[]) => unknown;
  runSync?: (options: {
    sheetData: unknown;
    scope: 'page';
    signal?: { aborted: boolean };
    onProgress?: (message?: string, percent?: number) => void;
  }) => Promise<{
    layersProcessed: number;
    layersUpdated: number;
    pendingImages: Array<{ url: string }>;
  }>;
  prepareSync?: (options: {
    snapshot: unknown;
    roots: { scope: 'page'; rootIds: string[]; pageId: string };
    preferences: { orientations: Record<string, 'columns' | 'rows'>; blankText: 'clear-and-hide'; defaultWorksheet: string };
    signal?: { aborted: boolean };
    onProgress?: (message?: string, percent?: number) => void;
  }) => Promise<unknown>;
  applyPreparedSync?: (
    plan: unknown,
    excludedIssueIds: readonly string[],
    signal?: { aborted: boolean },
    onProgress?: (message?: string, percent?: number) => void
  ) => Promise<{
    outcomes: Array<{ status: string }>;
    pendingImages: Array<{ url: string }>;
  }>;
  resetGlobalFontCache?: () => void;
}

interface Fixture {
  figma: Record<string, unknown>;
  sheetData: {
    worksheets: Array<{
      name: string;
      labels: string[];
      rows: Record<string, string[]>;
      orientation: 'columns';
    }>;
    activeWorksheet: string;
  };
  layerCount: number;
  imageCount: number;
  fontCount: number;
  pageId: string;
}

export interface CoreBenchmarkRun {
  run: number;
  elapsedMs: number;
  layersProcessed: number;
  layersUpdated: number;
  imageRequests: number;
  distinctImageUrls: number;
  uniqueFonts: number;
  fontLoadCalls: number;
  peakInFlightRequests: number;
  renderedCells: number;
}

export interface CoreBenchmarkResult {
  fixture: {
    boundLayers: number;
    imageLayers: number;
    mixedFonts: number;
    worksheetTabs: number;
    repeatedImageUrls: number;
  };
  runs: CoreBenchmarkRun[];
  medianMs: number;
}

export interface CancellationBenchmarkResult {
  fixtureLayers: number;
  triggeredAtProgress: boolean;
  acknowledgementMs: number | null;
  cancelled: boolean;
  attemptedBindingsBeforeAcknowledgement: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function createFixture(modules: BenchmarkModules, layerCount: number): Fixture {
  const regular = { family: 'Inter', style: 'Regular' };
  const bold = { family: 'Inter', style: 'Bold' };
  const imageCount = Math.floor(layerCount / 10);
  const mixedFontCount = layerCount - imageCount;
  const imageUrl = 'https://images.example.test/repeated-card.png';
  const children: unknown[] = [];

  for (let index = 0; index < mixedFontCount; index += 1) {
    children.push(modules.createMockText(
      '#Title',
      'AB',
      modules.MOCK_MIXED_SYMBOL,
      [regular, bold]
    ));
  }
  for (let index = 0; index < imageCount; index += 1) {
    children.push(modules.createMockRectangle('#Image'));
  }

  const page = modules.createMockPage('Benchmark Page', children);
  const root = modules.createMockDocument([page]);
  const figma = modules.createMockFigma(root, page) as Record<string, unknown>;
  const rows = {
    Title: Array.from({ length: layerCount }, (_, index) => `Title ${index + 1}`),
    Image: Array.from({ length: layerCount }, () => imageUrl),
  };
  const worksheets = Array.from({ length: 20 }, (_, index) => ({
    name: index === 0 ? 'Benchmark' : `Tab ${index + 1}`,
    labels: ['Title', 'Image'],
    rows,
    orientation: 'columns' as const,
  }));

  return {
    figma,
    sheetData: { worksheets, activeWorksheet: 'Benchmark' },
    layerCount,
    imageCount,
    fontCount: 2,
    pageId: (page as { id: string }).id,
  };
}

async function runFixtureSync(
  modules: BenchmarkModules,
  fixture: Fixture,
  signal: { aborted: boolean },
  onProgress: (message?: string, percent?: number) => void
): Promise<{
  layersProcessed: number;
  layersUpdated: number;
  attemptedBindings: number;
  pendingImages: Array<{ url: string }>;
  cancelled?: boolean;
}> {
  if (modules.runSync) {
    const result = await modules.runSync({ sheetData: fixture.sheetData, scope: 'page', signal, onProgress });
    return { ...result, attemptedBindings: result.layersProcessed };
  }
  if (!modules.prepareSync || !modules.applyPreparedSync) {
    throw new Error('Benchmark target exports neither runSync nor prepared sync APIs');
  }
  const plan = await modules.prepareSync({
    snapshot: {
      id: `benchmark-${fixture.layerCount}`,
      sourceUrl: 'https://docs.google.com/spreadsheets/d/benchmark-source-fixture-12345/edit',
      spreadsheetId: 'benchmark-source-fixture-12345',
      fetchedAt: Date.now(),
      data: fixture.sheetData,
      preferences: { orientations: {}, blankText: 'clear-and-hide', defaultWorksheet: 'Benchmark' },
    },
    roots: { scope: 'page', rootIds: [fixture.pageId], pageId: fixture.pageId },
    preferences: { orientations: {}, blankText: 'clear-and-hide', defaultWorksheet: 'Benchmark' },
    signal,
    onProgress,
  });
  const result = await modules.applyPreparedSync(plan, [], signal, onProgress);
  const attemptedBindings = result.outcomes.filter((outcome) => outcome.status !== 'skipped').length + result.pendingImages.length;
  return {
    layersProcessed: result.outcomes.length + result.pendingImages.length,
    layersUpdated: result.outcomes.filter((outcome) => outcome.status === 'changed').length,
    attemptedBindings,
    pendingImages: result.pendingImages,
    cancelled: result.cancelled,
  };
}

export async function runCoreBenchmarks(
  modules: BenchmarkModules,
  layerCounts = [100, 1000, 5000]
): Promise<CoreBenchmarkResult[]> {
  const results: CoreBenchmarkResult[] = [];
  for (const layerCount of layerCounts) {
    const fixtureSummary = {
      boundLayers: layerCount,
      imageLayers: Math.floor(layerCount / 10),
      mixedFonts: layerCount - Math.floor(layerCount / 10),
      worksheetTabs: 20,
      repeatedImageUrls: 1,
    };
    const runs: CoreBenchmarkRun[] = [];

    for (let run = 1; run <= 5; run += 1) {
      const fixture = createFixture(modules, layerCount);
      (globalThis as unknown as { figma: unknown }).figma = fixture.figma;
      modules.resetGlobalFontCache?.();
      const started = performance.now();
      const result = await runFixtureSync(modules, fixture, { aborted: false }, () => undefined);
      const elapsedMs = performance.now() - started;
      const imageUrls = new Set(result.pendingImages.map((entry) => entry.url));
      const loadedFonts = fixture.figma._loadedFonts as Set<string> | undefined;
      runs.push({
        run,
        elapsedMs: Number(elapsedMs.toFixed(3)),
        layersProcessed: result.layersProcessed,
        layersUpdated: result.layersUpdated,
        // Core sync only produces requests for the UI to fetch; it does not
        // perform network I/O at this boundary.
        imageRequests: result.pendingImages.length,
        distinctImageUrls: imageUrls.size,
        uniqueFonts: loadedFonts?.size ?? 0,
        fontLoadCalls: (fixture.figma._fontLoadCalls as number | undefined) ?? 0,
        // runSync is main-thread work; no network requests are made here.
        peakInFlightRequests: 0,
        renderedCells: 0,
      });
    }

    results.push({
      fixture: fixtureSummary,
      runs,
      medianMs: Number(median(runs.map((run) => run.elapsedMs)).toFixed(3)),
    });
  }
  return results;
}

/** Measure cancellation acknowledgement at a normal cooperative yield point. */
export async function runCancellationBenchmark(
  modules: BenchmarkModules,
  fixtureLayers = 5000
): Promise<CancellationBenchmarkResult> {
  const fixture = createFixture(modules, fixtureLayers);
  (globalThis as unknown as { figma: unknown }).figma = fixture.figma;
  modules.resetGlobalFontCache?.();
  const signal = { aborted: false };
  let triggeredAt: number | null = null;
  const result = await runFixtureSync(modules, fixture, signal, (message?: string) => {
      if (triggeredAt === null && typeof message === 'string' && /layers \(/.test(message)) {
        triggeredAt = performance.now();
        signal.aborted = true;
      }
    });
  return {
    fixtureLayers,
    triggeredAtProgress: triggeredAt !== null,
    acknowledgementMs: triggeredAt === null ? null : Number((performance.now() - triggeredAt).toFixed(3)),
    cancelled: result.cancelled,
    attemptedBindingsBeforeAcknowledgement: result.attemptedBindings,
  };
}

export function buildPreviewData(rowCount: number): {
  sheetData: {
    activeWorksheet: string;
    worksheets: Array<{
      name: string;
      labels: string[];
      rows: Record<string, string[]>;
      orientation: 'columns';
    }>;
  };
  expectedCells: number;
} {
  const labels = ['Title'];
  const values = Array.from({ length: rowCount }, (_, index) => `Preview ${index + 1}`);
  return {
    sheetData: {
      activeWorksheet: 'Preview',
      worksheets: [{ name: 'Preview', labels, rows: { Title: values }, orientation: 'columns' }],
    },
    expectedCells: rowCount,
  };
}
