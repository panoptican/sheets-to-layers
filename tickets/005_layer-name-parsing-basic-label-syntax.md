## TICKET-005: Layer Name Parsing - Basic Label Syntax

**Type:** Feature  
**Priority:** High  

### Description

Implement the layer name parsing system to extract data binding instructions from Figma layer names. This ticket covers the core `#Label` syntax for binding layers to sheet columns/rows.

### Requirements

- Parse `#Label` syntax from layer names
- Support case-insensitive label matching
- Ignore spaces, underscores, and dashes in label matching
- Allow labels to appear anywhere in layer name (prefix or suffix)
- Return null/undefined when no binding is present

### Technical Specifications

**Parser Implementation:**

```typescript
interface ParsedLayerName {
  hasBinding: boolean;
  labels: string[];  // Support for multiple labels on one layer
  worksheet?: string;
  index?: IndexType;
  isIgnored: boolean;
  forceInclude: boolean;
}

function parseLayerName(layerName: string): ParsedLayerName {
  const result: ParsedLayerName = {
    hasBinding: false,
    labels: [],
    isIgnored: false,
    forceInclude: false
  };
  
  // Check for ignore prefix
  if (layerName.startsWith('-')) {
    result.isIgnored = true;
    return result;
  }
  
  // Check for force include prefix (main components)
  if (layerName.startsWith('+')) {
    result.forceInclude = true;
    layerName = layerName.substring(1);
  }
  
  // Extract labels (#Label syntax)
  const labelPattern = /#([a-zA-Z0-9_\- ]+?)(?=\s*[#./]|$)/g;
  let match;
  while ((match = labelPattern.exec(layerName)) !== null) {
    result.labels.push(match[1]);
    result.hasBinding = true;
  }
  
  return result;
}

function normalizeLabel(label: string): string {
  // Remove spaces, underscores, dashes and lowercase for comparison
  return label.replace(/[\s_-]/g, '').toLowerCase();
}

function matchLabel(layerLabel: string, sheetLabels: string[]): string | null {
  const normalizedLayerLabel = normalizeLabel(layerLabel);
  
  for (const sheetLabel of sheetLabels) {
    if (normalizeLabel(sheetLabel) === normalizedLayerLabel) {
      return sheetLabel;
    }
  }
  
  return null;
}
```

**Test Cases:**

```typescript
// All these should match "First Name" label:
parseLayerName('#First name')      // { labels: ['First name'], ... }
parseLayerName('#first_name')      // { labels: ['first_name'], ... }
parseLayerName('Layer #FIRST-NAME') // { labels: ['FIRST-NAME'], ... }
parseLayerName('#FirstName')       // { labels: ['FirstName'], ... }

// No binding
parseLayerName('Regular Layer')    // { hasBinding: false, ... }

// Multiple labels
parseLayerName('#status #colour')  // { labels: ['status', 'colour'], ... }
```

### Dependencies

TICKET-001

### Acceptance Criteria

- [ ] Extracts single label from `#Label` syntax
- [ ] Extracts multiple labels from layer name
- [ ] Case-insensitive matching works correctly
- [ ] Space/underscore/dash variations match correctly
- [ ] Returns hasBinding: false for layers without `#` syntax
- [ ] Handles edge cases (empty strings, special characters)