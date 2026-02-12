## TICKET-028: Fix Worker Fetcher Response Validation

**Type:** Bug Fix
**Priority:** Critical
**Status:** Open
**Complexity:** Low
**Estimated Effort:** 1 hour

### Description

The `fetchBoldInfoViaWorker()` function in `worker-fetcher.ts` doesn't properly validate the fetch response before accessing its properties, leading to runtime errors when the response is undefined or malformed.

### Current Behavior

```typescript
// worker-fetcher.ts:159 (approximately)
const response = await fetch(url);
if (!response.ok) {  // ❌ Throws if response is undefined
  throw new Error(`Failed to fetch bold info: ${response.statusText}`);
}
```

**Error observed in tests:**
```
TypeError: Cannot read properties of undefined (reading 'ok')
```

### Expected Behavior

The function should validate that the response exists before accessing its properties:

```typescript
const response = await fetch(url);
if (!response || !response.ok) {
  throw new Error(`Failed to fetch bold info: ${response?.statusText || 'No response'}`);
}
```

### Steps to Reproduce

1. Configure plugin to use Cloudflare Worker fetching
2. Trigger a network failure scenario (disconnect network, invalid URL, etc.)
3. Attempt to sync a sheet
4. Observe `TypeError: Cannot read properties of undefined (reading 'ok')` in console

**OR via tests:**
1. Run test suite with incomplete Response mock
2. Observe test failure in worker-fetcher tests

### Impact

**Severity:** High
- **Production Crashes:** Plugin crashes with unhelpful error message
- **Poor User Experience:** Users see technical error instead of friendly message
- **Debugging Difficulty:** Error message doesn't indicate what failed
- **Test Flakiness:** Tests may fail intermittently if mocks incomplete

### Root Cause

The code assumes `fetch()` always returns a valid Response object, but:
- Network failures may return undefined
- Test mocks may not implement full Response interface
- CORS/network issues may produce null responses
- Aborted requests may produce undefined

### Affected Files

- `src/core/worker-fetcher.ts` (line ~159 in `fetchBoldInfoViaWorker()`)
- Potentially other fetch calls in same file:
  - `fetchSheetDataViaWorker()` (line ~110)
  - `fetchImageViaWorker()` (line ~200)

### Solution

**Step 1: Fix bold info fetching**

```typescript
export async function fetchBoldInfoViaWorker(
  sheetId: string,
  gid: string,
  workerUrl: string
): Promise<BoldInfo> {
  const url = `${workerUrl}/bold-info?sheetId=${encodeURIComponent(sheetId)}&gid=${encodeURIComponent(gid)}`;

  try {
    const response = await fetch(url);

    // Validate response exists and is successful
    if (!response) {
      throw new Error('No response received from worker');
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Worker returned ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    // ... rest of validation ...
  } catch (error) {
    if (error instanceof Error) {
      throw new AppError(
        'network',
        `Failed to fetch bold info via worker: ${error.message}`,
        error
      );
    }
    throw error;
  }
}
```

**Step 2: Audit all fetch calls**

Check these functions for similar issues:
- `fetchSheetDataViaWorker()`
- `fetchImageViaWorker()`
- Any other network calls in the codebase

**Step 3: Create helper function**

```typescript
/**
 * Validates a fetch response and throws descriptive error if invalid.
 */
async function validateFetchResponse(
  response: Response | null | undefined,
  context: string
): Promise<Response> {
  if (!response) {
    throw new Error(`No response received: ${context}`);
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`HTTP ${response.status} (${context}): ${errorText}`);
  }

  return response;
}

// Usage:
const response = await fetch(url);
await validateFetchResponse(response, 'fetching bold info');
```

### Testing Requirements

**Unit Tests:**

1. Test undefined response:
```typescript
test('handles undefined response', async () => {
  globalThis.fetch = vi.fn().mockResolvedValue(undefined);

  await expect(
    fetchBoldInfoViaWorker('id', 'gid', 'worker')
  ).rejects.toThrow('No response received');
});
```

2. Test null response:
```typescript
test('handles null response', async () => {
  globalThis.fetch = vi.fn().mockResolvedValue(null);

  await expect(
    fetchBoldInfoViaWorker('id', 'gid', 'worker')
  ).rejects.toThrow('No response received');
});
```

3. Test response without `ok` property:
```typescript
test('handles malformed response', async () => {
  globalThis.fetch = vi.fn().mockResolvedValue({
    status: 200
    // Missing 'ok' property
  });

  await expect(
    fetchBoldInfoViaWorker('id', 'gid', 'worker')
  ).rejects.toThrow();
});
```

4. Test network error:
```typescript
test('handles fetch rejection', async () => {
  globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

  await expect(
    fetchBoldInfoViaWorker('id', 'gid', 'worker')
  ).rejects.toThrow('Failed to fetch bold info via worker');
});
```

**Integration Tests:**

1. Mock network failure scenarios
2. Verify error messages are helpful to users
3. Test with actual Cloudflare Worker (if test environment available)

### Acceptance Criteria

- [ ] All fetch calls validate response before accessing properties
- [ ] Undefined/null responses produce clear error messages
- [ ] HTTP error responses include status code and error text
- [ ] Helper function created for consistent validation (optional)
- [ ] All existing tests pass
- [ ] New tests cover undefined/null response cases
- [ ] Error messages are user-friendly and actionable
- [ ] Code review approved

### Related Issues

- Related to TICKET-003 (Google Sheets Data Fetching)
- Related to TICKET-021 (Error Handling & User Notifications)
- Discovered during test suite execution and code review

### Notes

**Why this wasn't caught earlier:**
1. Most fetch calls succeed in production (happy path testing)
2. Test mocks may have provided partial Response objects that passed basic checks
3. Modern fetch implementations rarely return undefined (but it's possible)
4. The bug only manifests during network failures

**Similar issues to check:**
- All `await fetch()` calls in codebase
- All `response.ok`, `response.status`, `response.text()`, `response.json()` accesses
- Image fetching in `ui.ts`

**Browser compatibility:**
- Fetch API behavior varies across browsers
- Some browsers may return undefined on certain failures
- Defense in depth: validate even if "shouldn't happen"
