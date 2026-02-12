## TICKET-026: Fix Image Scale Mode Preservation Bug

**Type:** Bug Fix
**Priority:** Critical
**Status:** Open
**Complexity:** Low
**Estimated Effort:** 1 hour

### Description

The image sync functionality incorrectly preserves scale mode from the first fill in the fills array, even when that fill is not an image fill. This causes images to be applied with the wrong scale mode when a layer has multiple fills.

### Current Behavior

When applying a new image to a layer with existing fills, the code assumes the first fill is an image and copies its scale mode:

```typescript
// sync-engine.ts:609-619
let scaleMode: ImagePaint['scaleMode'] = 'FILL';
if ('fills' in node) {
  const currentFills = (node as GeometryMixin).fills;
  if (Array.isArray(currentFills) && currentFills.length > 0) {
    const firstFill = currentFills[0];
    if (firstFill.type === 'IMAGE' && firstFill.scaleMode) {  // Bug: assumes first fill is image
      scaleMode = firstFill.scaleMode;
    }
  }
}
```

**Problem:** If the layer has fills like `[SOLID, IMAGE]`, the code checks the SOLID fill for scale mode and doesn't find it, resulting in default 'FILL' mode even if the existing image uses 'FIT' or 'CROP'.

### Expected Behavior

The code should search through ALL fills to find an existing IMAGE fill and preserve its scale mode, not just check the first fill.

### Steps to Reproduce

1. Create a rectangle with a solid color fill
2. Add an image fill with scale mode set to 'FIT'
3. Bind the layer to a sheet cell with a different image URL
4. Sync the sheet
5. Observe that the new image is applied with 'FILL' mode instead of 'FIT'

### Impact

- User Frustration: Users who carefully set scale modes will see them reset on every sync
- Data Loss: Scale mode preferences are lost
- Workarounds Required: Users must manually reset scale mode after each sync

### Affected Files

- `src/core/sync-engine.ts` (lines 609-619 in `applyFetchedImage()`)

### Solution

Replace the scale mode preservation logic to search all fills:

```typescript
let scaleMode: ImagePaint['scaleMode'] = 'FILL';
if ('fills' in node) {
  const currentFills = (node as GeometryMixin).fills;
  if (Array.isArray(currentFills)) {
    // Find any existing IMAGE fill (not just first fill)
    const existingImageFill = currentFills.find(f => f.type === 'IMAGE');
    if (existingImageFill && existingImageFill.type === 'IMAGE' && existingImageFill.scaleMode) {
      scaleMode = existingImageFill.scaleMode;
    }
  }
}
```

### Testing Requirements

**Unit Tests:**
- Test preserving scale mode when image fill is first
- Test preserving scale mode when image fill is NOT first (new test case)
- Test default behavior when no image fill exists
- Test behavior with empty fills array

**Integration Tests:**
- Create layer with SOLID + IMAGE fills (image not first)
- Sync new image and verify scale mode is preserved

### Acceptance Criteria

- [ ] Scale mode is correctly preserved regardless of fill order
- [ ] Existing unit tests still pass
- [ ] New unit test covers non-first-position image fills
- [ ] No regression in default scale mode behavior
- [ ] Code review approved

### Related Issues

- Related to TICKET-010 (Image Fill Sync)
- Discovered during comprehensive code review

### Notes

This is a subtle bug that likely went unnoticed because most layers have image fills as the first (or only) fill. The bug was discovered by analyzing the assumption that `currentFills[0]` would be the relevant image fill.
