## TICKET-043: Debounce Selection Change Events

**Type:** Performance Optimization
**Priority:** Low
**Status:** Open
**Complexity:** Low
**Estimated Effort:** 1 hour

### Description

Every selection change triggers an immediate message to UI, flooding the message queue when users drag across multiple layers or use shift+click to select many items rapidly.

### Current Behavior

```typescript
// code.ts:471-477
figma.on('selectionchange', () => {
  const hasSelection = figma.currentPage.selection.length > 0;
  sendToUI({
    type: 'SELECTION_CHANGED',
    payload: { hasSelection }
  });
});

// Dragging across 50 layers = 50 messages in <1 second
```

### Proposed Solution

```typescript
let selectionTimer: number | null = null;

figma.on('selectionchange', () => {
  // Clear pending message
  if (selectionTimer) {
    clearTimeout(selectionTimer);
  }

  // Debounce: only send after 100ms of no changes
  selectionTimer = setTimeout(() => {
    const hasSelection = figma.currentPage.selection.length > 0;
    sendToUI({
      type: 'SELECTION_CHANGED',
      payload: { hasSelection }
    });
    selectionTimer = null;
  }, 100);
});
```

### Benefits

- **Fewer Messages:** 1 message instead of 50
- **Better Performance:** Less UI thrashing
- **Smoother UX:** No lag during rapid selection
- **Lower CPU:** Fewer event handler calls

### Acceptance Criteria

- [ ] Selection events debounced (100ms)
- [ ] Final selection state always sent
- [ ] UI updates correctly after selection
- [ ] No performance regression
- [ ] Tests verify debouncing works

### Related Issues

- Related to TICKET-001 (Plugin Infrastructure)
- Related to TICKET-022 (Performance)
