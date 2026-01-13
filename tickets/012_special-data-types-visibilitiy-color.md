## TICKET-012: Special Data Types - Visibility & Color

**Type:** Feature  
**Priority:** Medium  

### Description

Implement the special data type parsers and appliers for Show/Hide visibility and fill color modifications.

### Requirements

- Parse and apply `Show`/`Hide` visibility values
- Parse and apply hex color values (`#RGB`, `#RRGGBB`, etc.)
- Support shorthand hex colors (`#A`, `#AB`, `#ABC`)
- Apply fills to groups (recursively to children)
- Handle the `/` prefix requirement for text and instance layers

### Technical Specifications

**Visibility:**

```typescript
function applyVisibility(node: SceneNode, value: string): boolean {
  const normalizedValue = value.toLowerCase().trim();
  
  if (normalizedValue === 'show') {
    node.visible = true;
    return true;
  } else if (normalizedValue === 'hide') {
    node.visible = false;
    return true;
  }
  
  return false; // Not a visibility value
}
```

**Color Parsing & Application:**

```typescript
interface RGB {
  r: number;
  g: number;
  b: number;
}

function parseHexColor(value: string): RGB | null {
  if (!value.startsWith('#')) return null;
  
  const hex = value.substring(1);
  
  let r: number, g: number, b: number;
  
  switch (hex.length) {
    case 1:
      // #A -> #AAAAAA
      r = g = b = parseInt(hex + hex, 16);
      break;
    case 2:
      // #AB -> #ABABAB
      r = g = b = parseInt(hex, 16);
      break;
    case 3:
      // #ABC -> #AABBCC
      r = parseInt(hex[0] + hex[0], 16);
      g = parseInt(hex[1] + hex[1], 16);
      b = parseInt(hex[2] + hex[2], 16);
      break;
    case 6:
      // #RRGGBB
      r = parseInt(hex.substring(0, 2), 16);
      g = parseInt(hex.substring(2, 4), 16);
      b = parseInt(hex.substring(4, 6), 16);
      break;
    default:
      return null;
  }
  
  // Normalize to 0-1 range for Figma
  return {
    r: r / 255,
    g: g / 255,
    b: b / 255
  };
}

function applyFillColor(node: SceneNode, color: RGB): void {
  if ('fills' in node) {
    const solidFill: SolidPaint = {
      type: 'SOLID',
      color: color
    };
    (node as GeometryMixin).fills = [solidFill];
  }
  
  // For groups, apply to all children
  if (node.type === 'GROUP') {
    for (const child of node.children) {
      applyFillColor(child, color);
    }
  }
}
```

**Special Data Type Dispatcher:**

```typescript
interface SpecialDataTypeResult {
  handled: boolean;
  appliedTypes: string[];
}

async function applySpecialDataType(
  node: SceneNode, 
  value: string
): Promise<SpecialDataTypeResult> {
  const result: SpecialDataTypeResult = { handled: false, appliedTypes: [] };
  
  // Remove leading '/' if present (required for text/instance layers)
  const cleanValue = value.startsWith('/') ? value.substring(1) : value;
  
  // Try visibility
  if (applyVisibility(node, cleanValue)) {
    result.handled = true;
    result.appliedTypes.push('visibility');
    return result;
  }
  
  // Try color
  const color = parseHexColor(cleanValue);
  if (color) {
    applyFillColor(node, color);
    result.handled = true;
    result.appliedTypes.push('color');
    return result;
  }
  
  // ... additional special data types handled in subsequent tickets
  
  return result;
}
```

### Dependencies

TICKET-007

### Acceptance Criteria

- [ ] `Show` makes layer visible
- [ ] `Hide` makes layer hidden
- [ ] Case-insensitive visibility parsing
- [ ] Parses 6-digit hex colors (#RRGGBB)
- [ ] Parses 3-digit hex colors (#RGB → #RRGGBB)
- [ ] Parses 2-digit hex colors (#AB → #ABABAB)
- [ ] Parses 1-digit hex colors (#A → #AAAAAA)
- [ ] Applies fill color to shape layers
- [ ] Applies fill color recursively to group children
- [ ] Text/Instance layers require `/` prefix