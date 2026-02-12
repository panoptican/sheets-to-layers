## TICKET-027: Fix Missing Font Loading Before Text Property Changes

**Type:** Bug Fix
**Priority:** Critical
**Status:** Open
**Complexity:** Medium
**Estimated Effort:** 2-3 hours

### Description

The special types system applies text properties (fontSize, lineHeight, letterSpacing, textAlign) to text nodes without loading fonts first. This violates Figma's API requirement that fonts must be loaded before modifying ANY text properties, causing silent failures or errors.

### Current Behavior

In `special-types.ts`, text properties are applied directly without font loading:

```typescript
// Line ~620-650
if (parsed.fontSize !== undefined) {
  textNode.fontSize = parsed.fontSize;  // ❌ No font loading first
}
if (parsed.lineHeight !== undefined) {
  // Apply line height
}
if (parsed.letterSpacing !== undefined) {
  // Apply letter spacing
}
```

The function only loads fonts for text alignment changes, but not for size/spacing/height changes.

### Expected Behavior

Fonts must be loaded before ANY text property modification, per Figma's API contract:

```typescript
await figma.loadFontAsync(textNode.fontName as FontName);
textNode.fontSize = 14;  // Now safe to modify
```

### Steps to Reproduce

1. Create a text layer with a non-default font (e.g., "Roboto Bold")
2. Bind it to a sheet cell with value: `/font-size:24`
3. Close and reopen Figma (to clear font cache)
4. Sync the sheet
5. Observe error or silent failure when font-size is applied

### Impact

**Severity:** High
- **Silent Failures:** Text properties may not be applied, confusing users
- **Plugin Errors:** May throw errors in Figma API, causing sync to fail
- **Inconsistent State:** Some properties applied, others not
- **Font Cache Masking:** Bug may not manifest if fonts are already loaded

### Root Cause

The `applySpecialTypes()` function in `special-types.ts` assumes fonts are already loaded. This assumption is violated when:
- Plugin first runs (no fonts cached)
- Text nodes use custom fonts
- Properties are applied before text content sync (which loads fonts)

### Affected Files

- `src/core/special-types.ts` (lines ~620-680 in `applySpecialTypes()`)
- Potentially affects all text property special types:
  - `font-size:N`
  - `line-height:N` / `line-height:N%` / `line-height:auto`
  - `letter-spacing:N` / `letter-spacing:N%`
  - `text-align:left|center|right`
  - `text-align-vertical:top|center|bottom`

### Solution

**Option 1: Load fonts at start of applySpecialTypes() [RECOMMENDED]**

```typescript
export async function applySpecialTypes(
  node: SceneNode,
  value: string,
  options: SpecialTypeOptions = {}
): Promise<SpecialTypeResult> {
  // ... prefix checking ...

  const parsed = parseChainedValue(trimmedValue);

  // Load fonts BEFORE applying any text properties
  if (node.type === 'TEXT' && hasTextProperties(parsed)) {
    await loadFontsForTextNode(node);
  }

  // Now safe to apply all text properties
  if (parsed.fontSize !== undefined) {
    (node as TextNode).fontSize = parsed.fontSize;
  }
  // ... rest of properties ...
}

function hasTextProperties(parsed: ParsedChainedValue): boolean {
  return parsed.fontSize !== undefined ||
         parsed.lineHeight !== undefined ||
         parsed.letterSpacing !== undefined ||
         parsed.textAlign !== undefined;
}
```

**Option 2: Load fonts per-property (less efficient)**

```typescript
if (parsed.fontSize !== undefined) {
  await loadFontsForTextNode(node as TextNode);
  (node as TextNode).fontSize = parsed.fontSize;
}
```

**Recommendation:** Option 1 - load once at the start if ANY text property exists.

### Testing Requirements

**Unit Tests:**
1. Mock `loadFontsForTextNode()` to track calls
2. Test that fonts are loaded BEFORE property changes:
   - `font-size:24` triggers font loading
   - `line-height:120%` triggers font loading
   - `letter-spacing:2` triggers font loading
   - `text-align:center` triggers font loading
3. Test that font loading is NOT called for non-text nodes
4. Test that font loading is NOT called when no text properties present

**Integration Tests:**
1. Create text node with custom font
2. Apply each text property special type
3. Verify no errors thrown
4. Verify properties are actually applied

**Manual Testing:**
1. Clear font cache (restart Figma)
2. Create text with various fonts (System, Google Fonts, custom)
3. Apply all text property special types
4. Verify all properties apply without errors

### Acceptance Criteria

- [ ] Fonts are loaded before applying fontSize
- [ ] Fonts are loaded before applying lineHeight
- [ ] Fonts are loaded before applying letterSpacing
- [ ] Fonts are loaded before applying textAlign
- [ ] Font loading is only called once per text node (not per property)
- [ ] Non-text nodes skip font loading
- [ ] All existing unit tests pass
- [ ] New unit tests verify font loading behavior
- [ ] Integration tests confirm no errors with custom fonts
- [ ] Code review approved

### Dependencies

- Uses existing `loadFontsForTextNode()` from `text-sync.ts`
- No new dependencies required

### Related Issues

- Related to TICKET-009 (Text Layer Content Sync)
- Related to TICKET-014 (Text Properties Special Types)
- Discovered during comprehensive code review

### Notes

**Why this wasn't caught earlier:**
1. Fonts may be cached from previous syncs
2. Default system fonts are usually pre-loaded
3. Text content sync (which loads fonts) often happens before special types
4. The bug only manifests in specific execution order

**Risk Assessment:**
- **Low risk** of breaking changes (adding safety)
- **High value** of fixing (prevents production errors)
- **Medium complexity** (need to track which properties need fonts)
