## TICKET-006: Layer Name Parsing - Worksheet & Index Syntax

**Type:** Feature  
**Priority:** High  

### Description

Extend the layer name parser to support worksheet specification (`//WorksheetName`) and index specification (`.N`, `.n`, `.i`, `.x`, `.r`) syntaxes.

### Requirements

- Parse `//WorksheetName` syntax for specifying source worksheet
- Parse `.N` syntax for specific index (1-based)
- Parse `.n` syntax for auto-increment
- Parse `.i` syntax for increment ignoring blanks
- Parse `.x` syntax for random index (may include blanks)
- Parse `.r` syntax for random index excluding blanks
- Support worksheet inheritance from parent Frame/Group/Page
- Support index inheritance from parent Frame/Group

### Technical Specifications

**Extended Parser:**

```typescript
function parseLayerName(layerName: string): ParsedLayerName {
  // ... existing label parsing ...
  
  // Extract worksheet reference (// syntax)
  const worksheetPattern = /\/\/\s*([a-zA-Z0-9_\- ]+?)(?=\s*[#.]|$)/;
  const worksheetMatch = layerName.match(worksheetPattern);
  if (worksheetMatch) {
    result.worksheet = worksheetMatch[1].trim();
  }
  
  // Extract index specification (must be at end of layer name)
  const indexPatterns = [
    { pattern: /\.(\d+)$/, type: 'specific' as const },
    { pattern: /\.n$/i, type: 'increment' as const },
    { pattern: /\.i$/i, type: 'incrementNonBlank' as const },
    { pattern: /\.x$/i, type: 'random' as const },
    { pattern: /\.r$/i, type: 'randomNonBlank' as const }
  ];
  
  for (const { pattern, type } of indexPatterns) {
    const match = layerName.match(pattern);
    if (match) {
      result.index = type === 'specific' 
        ? { type: 'specific', value: parseInt(match[1], 10) }
        : { type };
      break;
    }
  }
  
  return result;
}
```

**Inheritance Resolution:**

```typescript
function resolveInheritance(
  node: SceneNode, 
  parsedName: ParsedLayerName
): ParsedLayerName {
  let resolved = { ...parsedName };
  
  // Walk up the tree to find inherited worksheet/index
  let current: BaseNode | null = node.parent;
  
  while (current && current.type !== 'PAGE' && current.type !== 'DOCUMENT') {
    const parentParsed = parseLayerName(current.name);
    
    // Inherit worksheet if not specified
    if (!resolved.worksheet && parentParsed.worksheet) {
      resolved.worksheet = parentParsed.worksheet;
    }
    
    // Inherit index if not specified
    if (!resolved.index && parentParsed.index) {
      resolved.index = parentParsed.index;
    }
    
    current = current.parent;
  }
  
  // Also check page name for worksheet
  if (!resolved.worksheet && node.parent) {
    const page = findParentPage(node);
    if (page) {
      const pageParsed = parseLayerName(page.name);
      if (pageParsed.worksheet) {
        resolved.worksheet = pageParsed.worksheet;
      }
    }
  }
  
  return resolved;
}
```

**Test Cases:**

```typescript
parseLayerName('Page 1 // Properties')     // { worksheet: 'Properties', ... }
parseLayerName('#Title.1')                  // { labels: ['Title'], index: { type: 'specific', value: 1 } }
parseLayerName('#Title.5')                  // { labels: ['Title'], index: { type: 'specific', value: 5 } }
parseLayerName('#Title.n')                  // { labels: ['Title'], index: { type: 'increment' } }
parseLayerName('#Title.i')                  // { labels: ['Title'], index: { type: 'incrementNonBlank' } }
parseLayerName('#Title.x')                  // { labels: ['Title'], index: { type: 'random' } }
parseLayerName('#Title.r')                  // { labels: ['Title'], index: { type: 'randomNonBlank' } }
parseLayerName('Card // Sheet2 #Name.3')   // { worksheet: 'Sheet2', labels: ['Name'], index: { type: 'specific', value: 3 } }
```

### Dependencies

TICKET-005

### Acceptance Criteria

- [ ] Correctly parses `//WorksheetName` syntax
- [ ] Correctly parses all index types (`.N`, `.n`, `.i`, `.x`, `.r`)
- [ ] Worksheet inherits from parent Frame/Group/Page
- [ ] Index inherits from parent Frame/Group
- [ ] Specific index on child overrides inherited index
- [ ] Combined syntax works correctly (worksheet + label + index)