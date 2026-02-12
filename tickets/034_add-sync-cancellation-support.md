## TICKET-034: Add Sync Cancellation Support

**Type:** Feature Enhancement
**Priority:** Medium
**Status:** Open
**Complexity:** High
**Estimated Effort:** 6-8 hours

### Description

Long-running sync operations cannot be cancelled. Users must wait for completion or force-quit Figma, losing work. This is especially problematic for large documents with hundreds of layers or slow image fetches.

### Current Behavior

Once sync starts, there's no way to stop it:
- No cancel button in UI
- No abort mechanism in sync engine
- Must wait for completion (potentially minutes)
- Force-quit is only option

### Expected Behavior

Users should be able to:
1. Click "Cancel" button during sync
2. See sync gracefully abort
3. Receive partial results (what synced before cancel)
4. Return to editable state immediately

### Solution

**Use AbortSignal Pattern**

```typescript
// In sync-engine.ts
interface SyncOptions {
  scope: SyncScope;
  sheetData: SheetData;
  signal?: AbortSignal;  // NEW
}

async function runSync(options: SyncOptions): Promise<SyncResult> {
  const { signal } = options;

  for (const batch of batches) {
    // Check cancellation before each batch
    if (signal?.aborted) {
      return {
        success: false,
        cancelled: true,
        layersProcessed: processedCount,
        message: 'Sync cancelled by user'
      };
    }

    await processBatch(batch, signal);
  }
}

// In UI
let abortController: AbortController | null = null;

function startSync() {
  abortController = new AbortController();

  sendToPlugin({
    type: 'SYNC_START',
    payload: {
      signal: abortController.signal
    }
  });
}

function cancelSync() {
  abortController?.abort();
  abortController = null;
}
```

**UI Changes**

```html
<!-- During sync -->
<div class="sync-progress">
  <progress value="{percent}" max="100"></progress>
  <button onclick="cancelSync()">Cancel</button>
</div>
```

### Testing Requirements

**Unit Tests:**
- Test sync cancels on abort signal
- Test partial results returned
- Test no state corruption after cancel
- Test cancellation during different phases

**Integration Tests:**
- Cancel during font loading
- Cancel during image fetching
- Cancel during repeat frame processing
- Verify document state is consistent

### Acceptance Criteria

- [ ] AbortSignal propagated through sync engine
- [ ] Cancel button appears during sync
- [ ] Sync checks signal between batches
- [ ] Partial results returned on cancel
- [ ] No memory leaks from cancelled operations
- [ ] Document state remains consistent
- [ ] Clear user feedback on cancellation
- [ ] Tests verify cancellation at each phase

### Related Issues

- Related to TICKET-019 (Sync Engine Orchestration)
- Related to TICKET-022 (Performance Optimization)
- Related to TICKET-031 (Image Fetch Timeouts)
