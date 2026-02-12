## TICKET-033: Add Escaped Character Support in Parser

**Type:** Feature Enhancement
**Priority:** Low
**Status:** Open
**Complexity:** Medium
**Estimated Effort:** 3-4 hours

### Description

The layer name parser cannot distinguish between binding syntax and literal characters. Users cannot name a layer "Price #1" or "Column //B" without triggering parsing, limiting layer naming flexibility.

### Current Behavior

```typescript
// parser.ts:46
const LABEL_PATTERN = /#([A-Za-z0-9_\-\s]+)(?:\.([nixr0-9]+))?/;

// "Price #1" → Parsed as binding to label "1"
// "Column //A" → Parsed as worksheet syntax
```

### Expected Behavior

Support escape sequences:
- `\#` → Literal `#` character
- `\\` → Literal `\` character
- `\/` → Literal `/` character

Examples:
- `Price \#1` → Display as "Price #1", not parsed
- `Column \//A` → Display as "Column //A", not parsed

### Solution

**Option 1: Backslash escaping**
```typescript
function parseLayerName(name: string): ParsedBinding | null {
  // First, handle escaped characters
  const unescaped = name.replace(/\\([#\/\\])/g, '$1');

  // If escapes were found, don't parse this name
  if (unescaped !== name) {
    return null;
  }

  // Normal parsing
  const match = LABEL_PATTERN.exec(name);
  // ...
}
```

**Option 2: Require prefix (breaking change)**
```typescript
// Only parse if starts with special character
// "sync:Label" → Binding
// "Label" → Not a binding
```

**Recommendation:** Option 1 (backslash escaping) for backward compatibility.

### Testing Requirements

- Test escaped `#` doesn't parse as label
- Test escaped `/` doesn't parse as worksheet
- Test escaped `\` produces literal backslash
- Test display name stripping escapes
- Test backward compatibility (no escapes)

### Acceptance Criteria

- [ ] Backslash escaping implemented
- [ ] Escaped characters not parsed as bindings
- [ ] Display names show without escape characters
- [ ] Backward compatible with existing files
- [ ] Documentation updated with escape syntax
- [ ] Tests cover all escape scenarios

### Related Issues

- Related to TICKET-005 (Basic Label Syntax)
- Related to TICKET-006 (Worksheet/Index Syntax)
