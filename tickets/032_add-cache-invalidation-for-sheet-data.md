## TICKET-032: Add Cache Invalidation for Sheet Data

**Type:** Feature Enhancement
**Priority:** Medium
**Status:** Open
**Complexity:** Low
**Estimated Effort:** 2 hours

### Description

Cached sheet data has no expiration or staleness checking. Users performing resync operations may get outdated data if the sheet has changed since the initial fetch, leading to confusion and incorrect syncs.

### Current Behavior

```typescript
// code.ts:253-264
let cachedSheetData: SheetData | null = null;

// Cache is never invalidated, even if:
// - Sheet URL changes
// - Hours/days pass
// - Sheet content is updated
```

### Expected Behavior

Cache should be invalidated when:
1. Sheet URL changes
2. Cache age exceeds TTL (e.g., 5 minutes)
3. User explicitly requests fresh fetch
4. Error occurs during sync (stale data may be cause)

### Solution

```typescript
interface CachedSheetData {
  data: SheetData;
  url: string;
  timestamp: number;
}

let cachedSheetData: CachedSheetData | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function isCacheValid(currentUrl: string): boolean {
  if (!cachedSheetData) return false;

  const ageMs = Date.now() - cachedSheetData.timestamp;
  const urlMatches = cachedSheetData.url === currentUrl;
  const notExpired = ageMs < CACHE_TTL_MS;

  return urlMatches && notExpired;
}

// Usage:
if (isCacheValid(sheetUrl)) {
  // Use cached data
} else {
  // Fetch fresh data
  cachedSheetData = {
    data: freshData,
    url: sheetUrl,
    timestamp: Date.now()
  };
}
```

### Testing Requirements

- Test cache expires after TTL
- Test cache invalidates on URL change
- Test cache persists within TTL
- Test explicit cache clearing

### Acceptance Criteria

- [ ] Cache includes timestamp and URL
- [ ] Cache expires after 5 minutes
- [ ] Cache invalidates on URL change
- [ ] UI provides "Force Refresh" option
- [ ] Tests verify invalidation logic

### Related Issues

- Related to TICKET-003 (Data Fetching)
- Related to TICKET-020 (Resync Functionality)
