## TICKET-042: Optimize Component Cache Rebuild After Repeat Frames

**Type:** Performance Optimization
**Priority:** Medium
**Status:** Open
**Complexity:** Medium
**Estimated Effort:** 3-4 hours

### Description

After processing repeat frames, the sync engine re-traverses the ENTIRE document to rebuild the component cache. This is expensive and unnecessary since most components don't change.

### Current Behavior

```typescript
// sync-engine.ts:113-117
if (repeatResults.framesProcessed > 0) {
  // Re-traverse ENTIRE document (expensive!)
  const refreshedTraversal = await singlePassTraversal({ scope });
  componentCache = refreshedTraversal.componentCache;
}
```

### Issues

- **Redundant Work:** Re-scanning thousands of nodes
- **Performance Hit:** Can take 100ms+ for large docs
- **Wasted Resources:** Most components unchanged
- **Scaling:** Gets worse as document grows

### Proposed Solutions

**Option 1: Incremental Cache Update**

```typescript
// Only scan repeat frames for new components
function updateComponentCache(
  cache: Map<string, ComponentNode>,
  processedFrames: FrameNode[]
): Map<string, ComponentNode> {
  const newCache = new Map(cache);

  for (const frame of processedFrames) {
    // Only traverse children of changed frames
    traverseForComponents(frame, newCache);
  }

  return newCache;
}
```

**Option 2: Lazy Cache Rebuild**

```typescript
// Mark cache as dirty, rebuild on next use
let componentCacheDirty = false;

if (repeatResults.framesProcessed > 0) {
  componentCacheDirty = true;
}

// Later, when cache is needed:
if (componentCacheDirty) {
  componentCache = await rebuildCache();
  componentCacheDirty = false;
}
```

**Option 3: Don't Rebuild (if not needed)**

```typescript
// Only rebuild if component swapping is actually used
const needsComponentCache = bindings.some(b =>
  b.type === 'component-swap'
);

if (needsComponentCache && repeatResults.framesProcessed > 0) {
  // Rebuild only if necessary
}
```

**Recommendation:** Combine Option 1 + Option 3

### Performance Impact

**Before:**
- Full document traversal: 100-500ms
- Every sync with repeat frames

**After:**
- Incremental update: 5-20ms
- Only when component swaps exist

**Improvement: 10-100x faster**

### Acceptance Criteria

- [ ] Incremental cache update implemented
- [ ] Only scans changed frames
- [ ] Skips rebuild if no component swaps
- [ ] Benchmark shows significant improvement
- [ ] All component swaps still work
- [ ] Tests verify cache correctness

### Related Issues

- Related to TICKET-016 (Layer Repetition)
- Related to TICKET-011 (Component Swapping)
- Related to TICKET-022 (Performance)
