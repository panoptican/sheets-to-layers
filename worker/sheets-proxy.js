/**
 * Cloudflare Worker: Google Sheets and public-image proxy.
 *
 * This source enforces request, redirect, type, and byte limits. A deployed
 * public endpoint still needs Cloudflare rate/abuse controls; source-level URL
 * checks cannot prevent DNS rebinding or inspect every destination address.
 */

const REQUEST_DEADLINE_MS = 15_000;
const MAX_REDIRECTS = 3;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_SHEET_BYTES = 5 * 1024 * 1024;
const MAX_SHEET_CELLS = 100_000;
const RATE_LIMIT_RETRY_AFTER_SECONDS = 60;
const SPREADSHEET_ID_PATTERN = /^[A-Za-z0-9_-]{20,200}$/;
const IMAGE_TYPES = new Map([
  ['image/png', 'image/png'],
  ['image/jpeg', 'image/jpeg'],
  ['image/gif', 'image/gif'],
]);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

class ProxyError extends Error {
  constructor(message, status = 400, retryAfter = null) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

function errorResponse(error, fallbackMessage) {
  const safe = error instanceof ProxyError
    ? error
    : new ProxyError(fallbackMessage, 502);
  const response = jsonResponse({ error: safe.message }, safe.status);
  if (safe.retryAfter) response.headers.set('Retry-After', safe.retryAfter);
  return response;
}

function quoteA1SheetName(name) {
  return `'${name.replace(/'/g, "''")}'`;
}

function validSpreadsheetId(sheetId) {
  return typeof sheetId === 'string' && SPREADSHEET_ID_PATTERN.test(sheetId);
}

function isPrivateOrLocalHost(hostname, selfHosts) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (selfHosts.has(host) || host === 'localhost' || host.endsWith('.localhost')) return true;
  if (isPrivateIpv4(host)) return true;
  if (!host.includes(':')) return false;

