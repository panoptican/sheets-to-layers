import { describe, expect, it, vi } from 'vitest';
import {
  countWorksheetCells,
  readResponseTextBounded,
  runUpstreamRequest,
  withRequestDeadline,
} from '../../src/core/transport';

describe('transport deadlines and queue cancellation', () => {
  it('settles a stalled injected request at its deadline', async () => {
    vi.useFakeTimers();
    try {
      const pending = withRequestDeadline(() => new Promise<never>(() => undefined), {}, 15);
      const assertion = expect(pending).rejects.toMatchObject({ kind: 'TIMEOUT' });
      await vi.advanceTimersByTimeAsync(15);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('settles and cancels a response body that never yields', async () => {
    vi.useFakeTimers();
    let cancelled = false;
    const body = new ReadableStream({
      pull: () => new Promise<void>(() => undefined),
      cancel: () => {
        cancelled = true;
        return Promise.reject(new Error('stream cancel failed'));
      },
    });
    try {
      const pending = withRequestDeadline(
        (signal) => readResponseTextBounded(new Response(body), 1024, signal),
        {},
        15
      );
      const assertion = expect(pending).rejects.toMatchObject({ kind: 'TIMEOUT' });
      await vi.advanceTimersByTimeAsync(15);
      await assertion;
      expect(cancelled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('suppresses rejecting cancellation during size-limit cleanup', async () => {
    const contentLengthBody = new ReadableStream({
      cancel: () => Promise.reject(new Error('content-length cancel failed')),
    });
    await expect(readResponseTextBounded(
      new Response(contentLengthBody, { headers: { 'content-length': '1025' } }),
      1024
    )).rejects.toMatchObject({ kind: 'LIMIT' });

    const streamedBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(1025));
      },
      cancel: () => Promise.reject(new Error('reader cancel failed')),
    });
    await expect(readResponseTextBounded(new Response(streamedBody), 1024)).rejects.toMatchObject({ kind: 'LIMIT' });
  });

  it('removes a cancelled request waiting behind the global upstream ceiling', async () => {
    const releases: Array<() => void> = [];
    const active = Array.from({ length: 6 }, () => runUpstreamRequest(() => new Promise<void>((resolve) => releases.push(resolve))));
    await vi.waitFor(() => expect(releases).toHaveLength(6));

    const controller = new AbortController();
    const queued = runUpstreamRequest(() => Promise.resolve('should not start'), controller.signal);
    controller.abort();

    await expect(queued).rejects.toMatchObject({ kind: 'ABORTED' });
    releases.forEach((release) => release());
    await Promise.all(active);
  });

  it('caps a sparse source by its normalized grid footprint', () => {
    const sparseValues = [
      Array.from({ length: 1001 }, (_, index) => `Header ${index}`),
      ...Array.from({ length: 100 }, () => ['value']),
    ];

    expect(() => countWorksheetCells(sparseValues)).toThrow('100,000-cell import limit');
  });
});
