## TICKET-035: Refactor Dual Fetching Paths

**Type:** Architecture Improvement
**Priority:** Low
**Status:** Open
**Complexity:** High
**Estimated Effort:** 8-12 hours

### Description

The plugin maintains two parallel data fetching implementations (JSONP via `sheet-fetcher.ts` and Cloudflare Worker via `worker-fetcher.ts`), creating maintenance burden, testing complexity, and behavioral inconsistencies.

### Current Architecture

```
UI Thread
├─ sheet-fetcher.ts (JSONP/gviz)
│  ├─ fetchSheetDataViaJSONP()
│  ├─ parseCsvData()
│  └─ No bold info support
│
└─ worker-fetcher.ts (Cloudflare Worker)
   ├─ fetchSheetDataViaWorker()
   ├─ fetchBoldInfoViaWorker()
   ├─ fetchImageViaWorker()
   └─ Full feature support
```

### Problems

1. **Code Duplication:** Similar parsing logic in both paths
2. **Feature Disparity:** Worker supports bold info, JSONP doesn't
3. **Testing Burden:** Must test both code paths
4. **Maintenance:** Bug fixes needed in two places
5. **Complexity:** Configuration/fallback logic adds cognitive load

### Impact

- **Developer Velocity:** Changes take 2x time
- **Bug Risk:** Easy to fix one path, miss the other
- **Feature Gaps:** Hard to add features to both paths
- **Testing:** Doubles test surface area

### Proposed Solutions

**Option 1: Deprecate JSONP [RECOMMENDED]**

Remove `sheet-fetcher.ts` entirely, use Worker exclusively.

**Pros:**
- Single code path
- Consistent behavior
- Easier to maintain
- Better features (bold info, CORS)

**Cons:**
- Requires Cloudflare Worker
- Breaking change for users on JSONP

**Migration Path:**
```typescript
// Add deprecation warning
if (useJSONP) {
  console.warn(
    'JSONP fetching is deprecated and will be removed in v2.0. ' +
    'Please switch to Cloudflare Worker for better performance.'
  );
}

// v1.1: Add warning
// v1.2: Disable JSONP for new users
// v2.0: Remove JSONP entirely
```

**Option 2: Abstract Fetching Interface**

Create adapter pattern with single interface:

```typescript
interface SheetFetcher {
  fetchSheetData(url: string): Promise<SheetData>;
  fetchBoldInfo(sheetId: string, gid: string): Promise<BoldInfo>;
  fetchImage(url: string): Promise<Uint8Array>;
}

class WorkerFetcher implements SheetFetcher {
  // Worker implementation
}

class JSONPFetcher implements SheetFetcher {
  // JSONP implementation (limited)
  fetchBoldInfo() {
    throw new Error('Bold info not supported in JSONP mode');
  }
}

// Factory
function createFetcher(config: FetchConfig): SheetFetcher {
  return config.useWorker
    ? new WorkerFetcher(config.workerUrl)
    : new JSONPFetcher();
}
```

**Pros:**
- Clean abstraction
- Easier to add new fetchers (e.g., direct API)
- Better testability

**Cons:**
- Still maintains both paths
- Complexity of abstraction layer

**Option 3: Feature Flags**

Use feature detection to enable/disable features:

```typescript
const features = {
  boldInfo: fetcher.supportsBoldInfo(),
  imageProxy: fetcher.supportsImageProxy(),
  // ...
};

// Gracefully degrade
if (features.boldInfo) {
  const boldInfo = await fetcher.fetchBoldInfo();
} else {
  // Use fallback or skip feature
}
```

### Recommended Approach

**Short term (v1.1):**
- Implement Option 2 (adapter pattern)
- Add deprecation warnings for JSONP
- Document Worker as preferred method

**Long term (v2.0):**
- Implement Option 1 (remove JSONP)
- Single worker-based implementation
- Simpler codebase

### Migration Guide

For users currently on JSONP:

```markdown
## Migrating from JSONP to Cloudflare Worker

1. Deploy Cloudflare Worker (see worker/README.md)
2. Update plugin settings with Worker URL
3. Test sync functionality
4. JSONP will be removed in v2.0
```

### Testing Requirements

**Option 2 (Adapter):**
- Test both implementations through interface
- Test feature detection
- Test fallback behavior
- Mock both fetchers independently

**Option 1 (Deprecation):**
- Test migration path
- Test warning messages
- Test Worker-only mode
- Verify no JSONP code remains

### Acceptance Criteria

**For Adapter Pattern (v1.1):**
- [ ] SheetFetcher interface defined
- [ ] WorkerFetcher implements interface
- [ ] JSONPFetcher implements interface
- [ ] Factory creates appropriate fetcher
- [ ] All tests use interface, not implementations
- [ ] Feature detection works
- [ ] Deprecation warnings added

**For JSONP Removal (v2.0):**
- [ ] sheet-fetcher.ts deleted
- [ ] All JSONP references removed
- [ ] Worker is only fetching method
- [ ] Migration guide published
- [ ] Users notified in advance
- [ ] All tests updated

### File Changes

**Delete (v2.0):**
- `src/core/sheet-fetcher.ts`
- `tests/unit/sheet-fetcher.test.ts`

**Modify:**
- `src/ui/ui.ts` (remove JSONP logic)
- `src/core/types.ts` (single fetcher config)
- All consuming code

**Add (v1.1):**
- `src/core/fetcher-interface.ts`
- `src/core/fetcher-factory.ts`

### Related Issues

- Related to TICKET-003 (Data Fetching)
- Related to TICKET-022 (Performance)
- Discovered during architecture review