  const mapped = /(?:^|:)ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(host);
  if (mapped && isPrivateIpv4(mapped[1])) return true;
  const mappedHex = /(?:^|:)ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(host);
  if (mappedHex) {
    const high = Number.parseInt(mappedHex[1], 16);
    const low = Number.parseInt(mappedHex[2], 16);
    if (isPrivateIpv4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`)) return true;
  }
  // fe80::/10 is link-local; fec0::/10 is deprecated site-local. URL
  // normalization keeps the leading four-hex-digit hextet when present.
  if (host === '::' || host === '::1' || /^fe[89a-f][0-9a-f]:/i.test(host) || /^f[cd][0-9a-f]{2}:/i.test(host) || /^ff[0-9a-f:]*$/i.test(host)) return true;
  return false;
}

function cancelBody(body) {
  if (!body) return;
  try {
    const cancelled = body.cancel();
    if (cancelled && typeof cancelled.catch === 'function') void cancelled.catch(() => undefined);
  } catch {
    // Cancellation is best effort. Never let an upstream stream's cancel()
    // implementation extend this proxy's timeout or error response path.
  }
}

function isPrivateIpv4(host) {
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && (b === 168 || b === 0 || (b === 0 && c === 2))) return true;
  if (a === 198 && (b === 18 || b === 19 || b === 51)) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  return false;
}

function validateImageUrl(value, selfHosts) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new ProxyError('Image URL must be a valid HTTPS URL');
  }
  if (url.protocol !== 'https:') throw new ProxyError('Image URL must use HTTPS');
  if (url.username || url.password) throw new ProxyError('Image URL must not include credentials');
  if (isPrivateOrLocalHost(url.hostname, selfHosts)) {
    throw new ProxyError('Image URL points to a private, local, or proxy host');
  }
  return url;
}

function createDeadlineSignal() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_DEADLINE_MS);
  return { signal: controller.signal, cleanup: () => clearTimeout(timeoutId) };
}

function awaitWithSignal(promise, signal) {
  if (signal.aborted) return Promise.reject(new ProxyError('Upstream request timed out', 504));
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(new ProxyError('Upstream request timed out', 504));
    };
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => { cleanup(); resolve(value); },
      (error) => { cleanup(); reject(error); }
    );
  });
}

async function readBytesLimited(response, maxBytes, signal) {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > maxBytes) {
    cancelBody(response.body);
    throw new ProxyError(`Response exceeds the ${Math.floor(maxBytes / 1024 / 1024)} MiB limit`, 413);
  }

  if (!response.body) {
    const data = new Uint8Array(await awaitWithSignal(response.arrayBuffer(), signal));
    if (data.byteLength > maxBytes) throw new ProxyError(`Response exceeds the ${Math.floor(maxBytes / 1024 / 1024)} MiB limit`, 413);
    return data;
  }

  const reader = response.body.getReader();
  const onAbort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', onAbort, { once: true });
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      if (signal.aborted) throw new ProxyError('Upstream request timed out', 504);
      const { done, value } = await awaitWithSignal(reader.read(), signal);
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        void reader.cancel().catch(() => undefined);
        throw new ProxyError(`Response exceeds the ${Math.floor(maxBytes / 1024 / 1024)} MiB limit`, 413);
      }
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
  const data = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return data;
}

function imageTypeFromSignature(data) {
  if (data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47
    && data[4] === 0x0d && data[5] === 0x0a && data[6] === 0x1a && data[7] === 0x0a) return 'image/png';
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data.length >= 6 && String.fromCharCode(...data.slice(0, 6)) === 'GIF87a') return 'image/gif';
  if (data.length >= 6 && String.fromCharCode(...data.slice(0, 6)) === 'GIF89a') return 'image/gif';
  return null;
}

async function fetchPublicImage(originalUrl, selfHosts) {
  let target = validateImageUrl(originalUrl, selfHosts);
  const deadline = createDeadlineSignal();
  try {
    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
      const response = await awaitWithSignal(fetch(target.toString(), { redirect: 'manual', signal: deadline.signal }), deadline.signal);
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        cancelBody(response.body);
        if (!location) throw new ProxyError('Image redirect did not provide a destination');
        if (redirectCount === MAX_REDIRECTS) throw new ProxyError('Image redirect limit exceeded');
        target = validateImageUrl(new URL(location, target).toString(), selfHosts);
        continue;
      }
      if (!response.ok) {
        cancelBody(response.body);
        throw new ProxyError(`Image host returned ${response.status}`, response.status, response.headers.get('retry-after'));
      }

      const contentType = (response.headers.get('content-type') || '').split(';', 1)[0].toLowerCase();
      if (!IMAGE_TYPES.has(contentType)) {
        cancelBody(response.body);
        throw new ProxyError('Image must be PNG, JPEG, or GIF for Figma');
      }
      const data = await readBytesLimited(response, MAX_IMAGE_BYTES, deadline.signal);
      const signatureType = imageTypeFromSignature(data);
      if (!signatureType || signatureType !== contentType) {
        throw new ProxyError('Image content is not a valid PNG, JPEG, or GIF');
      }
      return { data, contentType: signatureType };
    }
    throw new Error('Image redirect limit exceeded');
  } catch (error) {
    if (deadline.signal.aborted) throw new ProxyError('Image request timed out after 15 seconds', 504);
    throw error;
  } finally {
    deadline.cleanup();
  }
}

function knownSelfHosts(requestHostname, configuredHosts) {
  const hosts = [requestHostname, ...(typeof configuredHosts === 'string' ? configuredHosts.split(',') : [])];
  return new Set(hosts.map((host) => host.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')).filter(Boolean));
}

async function enforceRateLimit(request, rateLimiter) {
  if (!rateLimiter || typeof rateLimiter.limit !== 'function') return null;
  // Capacity belongs to the deployment binding (currently 600 requests/minute
  // per IP). Cloudflare rate limits are per-location and intentionally coarse.
  const clientIp = request.headers.get('cf-connecting-ip') || 'unknown-client';
  const result = await rateLimiter.limit({ key: `sheets-proxy:${clientIp}` });
  if (result?.success === false) {
    const response = jsonResponse({ error: 'Too many requests. Try again in one minute.' }, 429);
    response.headers.set('Retry-After', String(RATE_LIMIT_RETRY_AFTER_SECONDS));
    return response;
  }
  return null;
}

async function fetchSheetsJson(url) {
  const deadline = createDeadlineSignal();
  try {
    const response = await awaitWithSignal(fetch(url, { signal: deadline.signal }), deadline.signal);
    const text = new TextDecoder().decode(await readBytesLimited(response, MAX_SHEET_BYTES, deadline.signal));
    if (!response.ok) {
      if (response.status === 403) throw new ProxyError('Sheet is not publicly accessible or API key is invalid', 403);
      if (response.status === 404) throw new ProxyError('Spreadsheet not found', 404);
      throw new ProxyError('Google Sheets request failed', response.status, response.headers.get('retry-after'));
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new ProxyError('Google Sheets returned invalid JSON', 502);
    }
  } catch (error) {
    if (deadline.signal.aborted) throw new ProxyError('Google Sheets request timed out after 15 seconds', 504);
    throw error;
  } finally {
    deadline.cleanup();
  }
}

function assertCellLimit(values) {
  if (!Array.isArray(values)) throw new ProxyError('Google Sheets returned invalid values', 502);
  let cells = 0;
  for (const row of values) {
    if (!Array.isArray(row)) throw new ProxyError('Google Sheets returned invalid row data', 502);
    cells += row.length;
    if (cells > MAX_SHEET_CELLS) throw new ProxyError('Sheet exceeds the 100,000-cell import limit', 413);
  }
}

function buildSheetsUrl(sheetId, tabName, getBoldInfo, apiKey) {
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}`;
  const url = new URL(tabName && !getBoldInfo ? `${base}/values/${encodeURIComponent(quoteA1SheetName(tabName))}` : base);
  if (tabName && getBoldInfo) {
    const reference = quoteA1SheetName(tabName);
    url.searchParams.append('ranges', `${reference}!1:1`);
    url.searchParams.append('ranges', `${reference}!A1:A100`);
    url.searchParams.set('fields', 'sheets.data.rowData.values.effectiveFormat.textFormat.bold');
  } else if (!tabName) {
    url.searchParams.set('fields', 'sheets.properties');
  }
  url.searchParams.set('key', apiKey);
  return url.toString();
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
    if (request.method !== 'GET') return jsonResponse({ error: 'Only GET requests are supported' }, 405);

    const rateLimited = await enforceRateLimit(request, env.RATE_LIMITER);
    if (rateLimited) return rateLimited;

    const url = new URL(request.url);
    const sheetId = url.searchParams.get('sheetId');
    const tabName = url.searchParams.get('tabName');
    const imageUrl = url.searchParams.get('imageUrl');
    const getBoldInfo = url.searchParams.get('boldInfo') === 'true';

    if (imageUrl) {
      if (sheetId || tabName || getBoldInfo) return jsonResponse({ error: 'Image requests cannot include sheet parameters' }, 400);
      try {
        const image = await fetchPublicImage(imageUrl, knownSelfHosts(url.hostname, env.KNOWN_SELF_HOSTS));
        return new Response(image.data, {
          headers: {
            ...corsHeaders,
            'Content-Type': image.contentType,
            'Cache-Control': 'public, max-age=86400',
            'X-Content-Type-Options': 'nosniff',
          },
        });
      } catch (error) {
        return errorResponse(error, 'Image proxy request failed');
      }
    }

    if (!validSpreadsheetId(sheetId)) return jsonResponse({ error: 'Invalid spreadsheet ID' }, 400);
    if (getBoldInfo && !tabName) return jsonResponse({ error: 'boldInfo requires tabName' }, 400);
    if (!env.GOOGLE_API_KEY) return jsonResponse({ error: 'Server misconfigured: missing API key' }, 500);

    try {
      const data = await fetchSheetsJson(buildSheetsUrl(sheetId, tabName, getBoldInfo, env.GOOGLE_API_KEY));
      if (tabName && getBoldInfo) return jsonResponse(extractBoldInfo(data, tabName));
      if (tabName) {
        const values = data.values || [];
        assertCellLimit(values);
        return jsonResponse({ tabName, values });
      }
      if (!Array.isArray(data.sheets)) throw new ProxyError('Google Sheets returned invalid worksheet metadata', 502);
      return jsonResponse({ sheets: data.sheets.map((sheet) => ({
        title: sheet.properties?.title,
        sheetId: sheet.properties?.sheetId,
        index: sheet.properties?.index,
      })).filter((sheet) => typeof sheet.title === 'string' && Number.isInteger(sheet.sheetId)) });
    } catch (error) {
      return errorResponse(error, 'Google Sheets request failed');
    }
  },
};

function extractBoldInfo(data, tabName) {
  const ranges = data.sheets?.[0]?.data || [];
  const firstRowBold = (ranges[0]?.rowData?.[0]?.values || [])
    .map((cell) => cell?.effectiveFormat?.textFormat?.bold === true);
  const firstColBold = (ranges[1]?.rowData || [])
    .map((row) => row.values?.[0]?.effectiveFormat?.textFormat?.bold === true);
  return { tabName, firstRowBold, firstColBold };
}

export { buildSheetsUrl, quoteA1SheetName, validateImageUrl };
