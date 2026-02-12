## TICKET-039: Add Dynamic Chunk Sizing for Batch Processing

**Type:** Architecture Improvement
**Priority:** Low
**Status:** Open
**Complexity:** Low
**Estimated Effort:** 2-3 hours

### Description

The sync engine uses a hardcoded chunk size of 50 layers per batch, which is suboptimal for both small documents (unnecessary overhead) and large documents (progress updates too infrequent).

### Current Behavior

```typescript
// sync-engine.ts:151
const CHUNK_SIZE = 50;  // Hardcoded

// Problems:
// - 10 layer doc: Chunking overhead for no benefit
// - 10,000 layer doc: Only 200 progress updates (every 50 layers)
```

### Proposed Solution

```typescript
function calculateOptimalChunkSize(totalLayers: number): number {
  // Target: ~20-50 chunks total
  // Min: 10 layers per chunk
  // Max: 100 layers per chunk

  const targetChunks = 30;
  const calculatedSize = Math.ceil(totalLayers / targetChunks);

  return Math.max(10, Math.min(100, calculatedSize));
}

// Examples:
// 100 layers → chunk size 10 (10 chunks)
// 1,000 layers → chunk size 33 (30 chunks)
// 10,000 layers → chunk size 100 (100 chunks)
```

### Benefits

- **Responsive UI:** More frequent updates for large docs
- **Less Overhead:** No chunking for tiny docs
- **Better Progress:** Smoother progress bar
- **Adaptive:** Automatically adjusts to document size

### Acceptance Criteria

- [ ] Dynamic chunk size calculation
- [ ] Chunk size between 10-100
- [ ] Tests verify calculation
- [ ] Performance impact <1%
- [ ] Progress updates are smooth

### Related Issues

- Related to TICKET-019 (Sync Orchestration)
- Related to TICKET-022 (Performance)
