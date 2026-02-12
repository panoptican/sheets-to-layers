## TICKET-029: Fix Resync Mode with No Stored Layer IDs

**Type:** Bug Fix
**Priority:** Critical
**Status:** Open
**Complexity:** Low
**Estimated Effort:** 1-2 hours

### Description

The resync functionality fails to perform any work when no previous layer IDs exist in plugin storage. Instead of falling back to a full page sync, it attempts a targeted sync with an empty array, resulting in zero layers being processed.

### Current Behavior

In `code.ts` lines ~94-114:

```typescript
async function handleResync() {
  const savedUrl = await figma.clientStorage.getAsync('lastSheetUrl');
  const savedLayerIds = await figma.clientStorage.getAsync('lastSyncedLayerIds');

  let storedLayerIds: string[] = [];

  if (Array.isArray(savedLayerIds) && savedLayerIds.length > 0) {
    storedLayerIds = savedLayerIds;
  } else {
    storedLayerIds = [];  // ❌ Empty array leads to no-op sync
  }

  // Later: targeted sync with empty array processes 0 layers
  const result = isResyncMode
    ? await runTargetedSync(...)  // Processes storedLayerIds (empty!)
    : await runSync({ scope: 'page', ... });
}
```

**Result:** When user clicks "Re-Sync" but no previous sync data exists, nothing happens.

### Expected Behavior

When no stored layer IDs exist, the plugin should:
1. Recognize this is a "first sync" situation
2. Fall back to full page sync
3. Process all layers as if it's a fresh sync

### Steps to Reproduce

1. Install plugin (or clear plugin storage)
2. Add layer bindings to your design (e.g., `#Label`)
3. Click "Re-Sync Google Sheets Data" relaunch button
4. Observe that no layers are synced (result shows 0 layers processed)

**Expected:** All layers with bindings should sync, just like first sync.

### Impact

**Severity:** High
- **Broken Feature:** Resync button doesn't work for new users
- **User Confusion:** "I clicked resync but nothing happened"
- **Workaround Required:** Users must open plugin UI and do full sync
- **Poor Onboarding:** New users trying resync feature hit immediate failure

### Root Cause

The code assumes that "resync mode" always means "targeted sync with previous layers," but fails to handle the case where no previous layers exist. This is a logical error in the mode selection:

```typescript
// Current (broken) logic:
if (isResyncMode) {
  runTargetedSync(emptyArray);  // No-op!
} else {
  runFullSync();
}

// Should be:
if (isResyncMode && hasPreviousLayerIds) {
  runTargetedSync(previousLayerIds);
} else {
  runFullSync();
}
```

### Affected Files

- `src/code.ts` (lines ~94-114 in `handleResync()`)
- `src/code.ts` (lines ~253-264 in main sync handler)

### Solution

**Option 1: Conditional sync mode [RECOMMENDED]**

```typescript
async function handleResync() {
  const savedUrl = await figma.clientStorage.getAsync('lastSheetUrl');
  const savedLayerIds = await figma.clientStorage.getAsync('lastSyncedLayerIds');

  // Get stored layer IDs if they exist
  const storedLayerIds: string[] =
    Array.isArray(savedLayerIds) && savedLayerIds.length > 0
      ? savedLayerIds
      : [];

  // Determine sync mode based on whether we have stored data
  const shouldUseTargetedSync = isResyncMode && storedLayerIds.length > 0;

  // Fetch sheet data
  sendToUI({ type: 'FETCH_SHEET', payload: { url: savedUrl || '' } });

  // ... wait for data ...

  // Use targeted sync only if we have stored layer IDs
  const result = shouldUseTargetedSync
    ? await runTargetedSync(storedLayerIds, sheetData, ...)
    : await runSync({ scope: 'page', ... });  // Full sync otherwise

  // ... rest of flow ...
}
```

**Option 2: Explicit check and user notification**

```typescript
if (isResyncMode) {
  const savedLayerIds = await figma.clientStorage.getAsync('lastSyncedLayerIds');

  if (!Array.isArray(savedLayerIds) || savedLayerIds.length === 0) {
    // Notify user and do full sync
    sendToUI({
      type: 'SYNC_RESULT',
      payload: {
        warning: 'No previous sync found. Performing full page sync.',
        // ... rest of result
      }
    });
  }

  // Proceed with appropriate sync type
}
```

**Recommendation:** Option 1 with optional notification in Option 2.

### Testing Requirements

**Unit Tests:**

1. Test resync with no stored data:
```typescript
test('resync with no stored layer IDs performs full sync', async () => {
  await figma.clientStorage.setAsync('lastSyncedLayerIds', []);

  // Trigger resync
  const result = await handleResync();

  // Should process all layers on page, not zero
  expect(result.layersProcessed).toBeGreaterThan(0);
});
```

2. Test resync with stored data:
```typescript
test('resync with stored layer IDs performs targeted sync', async () => {
  await figma.clientStorage.setAsync('lastSyncedLayerIds', ['id1', 'id2']);

  // Trigger resync
  const result = await handleResync();

  // Should only process stored layers
  expect(result.layersProcessed).toBe(2);
});
```

3. Test resync with undefined stored data:
```typescript
test('resync with undefined stored data performs full sync', async () => {
  await figma.clientStorage.deleteAsync('lastSyncedLayerIds');

  const result = await handleResync();
  expect(result.layersProcessed).toBeGreaterThan(0);
});
```

**Manual Testing:**

1. Clear plugin storage:
   - Figma Desktop: Delete plugin data
   - Or: Use `figma.clientStorage.deleteAsync('lastSyncedLayerIds')`
2. Create page with bound layers
3. Click "Re-Sync" relaunch button
4. Verify all layers sync successfully
5. Click "Re-Sync" again
6. Verify targeted sync works (only previous layers)

### Acceptance Criteria

- [ ] Resync with no stored data performs full page sync
- [ ] Resync with stored data performs targeted sync (existing behavior)
- [ ] User receives notification if no previous sync found (optional)
- [ ] All layers are processed when no stored IDs exist
- [ ] Storage is correctly updated after first resync
- [ ] Subsequent resyncs use targeted mode
- [ ] All existing tests pass
- [ ] New tests cover empty/undefined stored IDs
- [ ] Code review approved

### Edge Cases to Consider

1. **Partial storage:** URL exists but layer IDs don't
2. **Corrupted storage:** Layer IDs exist but are invalid
3. **Deleted layers:** Stored IDs reference deleted layers
4. **Mixed scenario:** Some stored IDs valid, some invalid

### Related Issues

- Related to TICKET-020 (Resync/Relaunch Button Functionality)
- Related to TICKET-019 (Sync Engine Main Orchestration)
- Discovered during comprehensive code review

### Notes

**Why this wasn't caught earlier:**
1. Most testing done through UI (not relaunch button)
2. Tests may pre-populate storage with valid data
3. Developers likely had previous sync data in testing
4. Feature only breaks on first use in new document

**User Impact Timeline:**
- First time user: Resync button broken ❌
- After one UI sync: Resync button works ✓
- This makes the bug less obvious but still critical

**Related Storage Keys:**
- `lastSheetUrl` - Sheet URL from previous sync
- `lastSyncedLayerIds` - Layer IDs from previous sync
- Both should be checked for consistency
