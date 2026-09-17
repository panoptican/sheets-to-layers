/**
 * Shared limits and cancellation helpers for UI-context network requests.
 *
 * These limits constrain the plugin's own requests. They do not provide rate
 * limiting for a public Worker endpoint, which must be controlled at deploy time.
 */

export const REQUEST_DEADLINE_MS = 15_000;
export const SHEET_FETCH_DEADLINE_MS = 90_000;
export const MAX_RETRIES = 2;
export const MAX_RETRY_AFTER_MS = 5_000;
export const MAX_WORKSHEET_CONCURRENCY = 3;
export const MAX_IMAGE_CONCURRENCY = 4;
export const MAX_UPSTREAM_CONCURRENCY = 6;
export const MAX_SHEET_RESPONSE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_RESPONSE_BYTES = 20 * 1024 * 1024;
export const MAX_WORKSHEETS = 200;
export const MAX_WORKSHEET_CELLS = 100_000;
export const MAX_SOURCE_CELLS = 500_000;

export interface FetchRequestOptions {
  /** Cancels the request and any JSONP script/listeners it created. */
  signal?: AbortSignal;
}

export class TransportError extends Error {
  constructor(
    message: string,
    readonly kind: 'ABORTED' | 'TIMEOUT' | 'LIMIT' | 'HTTP' | 'NETWORK' = 'NETWORK',
    readonly status?: number,
    readonly retryAfterMs?: number
  ) {
    super(message);
    this.name = 'TransportError';
  }
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new TransportError('Request cancelled', 'ABORTED');
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof TransportError
    ? error.kind === 'ABORTED'
    : error instanceof Error && error.name === 'AbortError';
}

export function isTransientStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(Math.round(seconds * 1000), MAX_RETRY_AFTER_MS);
  }

  const retryAt = Date.parse(value);
  if (!Number.isNaN(retryAt)) {
    return Math.min(Math.max(0, retryAt - Date.now()), MAX_RETRY_AFTER_MS);
  }
  return undefined;
}

export async function waitForRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timeoutId);
      signal?.removeEventListener('abort', onAbort);
      reject(new TransportError('Request cancelled', 'ABORTED'));
    };
    const timeoutId = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function retryTransient<T>(
  operation: () => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    throwIfAborted(signal);
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === MAX_RETRIES) {
        throw error;
      }

      const retryAfter = error instanceof TransportError ? error.retryAfterMs : undefined;
      const exponentialBackoff = 250 * (attempt + 1);
      await waitForRetry(retryAfter ?? exponentialBackoff, signal);
    }
  }

  throw lastError;
}

function isRetryable(error: unknown): boolean {
  if (isAbortError(error)) return false;
  if (error instanceof TransportError) {
    return error.kind === 'TIMEOUT'
      || error.kind === 'NETWORK'
      || (error.kind === 'HTTP' && error.status !== undefined && isTransientStatus(error.status));
  }
  return true;
}

export async function withRequestDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  options: FetchRequestOptions = {},
  timeoutMs: number = REQUEST_DEADLINE_MS
): Promise<T> {
  throwIfAborted(options.signal);
  const controller = new AbortController();
  let timedOut = false;
  let rejectAbort: (reason: TransportError) => void = () => undefined;
  const abortResult = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const abort = (kind: 'ABORTED' | 'TIMEOUT') => {
    controller.abort();
    rejectAbort(new TransportError(
      kind === 'TIMEOUT' ? `Request timed out after ${timeoutMs / 1000} seconds` : 'Request cancelled',
      kind
    ));
  };
  const onAbort = () => abort('ABORTED');
  options.signal?.addEventListener('abort', onAbort, { once: true });
  const timeoutId = setTimeout(() => {
    timedOut = true;
    abort('TIMEOUT');
  }, timeoutMs);

  try {
    const operationResult = Promise.resolve().then(() => operation(controller.signal));
    return await Promise.race([operationResult, abortResult]);
  } catch (error) {
    if (options.signal?.aborted && !timedOut) {
      throw new TransportError('Request cancelled', 'ABORTED');
    }
    if (timedOut || (error instanceof Error && error.name === 'AbortError')) {
      throw new TransportError(`Request timed out after ${timeoutMs / 1000} seconds`, 'TIMEOUT');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    options.signal?.removeEventListener('abort', onAbort);
  }
}

type Limiter = <T>(operation: () => Promise<T>, signal?: AbortSignal) => Promise<T>;

function createLimiter(maximum: number): Limiter {
  let active = 0;
  const queue: Array<() => void> = [];

  return async <T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> => {
    throwIfAborted(signal);
    await new Promise<void>((resolve, reject) => {
      const start = () => {
        active++;
        cleanup();
        resolve();
      };
      const onAbort = () => {
        const index = queue.indexOf(start);
        if (index >= 0) queue.splice(index, 1);
        cleanup();
        reject(new TransportError('Request cancelled', 'ABORTED'));
      };
      const cleanup = () => signal?.removeEventListener('abort', onAbort);

      if (active < maximum) {
        start();
      } else {
        queue.push(start);
        signal?.addEventListener('abort', onAbort, { once: true });
      }
    });

    try {
      return await operation();
    } finally {
      active--;
      queue.shift()?.();
    }
  };
}

const limitWorksheet = createLimiter(MAX_WORKSHEET_CONCURRENCY);
const limitImage = createLimiter(MAX_IMAGE_CONCURRENCY);
const limitUpstream = createLimiter(MAX_UPSTREAM_CONCURRENCY);

export function runWorksheetTask<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  return limitWorksheet(operation, signal);
}

