## TICKET-030: Add Undo Support for Repeat Frame Operations

**Type:** Feature Enhancement
**Priority:** Medium
**Status:** Open
**Complexity:** Medium
**Estimated Effort:** 3-4 hours

### Description

Repeat frame operations (duplicating/removing children with `@#` syntax) currently lack transaction wrapping and undo support. If an operation partially fails, there's no way to roll back, leaving the document in an inconsistent state.

### Current Behavior

In `repeat-frame.ts` lines ~264-275:

```typescript
// Add children
for (let i = currentCount; i < targetCount; i++) {
  const clone = template.clone();
  frame.appendChild(clone);
  result.childrenAdded++;
}

// Remove children
for (let i = currentCount; i > targetCount; i--) {
  const child = frame.children[frame.children.length - 1];
  child.remove();
  result.childrenRemoved++;
}
```

**Issues:**
- No error handling if clone fails midway
- No rollback if appendChild fails
- No transaction boundary for multiple operations
- Partial failures leave document in unknown state

### Expected Behavior

Repeat frame operations should:
1. Wrap changes in try/catch with rollback
2. Track all modified nodes for cleanup
3. Provide transactional semantics (all-or-nothing)
4. Report clear errors on failure

### Example Failure Scenario

1. Sheet specifies 10 items for repeat frame
2. Currently has 3 items
3. Clone succeeds for items 4, 5, 6
4. Clone fails for item 7 (out of memory, plugin crash, etc.)
5. **Result:** Document has 6 items instead of 3 or 10 (inconsistent state)

### Impact

**Severity:** Medium
- **Data Integrity:** Partial operations corrupt document state
- **User Frustration:** Undo doesn't work as expected
- **Debugging Difficulty:** Hard to reproduce inconsistent states
- **Trust Issues:** Users lose confidence in plugin reliability

### Affected Files

- `src/core/repeat-frame.ts` (lines ~264-320 in `syncRepeatFrameContent()`)

### Solution

**Approach: Transaction Pattern with Rollback**

```typescript
interface Transaction {
  addedNodes: SceneNode[];
  removedNodes: { node: SceneNode; parent: BaseNode & ChildrenMixin; index: number }[];
}

async function syncRepeatFrameContent(
  frame: FrameNode,
  targetCount: number,
  sheetData: SheetData,
  orientation: 'horizontal' | 'vertical'
): Promise<RepeatFrameResult> {
  const result: RepeatFrameResult = {
    success: true,
    childrenAdded: 0,
    childrenRemoved: 0,
    errors: []
  };

  const transaction: Transaction = {
    addedNodes: [],
    removedNodes: []
  };

  try {
    // Current count
    const currentCount = frame.children.length;

    if (currentCount === 0) {
      throw new AppError(
        'sync',
        'Repeat frame must have at least one child as template'
      );
    }

    const template = frame.children[0];

    // ADD CHILDREN
    if (targetCount > currentCount) {
      for (let i = currentCount; i < targetCount; i++) {
        try {
          const clone = template.clone();
          frame.appendChild(clone);

          // Track for potential rollback
          transaction.addedNodes.push(clone);
          result.childrenAdded++;
        } catch (error) {
          // Rollback all additions
          rollbackTransaction(transaction);
          throw new AppError(
            'sync',
            `Failed to add child ${i + 1} to repeat frame`,
            error
          );
        }
      }
    }

    // REMOVE CHILDREN
    else if (targetCount < currentCount) {
      // Start from end, keep first (template)
      for (let i = currentCount - 1; i >= targetCount; i--) {
        try {
          const child = frame.children[i];
          const parent = child.parent;
          const index = parent && 'children' in parent
            ? Array.from(parent.children).indexOf(child)
            : -1;

          // Track for potential rollback
          transaction.removedNodes.push({ node: child, parent: parent as any, index });

          child.remove();
          result.childrenRemoved++;
        } catch (error) {
          // Rollback all removals
          rollbackTransaction(transaction);
          throw new AppError(
            'sync',
            `Failed to remove child ${i + 1} from repeat frame`,
            error
          );
        }
      }
    }

    // Success - commit transaction (no action needed, changes are live)
    return result;

  } catch (error) {
    result.success = false;
    result.errors.push({
      type: 'sync',
      message: error instanceof Error ? error.message : 'Unknown error',
      layer: frame.name
    });
    return result;
  }
}

/**
 * Rollback transaction by undoing all changes.
 */
function rollbackTransaction(transaction: Transaction): void {
  // Remove all added nodes
  for (const node of transaction.addedNodes) {
    try {
      node.remove();
    } catch (error) {
      console.error('Failed to rollback added node:', error);
    }
  }

  // Restore all removed nodes
  for (const { node, parent, index } of transaction.removedNodes.reverse()) {
    try {
      if (parent && 'insertChild' in parent && index >= 0) {
        parent.insertChild(index, node);
      }
    } catch (error) {
      console.error('Failed to rollback removed node:', error);
    }
  }
}
```

