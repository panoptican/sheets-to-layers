## TICKET-037: Refactor Index Tracker to Immutable State

**Type:** Architecture Improvement
**Priority:** Low
**Status:** Open
**Complexity:** Medium
**Estimated Effort:** 4-6 hours

### Description

The IndexTracker class uses mutable state (Map mutations) that's modified during sync, making it difficult to reason about, hard to parallelize, and prone to race conditions if sync ever becomes async.

### Current Implementation

```typescript
class IndexTracker {
  private counters = new Map<string, CounterState>();

  resolveIndex(key: string, mode: IndexMode): number {
    // Mutates this.counters
    const state = this.counters.get(key) || initialState;
    state.current++;  // Mutation!
    this.counters.set(key, state);
    return state.current;
  }
}
```

### Issues

- **Mutation:** Hard to track state changes
- **Side effects:** Method call modifies internal state
- **Testing:** Must reset state between tests
- **Parallelization:** Can't parallelize if state is shared
- **Debugging:** Can't inspect state at specific point in time

### Proposed Solution

```typescript
interface IndexState {
  readonly counters: ReadonlyMap<string, CounterState>;
}

function resolveIndex(
  state: IndexState,
  key: string,
  mode: IndexMode
): [IndexState, number] {
  const counter = state.counters.get(key) || initialState;
  const newCounter = { ...counter, current: counter.current + 1 };
  const newCounters = new Map(state.counters).set(key, newCounter);

  return [
    { counters: newCounters },  // New state
    newCounter.current          // Resolved index
  ];
}
```

### Benefits

- **Immutability:** No hidden side effects
- **Testability:** Pure functions, easy to test
- **Debuggability:** Can inspect state at any point
- **Parallelization:** State can be split/merged
- **Time-travel:** Can replay state changes

### Acceptance Criteria

- [ ] IndexTracker returns new state instead of mutating
- [ ] All mutations removed
- [ ] Tests updated for new API
- [ ] Performance benchmarks show <5% overhead
- [ ] All sync operations use new API

### Related Issues

- Related to TICKET-008 (Index Tracking System)
- Related to TICKET-022 (Performance)