export function runImageRequest<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  return limitImage(() => limitUpstream(operation, signal), signal);
}

export function runUpstreamRequest<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  return limitUpstream(operation, signal);
}

export async function readResponseTextBounded(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal,
  limitLabel: string = 'Sheet response'
): Promise<string> {
  return new TextDecoder().decode(await readResponseBytesBounded(response, maxBytes, signal, limitLabel));
}

/** Read a response body with a cancellable byte cap, for JSON and images. */
export async function readResponseBytesBounded(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal,
  limitLabel: string = 'Response'
): Promise<Uint8Array> {
  throwIfAborted(signal);
  const contentLength = response.headers?.get('content-length');
  if (contentLength && Number(contentLength) > maxBytes) {
    cancelBestEffort(response.body);
    throw new TransportError(`${limitLabel} exceeds the ${Math.floor(maxBytes / 1024 / 1024)} MiB size limit`, 'LIMIT');
  }

  if (!response.body) {
    const data = new Uint8Array(await awaitWithAbort(response.arrayBuffer(), signal));
    if (data.byteLength > maxBytes) {
      throw new TransportError(`${limitLabel} exceeds the ${Math.floor(maxBytes / 1024 / 1024)} MiB size limit`, 'LIMIT');
    }
    return data;
  }

  const reader = response.body.getReader();
  const onAbort = () => cancelBestEffort(reader);
  signal?.addEventListener('abort', onAbort, { once: true });
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    for (;;) {
      throwIfAborted(signal);
      const { done, value } = await awaitWithAbort(reader.read(), signal);
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        // A hostile stream may never settle cancel(). Do not let cleanup exceed
        // the request deadline after the byte limit has already been reached.
        cancelBestEffort(reader);
        throw new TransportError(`${limitLabel} exceeds the ${Math.floor(maxBytes / 1024 / 1024)} MiB size limit`, 'LIMIT');
      }
      chunks.push(value);
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
    if (reader) reader.releaseLock();
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

/** Cleanup must not surface a second error or wait on an uncooperative stream. */
function cancelBestEffort(target: { cancel: () => unknown } | null | undefined): void {
  if (!target) return;
  try {
    void Promise.resolve(target.cancel()).catch(() => undefined);
  } catch {
    // Some custom streams throw synchronously from cancel(). The request limit
    // error remains the useful result for callers.
  }
}

function awaitWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new TransportError('Request cancelled', 'ABORTED'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(new TransportError('Request cancelled', 'ABORTED'));
    };
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => { cleanup(); resolve(value); },
      (error) => { cleanup(); reject(error); }
    );
  });
}

export function countWorksheetCells(values: unknown): number {
  if (!Array.isArray(values)) {
    throw new TransportError('Sheet response has an invalid values format', 'LIMIT');
  }

  let rawCells = 0;
  let widestRow = 0;
  for (const row of values) {
    if (!Array.isArray(row)) {
      throw new TransportError('Sheet response has an invalid row format', 'LIMIT');
    }
    rawCells += row.length;
    widestRow = Math.max(widestRow, row.length);
    if (rawCells > MAX_WORKSHEET_CELLS) {
      throw new TransportError('Sheet exceeds the 100,000-cell import limit', 'LIMIT');
    }
  }

  // The normalizer can materialize a rectangular value grid from sparse source
  // rows. Bound that footprint before buildWorksheet so a small raw payload
  // cannot expand past the worksheet or source import limits.
  const normalizationFootprint = values.length * widestRow;
  const cells = Math.max(rawCells, normalizationFootprint);
  if (cells > MAX_WORKSHEET_CELLS) {
    throw new TransportError('Sheet exceeds the 100,000-cell import limit', 'LIMIT');
  }
  return cells;
}

export function assertCellLimit(values: unknown): asserts values is string[][] {
  countWorksheetCells(values);
}
