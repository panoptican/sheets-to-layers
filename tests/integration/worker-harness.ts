import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

export interface WorkerHandler {
  fetch(request: Request, env: Record<string, unknown>): Promise<Response>;
}

let workerPromise: Promise<WorkerHandler> | null = null;

/** Load the actual Worker entrypoint without replacing its implementation. */
export async function loadWorker(): Promise<WorkerHandler> {
  workerPromise ??= (async () => {
    const sourcePath = path.join(process.cwd(), 'worker', 'sheets-proxy.js');
    const result = await build({
      bundle: true,
      entryPoints: [sourcePath],
      format: 'cjs',
      platform: 'node',
      write: false,
    });
    const module = { exports: {} as Record<string, unknown> };
    const require = createRequire(sourcePath);
    const evaluateBundle = new Function('module', 'exports', 'require', result.outputFiles[0].text);
    evaluateBundle(module, module.exports, require);

    const worker = module.exports.default;
    if (!worker || typeof worker !== 'object' || typeof (worker as WorkerHandler).fetch !== 'function') {
      throw new Error('Worker bundle did not export a fetch handler');
    }
    return worker as WorkerHandler;
  })();

  return await workerPromise;
}

/** Run a Worker handler with an upstream response fixture. */
export async function withUpstreamFetch<T>(
  upstreamFetch: typeof fetch,
  callback: () => Promise<T>
): Promise<T> {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = upstreamFetch;
  try {
    return await callback();
  } finally {
    globalThis.fetch = previousFetch;
  }
}

export function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

export function workerRequest(pathname: string, init?: RequestInit): Request {
  return new Request(`https://worker.test${pathname}`, init);
}

export function readWorkerSource(): string {
  return fs.readFileSync(path.join(process.cwd(), 'worker', 'sheets-proxy.js'), 'utf8');
}
