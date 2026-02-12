## TICKET-041: Add Global Font Cache Across Chunks

**Type:** Performance Optimization
**Priority:** Low
**Status:** Open
**Complexity:** Low
**Estimated Effort:** 1-2 hours

### Description

Font loading deduplication in `performance.ts` only works within a single batch/chunk. If the same font appears in multiple chunks, it gets loaded multiple times unnecessarily.

### Current Behavior

```typescript
// performance.ts:62-102
// Font cache is per-batch
const loadedFontKeys = new Set<string>();

// If "Roboto" appears in chunk 1 and chunk 3,
// it gets loaded twice
```

### Proposed Solution

```typescript
// Global font cache (lives for entire sync session)
const globalFontCache = new Set<string>();

export function resetFontCache(): void {
  globalFontCache.clear();
}

export async function loadFontsForNodes(
  nodes: TextNode[]
): Promise<void> {
  const fontsToLoad = new Set<FontName>();

  for (const node of nodes) {
    const fontKey = getFontKey(node.fontName);

    if (!globalFontCache.has(fontKey)) {
      fontsToLoad.add(node.fontName as FontName);
    }
  }

  // Load all unique fonts
  await Promise.all(
    Array.from(fontsToLoad).map(async (font) => {
      try {
        await figma.loadFontAsync(font);
        globalFontCache.add(getFontKey(font));
      } catch (error) {
        console.warn(`Failed to load font: ${font.family}`, error);
      }
    })
  );
}
```

### Benefits

- **Fewer API Calls:** Load each font once per sync
- **Faster Syncs:** Skip already-loaded fonts
- **Less Figma API Load:** Reduce redundant requests

### Acceptance Criteria

- [ ] Global font cache implemented
- [ ] Cache persists across chunks
- [ ] Cache cleared between sync sessions
- [ ] No redundant font loading
- [ ] Tests verify cross-chunk deduplication

### Related Issues

- Related to TICKET-022 (Performance Optimization)
- Related to TICKET-009 (Text Layer Sync)
