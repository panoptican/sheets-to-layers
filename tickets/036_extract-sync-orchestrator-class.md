## TICKET-036: Extract Sync Orchestrator Class

**Type:** Architecture Improvement
**Priority:** Medium
**Status:** Open
**Complexity:** High
**Estimated Effort:** 10-15 hours

### Description

The `sync-engine.ts` file has grown to 640+ lines with too many responsibilities: traversal orchestration, repeat frame processing, font loading, layer processing, image queueing, progress reporting, and error aggregation. This violates Single Responsibility Principle and makes the code hard to test, modify, and reason about.

### Current Issues

```typescript
// sync-engine.ts does EVERYTHING:
- runSync()              // Main orchestration
- processBatch()         // Batch processing
- processLayer()         // Individual layer sync
- applyFetchedImage()    // Image application
- Font loading logic     // Performance optimization
- Progress reporting     // UI updates
- Error aggregation      // Error handling
- Repeat frame handling  // Special case logic
```

### Proposed Structure

```typescript
// src/core/sync-orchestrator.ts
class SyncOrchestrator {
  constructor(
    private traversal: TraversalEngine,
    private layerProcessor: LayerProcessor,
    private imageQueue: ImageQueue,
    private progressReporter: ProgressReporter
  ) {}

  async sync(options: SyncOptions): Promise<SyncResult>
}

// src/core/layer-processor.ts
class LayerProcessor {
  async processLayer(node: SceneNode, binding: ParsedBinding): Promise<LayerResult>
}

// src/core/image-queue.ts
class ImageQueue {
  queue(node: SceneNode, url: string): void
  async processAll(): Promise<ImageResult[]>
}

// src/core/progress-reporter.ts
class ProgressReporter {
  update(current: number, total: number): void
}
```

### Benefits

- **Testability:** Each class tested independently
- **Maintainability:** Changes isolated to specific classes
- **Readability:** Clear separation of concerns
- **Extensibility:** Easy to add new features
- **Parallelization:** Image queue can process concurrently

### Acceptance Criteria

- [ ] SyncOrchestrator class created
- [ ] Dependencies injected via constructor
- [ ] Each responsibility in own class/module
- [ ] All tests pass
- [ ] No regression in functionality
- [ ] Code coverage maintained or improved

### Related Issues

- Related to all sync-related tickets (019, 022, etc.)
