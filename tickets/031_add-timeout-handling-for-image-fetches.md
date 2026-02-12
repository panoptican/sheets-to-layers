## TICKET-031: Add Timeout Handling for Image Fetches

**Type:** Feature Enhancement
**Priority:** High
**Status:** Open
**Complexity:** Low
**Estimated Effort:** 2 hours

### Description

Image fetching operations in `ui.ts` have no timeout, allowing slow or unresponsive image hosts to hang the plugin indefinitely. This creates a poor user experience where the plugin appears frozen with no way to cancel or continue.

### Current Behavior

In `ui.ts` lines ~299-372 (`fetchImageData` function):

```typescript
async function fetchImageData(url: string): Promise<Uint8Array> {
  const fetchUrl = shouldProxyImage(url)
    ? `${WORKER_URL}/image-proxy?url=${encodeURIComponent(url)}`
    : url;

  const response = await fetch(fetchUrl);  // ❌ No timeout!

  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();  // ❌ Can hang forever
  return new Uint8Array(arrayBuffer);
}
```

**Problem:** If the image host:
- Is slow to respond (>30s)
- Never responds (network hang)
- Streams data very slowly
- Has connection issues

The fetch will wait indefinitely, blocking the UI and preventing other syncs.

### Expected Behavior

Image fetches should:
1. Have a reasonable timeout (e.g., 30 seconds)
2. Abort the request if timeout exceeded
3. Provide clear error message to user
4. Allow sync to continue with other images
5. Report which image timed out for debugging

### User Impact

**Current experience:**
```
User: "Why is the plugin stuck? It's been 5 minutes..."
Support: "One of your images isn't loading. We can't tell which one or cancel it."
```

**Desired experience:**
```
User: Clicks sync
Plugin: Shows progress
Plugin: "Image timed out after 30s: https://slow-server.com/image.jpg"
User: Can fix URL and retry
```

### Affected Files

- `src/ui/ui.ts` (lines ~299-372 in `fetchImageData()`)
- Potentially affects all image bindings in sync operations

### Solution

**Use AbortController with Timeout**

```typescript
/**
 * Fetch image data with timeout.
 *
 * @param url - Image URL to fetch
 * @param timeoutMs - Timeout in milliseconds (default 30000)
 * @returns Image data as Uint8Array
 * @throws Error if fetch fails or times out
 */
async function fetchImageData(
  url: string,
  timeoutMs: number = 30000
): Promise<Uint8Array> {
  const fetchUrl = shouldProxyImage(url)
    ? `${WORKER_URL}/image-proxy?url=${encodeURIComponent(url)}`
    : url;

  // Create abort controller for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    // Fetch with abort signal
    const response = await fetch(fetchUrl, {
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // Read response with same timeout
    const arrayBuffer = await response.arrayBuffer();
    return new Uint8Array(arrayBuffer);

  } catch (error) {
    // Distinguish timeout from other errors
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(
        `Image fetch timed out after ${timeoutMs / 1000}s: ${url.substring(0, 100)}`
      );
    }
    throw error;

  } finally {
    // Always clear timeout
    clearTimeout(timeoutId);
  }
}
```

**Configuration Options**

Add user-configurable timeout:

```typescript
// In settings/constants
const IMAGE_FETCH_TIMEOUT_MS = 30000; // 30 seconds default

// Allow override via UI
interface SyncOptions {
  imageFetchTimeoutMs?: number;
}

// In UI settings
<label>
  Image Fetch Timeout (seconds):
  <input type="number" value="30" min="5" max="120" />
</label>
```

**Progress Reporting**

```typescript
// Report timeout in sync result
interface ImageSyncResult {
  success: boolean;
  timedOut?: boolean;
  timeoutUrl?: string;
  duration?: number;
}

// In sync engine
if (error.name === 'AbortError') {
  result.imageTimeouts.push({
    layer: node.name,
    url: imageUrl,
    timeoutMs: IMAGE_FETCH_TIMEOUT_MS
  });
}
```

### Testing Requirements

**Unit Tests:**

1. **Successful fetch within timeout:**
```typescript
test('fetches image successfully within timeout', async () => {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(100))
  });

  const data = await fetchImageData('https://example.com/image.jpg', 1000);

  expect(data).toBeInstanceOf(Uint8Array);
  expect(data.byteLength).toBe(100);
});
```

