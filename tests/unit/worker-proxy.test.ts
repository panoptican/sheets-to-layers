import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, { quoteA1SheetName } from '../../worker/sheets-proxy.js';

const sheetId = 'abcdefghijklmnopqrst';
const env = { GOOGLE_API_KEY: 'test-key' };

afterEach(() => vi.unstubAllGlobals());

describe('sheets proxy Worker', () => {
  it('quotes sheet names for A1 notation, including apostrophes', () => {
    expect(quoteA1SheetName('A1')).toBe("'A1'");
    expect(quoteA1SheetName("O'Brien")).toBe("'O''Brien'");
  });

  it('allows only GET and OPTIONS before making an upstream request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await worker.fetch(
      new Request(`https://proxy.example/?sheetId=${sheetId}`, { method: 'POST' }),
      env
    );

    expect(response.status).toBe(405);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires a server-side API key only for Sheets requests', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await worker.fetch(new Request(`https://proxy.example/?sheetId=${sheetId}`), {});

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining('missing API key') });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('builds quoted values and formatting routes', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ values: [['Name'], ['Ada']] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ sheets: [{ data: [] }] })));
    vi.stubGlobal('fetch', fetchMock);

    const valuesResponse = await worker.fetch(
      new Request(`https://proxy.example/?sheetId=${sheetId}&tabName=A1`),
      env
    );
    const boldResponse = await worker.fetch(
      new Request(`https://proxy.example/?sheetId=${sheetId}&tabName=O%27Brien&boldInfo=true`),
      env
    );

    const valuesUrl = new URL(fetchMock.mock.calls[0][0]);
    const boldUrl = new URL(fetchMock.mock.calls[1][0]);
    expect(valuesResponse.status).toBe(200);
    expect(valuesUrl.pathname).toContain("/'A1'");
    expect(boldResponse.status).toBe(200);
    expect(boldUrl.searchParams.getAll('ranges')).toEqual(["'O''Brien'!1:1", "'O''Brien'!A1:A100"]);
  });

  it('rejects local URLs and unsafe redirect destinations without following them', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, {
      status: 302,
      headers: { location: 'https://127.0.0.1/private.png' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const local = await worker.fetch(new Request('https://proxy.example/?imageUrl=https%3A%2F%2F127.0.0.1%2Fa.png'), env);
    const redirected = await worker.fetch(new Request('https://proxy.example/?imageUrl=https%3A%2F%2Fimages.example%2Fa.png'), env);

    expect(local.status).toBe(400);
    expect(redirected.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('normalizes IPv6 literals and does not reject ordinary public hostnames beginning fc/fd', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const fetchMock = vi.fn().mockResolvedValue(new Response(png, { headers: { 'content-type': 'image/png' } }));
    vi.stubGlobal('fetch', fetchMock);

    const loopback = await worker.fetch(new Request('https://proxy.example/?imageUrl=https%3A%2F%2F%5B%3A%3A1%5D%2Fa.png'), env);
    const uniqueLocal = await worker.fetch(new Request('https://proxy.example/?imageUrl=https%3A%2F%2F%5Bfd00%3A%3A1%5D%2Fa.png'), env);
    const mappedLoopback = await worker.fetch(new Request('https://proxy.example/?imageUrl=https%3A%2F%2F%5B%3A%3Affff%3A127.0.0.1%5D%2Fa.png'), env);
    const publicHostname = await worker.fetch(new Request('https://proxy.example/?imageUrl=https%3A%2F%2Ffc-example.com%2Fa.png'), env);

    expect(loopback.status).toBe(400);
    expect(uniqueLocal.status).toBe(400);
    expect(mappedLoopback.status).toBe(400);
    expect(publicHostname.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('rejects the full IPv6 link-local/site-local range and mapped link-local IPv4 before fetching', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const urls = [
      'https://[fe80::1]/a.png',
      'https://[fe90::1]/a.png',
      'https://[febf::1]/a.png',
      'https://[fec0::1]/a.png',
      'https://[::ffff:169.254.1.1]/a.png',
    ];

    const responses = await Promise.all(urls.map((imageUrl) => worker.fetch(
      new Request(`https://proxy.example/?imageUrl=${encodeURIComponent(imageUrl)}`),
      env
    )));

    expect(responses.map((response) => response.status)).toEqual([400, 400, 400, 400, 400]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a link-local redirect destination before a second upstream fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, {
      status: 302,
      headers: { location: 'https://[fe80::1]/private.png' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await worker.fetch(new Request('https://proxy.example/?imageUrl=https%3A%2F%2Fimages.example%2Fa.png'), env);

    expect(response.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('preserves retryable upstream statuses and Retry-After without exposing arbitrary fetch errors', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'retry-after': '2' } }))
      .mockRejectedValueOnce(new Error('fetch https://signed.example/?token=secret failed'));
    vi.stubGlobal('fetch', fetchMock);

    const throttled = await worker.fetch(new Request('https://proxy.example/?imageUrl=https%3A%2F%2Fimages.example%2Fa.png'), env);
    const failed = await worker.fetch(new Request(`https://proxy.example/?sheetId=${sheetId}`), env);

    expect(throttled.status).toBe(429);
    expect(throttled.headers.get('retry-after')).toBe('2');
    expect(failed.status).toBe(502);
    await expect(failed.text()).resolves.not.toContain('token=secret');
  });

  it('preserves Sheets permission failures instead of converting them to retryable proxy errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'forbidden' } }), { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await worker.fetch(new Request(`https://proxy.example/?sheetId=${sheetId}`), env);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining('not publicly accessible') });
  });

  it('accepts a signed PNG stream without a content length and rejects an oversized stream', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const oversized = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(20 * 1024 * 1024));
        controller.enqueue(new Uint8Array(1));
        controller.close();
      },
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(png, { headers: { 'content-type': 'image/png', 'content-length': 'false' } }))
      .mockResolvedValueOnce(new Response(oversized, { headers: { 'content-type': 'image/png', 'content-length': 'false' } }));
    vi.stubGlobal('fetch', fetchMock);

    const success = await worker.fetch(new Request('https://proxy.example/?imageUrl=https%3A%2F%2Fimages.example%2Fa.png'), env);
    const failure = await worker.fetch(new Request('https://proxy.example/?imageUrl=https%3A%2F%2Fimages.example%2Fb.png'), env);

    expect(success.status).toBe(200);
    expect(success.headers.get('content-type')).toBe('image/png');
    expect(failure.status).toBe(413);
    await expect(failure.json()).resolves.toMatchObject({ error: expect.stringContaining('20 MiB') });
  });

  it('rejects HTML and unsupported image types even when the upstream request succeeds', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('<html>', {
      headers: { 'content-type': 'text/html' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await worker.fetch(new Request('https://proxy.example/?imageUrl=https%3A%2F%2Fimages.example%2Fa.png'), env);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining('PNG, JPEG, or GIF') });
  });

  it('rejects a MIME/signature mismatch and configured alternate self hosts', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const fetchMock = vi.fn().mockResolvedValue(new Response(png, { headers: { 'content-type': 'image/jpeg' } }));
    vi.stubGlobal('fetch', fetchMock);

    const mismatch = await worker.fetch(new Request('https://proxy.example/?imageUrl=https%3A%2F%2Fimages.example%2Fa.png'), env);
    const self = await worker.fetch(new Request('https://proxy.example/?imageUrl=https%3A%2F%2Falternate.example%2Fa.png'), {
      ...env,
      KNOWN_SELF_HOSTS: 'alternate.example',
    });

    expect(mismatch.status).toBe(400);
    expect(self.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('caps redirect chains at three hops and enforces optional per-IP rate limits', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, {
      status: 302,
      headers: { location: 'https://images.example/next.png' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const redirected = await worker.fetch(new Request('https://proxy.example/?imageUrl=https%3A%2F%2Fimages.example%2Fa.png'), env);
    const rateLimiter = { limit: vi.fn().mockResolvedValue({ success: false }) };
    const limited = await worker.fetch(new Request(`https://proxy.example/?sheetId=${sheetId}`, {
      headers: { 'cf-connecting-ip': '203.0.113.7' },
    }), { ...env, RATE_LIMITER: rateLimiter });

    expect(redirected.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('60');
    expect(rateLimiter.limit).toHaveBeenCalledWith({ key: 'sheets-proxy:203.0.113.7' });
  });

  it('enforces sheet response-byte and cell limits', async () => {
    const tooLarge = new Response('{}', { headers: { 'content-length': String(5 * 1024 * 1024 + 1) } });
    const tooManyCells = new Response(JSON.stringify({ values: Array.from({ length: 100_001 }, () => ['x']) }));
    const fetchMock = vi.fn().mockResolvedValueOnce(tooLarge).mockResolvedValueOnce(tooManyCells);
    vi.stubGlobal('fetch', fetchMock);

    const byteLimited = await worker.fetch(new Request(`https://proxy.example/?sheetId=${sheetId}&tabName=Data`), env);
    const cellLimited = await worker.fetch(new Request(`https://proxy.example/?sheetId=${sheetId}&tabName=Data`), env);

    expect(byteLimited.status).toBe(413);
    expect(cellLimited.status).toBe(413);
  });

  it('times out stalled upstream fetches and response bodies after 15 seconds', async () => {
    vi.useFakeTimers();
    try {
      const neverFetch = vi.fn().mockImplementation(() => new Promise(() => undefined));
      vi.stubGlobal('fetch', neverFetch);
      const fetchTimeout = worker.fetch(new Request('https://proxy.example/?imageUrl=https%3A%2F%2Fimages.example%2Fa.png'), env);
      const fetchAssertion = expect(fetchTimeout).resolves.toMatchObject({ status: 504 });
      await vi.advanceTimersByTimeAsync(15_000);
      await fetchAssertion;

      const body = new ReadableStream({ pull: () => new Promise(() => undefined) });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { headers: { 'content-type': 'image/png' } })));
      const bodyTimeout = worker.fetch(new Request('https://proxy.example/?imageUrl=https%3A%2F%2Fimages.example%2Fb.png'), env);
      const bodyAssertion = expect(bodyTimeout).resolves.toMatchObject({ status: 504 });
      await vi.advanceTimersByTimeAsync(15_000);
      await bodyAssertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not await a hostile response body cancellation on error or redirect paths', async () => {
    const neverCancel = () => new Promise(() => undefined);
    const wrongType = new Response(new ReadableStream({ cancel: neverCancel }), { headers: { 'content-type': 'text/html' } });
    const oversize = new Response(new ReadableStream({ cancel: neverCancel }), {
      headers: { 'content-type': 'image/png', 'content-length': String(20 * 1024 * 1024 + 1) },
    });
    const redirect = new Response(new ReadableStream({ cancel: neverCancel }), {
      status: 302,
      headers: { location: 'https://images.example/final.png' },
    });
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(wrongType)
      .mockResolvedValueOnce(oversize)
      .mockResolvedValueOnce(redirect)
      .mockResolvedValueOnce(new Response(png, { headers: { 'content-type': 'image/png' } }));
    vi.stubGlobal('fetch', fetchMock);

    const wrongTypeResponse = await worker.fetch(new Request('https://proxy.example/?imageUrl=https%3A%2F%2Fimages.example%2Fa.png'), env);
    const oversizedResponse = await worker.fetch(new Request('https://proxy.example/?imageUrl=https%3A%2F%2Fimages.example%2Fb.png'), env);
    const redirectedResponse = await worker.fetch(new Request('https://proxy.example/?imageUrl=https%3A%2F%2Fimages.example%2Fc.png'), env);

    expect(wrongTypeResponse.status).toBe(400);
    expect(oversizedResponse.status).toBe(413);
    expect(redirectedResponse.status).toBe(200);
  });
});