### Alternative: Figma's Transaction API (if available)

```typescript
// Check if Figma supports transactions
if ('createTransaction' in figma) {
  const transaction = figma.createTransaction();
  try {
    // Perform operations
    transaction.commit();
  } catch (error) {
    transaction.rollback();
  }
}
```

**Note:** Figma's plugin API doesn't currently expose explicit transactions, so manual rollback is required.

### Testing Requirements

**Unit Tests:**

1. **Successful operations:**
```typescript
test('adds children successfully', async () => {
  const frame = createTestFrame(3);
  const result = await syncRepeatFrameContent(frame, 5, mockData, 'horizontal');

  expect(result.success).toBe(true);
  expect(result.childrenAdded).toBe(2);
  expect(frame.children.length).toBe(5);
});
```

2. **Failed clone operation:**
```typescript
test('rolls back on clone failure', async () => {
  const frame = createTestFrame(3);
  const template = frame.children[0];

  // Mock clone to fail on 3rd call
  let callCount = 0;
  vi.spyOn(template, 'clone').mockImplementation(() => {
    callCount++;
    if (callCount === 3) {
      throw new Error('Clone failed');
    }
    return template.clone();
  });

  const result = await syncRepeatFrameContent(frame, 8, mockData, 'horizontal');

  // Should rollback all additions
  expect(result.success).toBe(false);
  expect(frame.children.length).toBe(3); // Original count
});
```

3. **Failed remove operation:**
```typescript
test('rolls back on remove failure', async () => {
  const frame = createTestFrame(5);
  const lastChild = frame.children[4];

  // Mock remove to fail
  vi.spyOn(lastChild, 'remove').mockImplementation(() => {
    throw new Error('Remove failed');
  });

  const result = await syncRepeatFrameContent(frame, 2, mockData, 'horizontal');

  expect(result.success).toBe(false);
  expect(frame.children.length).toBe(5); // No changes
});
```

4. **Partial rollback:**
```typescript
test('rolls back multiple additions on failure', async () => {
  const frame = createTestFrame(2);

  // Allow 3 successful clones, then fail
  let cloneCount = 0;
  vi.spyOn(frame.children[0], 'clone').mockImplementation(() => {
    cloneCount++;
    if (cloneCount > 3) throw new Error('Clone failed');
    return mockNode();
  });

  await syncRepeatFrameContent(frame, 10, mockData, 'horizontal');

  // Should have original 2, not 2+3=5
  expect(frame.children.length).toBe(2);
});
```

**Integration Tests:**

1. Simulate out-of-memory during clone
2. Test with locked layers that can't be removed
3. Test with nested repeat frames
4. Test rollback with complex layer structures

### Acceptance Criteria

- [ ] All repeat frame operations wrapped in try/catch
- [ ] Failed operations trigger rollback to original state
- [ ] Rollback removes all added nodes
- [ ] Rollback restores all removed nodes (if possible)
- [ ] Clear error messages indicate what failed
- [ ] Document state is never partially modified
- [ ] All existing tests pass
- [ ] New tests cover rollback scenarios
- [ ] Performance impact is minimal (<5% overhead)
- [ ] Code review approved

### Edge Cases to Consider

1. **Clone fails due to memory limits**
2. **Remove fails due to locked layers**
3. **appendChild fails due to invalid parent**
4. **Rollback itself fails** (defensive logging)
5. **Concurrent modifications** (unlikely but possible)

### Performance Considerations

- Transaction tracking adds memory overhead (list of nodes)
- Rollback only happens on error (not common path)
- Consider: Only track if >10 operations (below that, cost is negligible)

### Related Issues

- Related to TICKET-016 (Layer Repetition)
- Related to TICKET-021 (Error Handling & User Notifications)
- Discovered during comprehensive code review

### Notes

**Why this matters:**
- Repeat frames are powerful but complex
- Users may have hundreds of items
- Failures midway are catastrophic to document state
- Better to fail cleanly than leave partial state

**Future enhancements:**
- Undo/redo integration (if Figma exposes API)
- Progress reporting for large operations
- Checkpoint/resume for very large repeat frames