2. **Timeout triggers abort:**
```typescript
test('aborts fetch after timeout', async () => {
  // Mock slow response
  globalThis.fetch = vi.fn().mockImplementation(() =>
    new Promise(resolve => setTimeout(resolve, 5000))
  );

  await expect(
    fetchImageData('https://slow.com/image.jpg', 100)
  ).rejects.toThrow('timed out after 0.1s');
});
```

3. **Timeout cleanup:**
```typescript
test('clears timeout on success', async () => {
  const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(100))
  });

  await fetchImageData('https://example.com/image.jpg', 1000);

  expect(clearTimeoutSpy).toHaveBeenCalled();
});
```

4. **Timeout cleanup on error:**
```typescript
test('clears timeout on fetch error', async () => {
  const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

  globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

  await expect(
    fetchImageData('https://example.com/image.jpg', 1000)
  ).rejects.toThrow('Network error');

  expect(clearTimeoutSpy).toHaveBeenCalled();
});
```

5. **Custom timeout:**
```typescript
test('respects custom timeout value', async () => {
  const startTime = Date.now();

  globalThis.fetch = vi.fn().mockImplementation(() =>
    new Promise(resolve => setTimeout(resolve, 10000))
  );

  try {
    await fetchImageData('https://slow.com/image.jpg', 500);
  } catch (error) {
    const elapsed = Date.now() - startTime;
    expect(elapsed).toBeLessThan(1000); // Should timeout ~500ms
    expect(elapsed).toBeGreaterThan(400);
  }
});
```

**Integration Tests:**

1. Mock slow image server
2. Test multiple concurrent image fetches with varying speeds
3. Verify other images continue fetching after one times out
4. Test with actual Cloudflare Worker proxy

**Manual Testing:**

1. Create binding to intentionally slow URL
2. Sync and verify timeout triggers
3. Verify error message is clear and actionable
4. Test with multiple images, some fast, some slow
5. Verify UI remains responsive during timeout

### Acceptance Criteria

- [ ] All image fetches have 30-second default timeout
- [ ] Timeout triggers AbortController to cancel request
- [ ] Clear error message indicates which image timed out
- [ ] Timeout is configurable via UI settings (optional)
- [ ] Timeout is cleared on success and failure
- [ ] Other images continue fetching after timeout
- [ ] Progress UI shows timeout status
- [ ] All existing tests pass
- [ ] New tests cover timeout scenarios
- [ ] No memory leaks from uncleaned timeouts
- [ ] Code review approved

### Configuration Recommendations

**Default Timeout Values:**
- **Fast images (< 1MB):** 10 seconds
- **Medium images (1-5MB):** 30 seconds (default)
- **Large images (> 5MB):** 60 seconds
- **User override:** 5-120 seconds range

**Retry Strategy (optional enhancement):**
```typescript
async function fetchImageDataWithRetry(
  url: string,
  maxRetries: number = 2
): Promise<Uint8Array> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fetchImageData(url, IMAGE_FETCH_TIMEOUT_MS);
    } catch (error) {
      lastError = error as Error;
      if (attempt < maxRetries) {
        // Exponential backoff
        await new Promise(r => setTimeout(r, 1000 * attempt));
      }
    }
  }

  throw new Error(
    `Failed after ${maxRetries} attempts: ${lastError?.message}`
  );
}
```

### Related Issues

- Related to TICKET-010 (Image Fill Sync)
- Related to TICKET-021 (Error Handling & User Notifications)
- Related to TICKET-022 (Performance Optimization)
- Discovered during comprehensive code review

### Notes

**Why this is critical:**
- Image fetching is on the critical path for sync
- Users have no visibility into what's happening
- No way to cancel or skip problematic images
- Production systems must handle network failures gracefully

**Browser support:**
- AbortController is widely supported (Chrome 66+, Firefox 57+, Safari 12.1+)
- Figma's embedded browser supports it
- No polyfill needed

**Performance impact:**
- Minimal: setTimeout/clearTimeout are lightweight
- AbortController has negligible overhead
- Only impacts error cases (timeout path)

**Future enhancements:**
- Per-image timeout based on size
- Adaptive timeout based on network speed
- Parallel fetch limit (e.g., max 5 concurrent)
- Image fetch queue with priority
