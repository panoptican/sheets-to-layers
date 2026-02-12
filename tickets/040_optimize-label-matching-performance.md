## TICKET-040: Optimize Label Matching Performance

**Type:** Performance Optimization
**Priority:** Medium
**Status:** Open
**Complexity:** Low
**Estimated Effort:** 2-3 hours

### Description

The `matchLabel()` function in `parser.ts` performs O(n²) substring matching for every layer binding, resulting in thousands of comparisons for documents with many layers and labels.

### Current Performance

```typescript
// parser.ts:218-243
export function matchLabel(
  layerLabel: string,
  sheetLabels: string[]
): string | null {
  const normalized = normalizeLabel(layerLabel);

  for (const sheetLabel of sheetLabels) {  // O(n)
    const normalizedSheet = normalizeLabel(sheetLabel);
    if (normalized.includes(normalizedSheet)) {  // O(m) string search
      return sheetLabel;
    }
  }
  return null;
}

// With 100 layers × 50 sheet labels = 5,000 comparisons per sync!
```

### Proposed Optimization

```typescript
// Build normalized label index once
class LabelMatcher {
  private labelIndex: Map<string, string>;

  constructor(sheetLabels: string[]) {
    this.labelIndex = new Map(
      sheetLabels.map(label => [
        normalizeLabel(label),
        label
      ])
    );
  }

  match(layerLabel: string): string | null {
    const normalized = normalizeLabel(layerLabel);

    // O(1) exact match
    if (this.labelIndex.has(normalized)) {
      return this.labelIndex.get(normalized)!;
    }

    // O(n) substring match (only if exact fails)
    for (const [normalizedSheet, original] of this.labelIndex) {
      if (normalized.includes(normalizedSheet)) {
        return original;
      }
    }

    return null;
  }
}

// Usage:
const matcher = new LabelMatcher(sheetData.labels);
const matched = matcher.match(binding.label);  // Fast!
```

### Performance Impact

**Before:**
- 100 layers, 50 labels: 5,000 comparisons
- Each comparison: normalize + includes check
- Total: ~10ms per sync

**After:**
- Index build: 50 normalizations (one-time)
- 100 lookups: O(1) for exact, O(n) for substring
- Total: ~1-2ms per sync

**Improvement: 5-10x faster**

### Testing Requirements

- Benchmark before/after with large documents
- Test exact matches (should be O(1))
- Test substring matches (fallback to O(n))
- Test case-insensitive matching
- Verify correctness maintained

### Acceptance Criteria

- [ ] LabelMatcher class created
- [ ] Index built once per sync
- [ ] O(1) exact match lookup
- [ ] O(n) fallback for substring
- [ ] Benchmarks show 5x+ improvement
- [ ] All existing tests pass
- [ ] No regression in matching behavior

### Related Issues

- Related to TICKET-005 (Basic Label Syntax)
- Related to TICKET-022 (Performance Optimization)
