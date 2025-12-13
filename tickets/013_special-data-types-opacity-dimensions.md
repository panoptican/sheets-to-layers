## TICKET-013: Special Data Types - Opacity & Dimensions

**Type:** Feature  
**Priority:** Medium  

### Description

Implement special data type parsers for layer opacity and dimensional properties (size, width, height, position).

### Requirements

- Parse and apply opacity values (`50%`)
- Parse and apply size values (`100s` for both dimensions)
- Parse and apply width values (`100w`)
- Parse and apply height values (`100h`)
- Parse and apply position values (`20x`, `40y`)
- Parse and apply absolute position values (`20xx`, `40yy`)

### Technical Specifications

**Opacity:**

```typescript
function parseOpacity(value: string): number | null {
  const match = value.match(/^(\d+(?:\.\d+)?)\s*%$/);
  if (match) {
    return Math.min(100, Math.max(0, parseFloat(match[1]))) / 100;
  }
  return null;
}

function applyOpacity(node: SceneNode, opacity: number): void {
  if ('opacity' in node) {
    node.opacity = opacity;
  }
}
```

**Dimensions:**

```typescript
interface DimensionValue {
  type: 'size' | 'width' | 'height';
  value: number;
}

function parseDimension(value: string): DimensionValue | null {
  // Size (both dimensions): 100s
  let match = value.match(/^(\d+(?:\.\d+)?)\s*s$/i);
  if (match) {
    return { type: 'size', value: parseFloat(match[1]) };
  }
  
  // Width only: 100w
  match = value.match(/^(\d+(?:\.\d+)?)\s*w$/i);
  if (match) {
    return { type: 'width', value: parseFloat(match[1]) };
  }
  
  // Height only: 100h
  match = value.match(/^(\d+(?:\.\d+)?)\s*h$/i);
  if (match) {
    return { type: 'height', value: parseFloat(match[1]) };
  }
  
  return null;
}

function applyDimension(node: SceneNode, dim: DimensionValue): void {
  if (!('resize' in node)) return;
  
  const resizable = node as LayoutMixin;
  
  switch (dim.type) {
    case 'size':
      resizable.resize(dim.value, dim.value);
      break;
    case 'width':
      resizable.resize(dim.value, node.height);
      break;
    case 'height':
      resizable.resize(node.width, dim.value);
      break;
  }
}
```

**Position:**

```typescript
interface PositionValue {
  type: 'relative' | 'absolute';
  axis: 'x' | 'y';
  value: number;
}

function parsePosition(value: string): PositionValue | null {
  // Absolute position: 20xx, 40yy
  let match = value.match(/^(\d+(?:\.\d+)?)\s*(xx|yy)$/i);
  if (match) {
    return {
      type: 'absolute',
      axis: match[2].toLowerCase().charAt(0) as 'x' | 'y',
      value: parseFloat(match[1])
    };
  }
  
  // Relative position: 20x, 40y
  match = value.match(/^(\d+(?:\.\d+)?)\s*(x|y)$/i);
  if (match) {
    return {
      type: 'relative',
      axis: match[2].toLowerCase() as 'x' | 'y',
      value: parseFloat(match[1])
    };
  }
  
  return null;
}

function applyPosition(node: SceneNode, pos: PositionValue): void {
  if (pos.type === 'absolute') {
    // Set position relative to page
    if (pos.axis === 'x') {
      node.x = pos.value - (node.absoluteBoundingBox?.x ?? 0) + node.x;
    } else {
      node.y = pos.value - (node.absoluteBoundingBox?.y ?? 0) + node.y;
    }
  } else {
    // Set position relative to parent
    if (pos.axis === 'x') {
      node.x = pos.value;
    } else {
      node.y = pos.value;
    }
  }
}
```

### Dependencies

TICKET-012

### Acceptance Criteria

- [ ] Parses opacity percentages correctly
- [ ] Applies opacity (0-100% mapped to 0-1)
- [ ] Parses and applies uniform size (`100s`)
- [ ] Parses and applies width only (`100w`)
- [ ] Parses and applies height only (`100h`)
- [ ] Parses and applies relative x position (`20x`)
- [ ] Parses and applies relative y position (`40y`)
- [ ] Parses and applies absolute x position (`20xx`)
- [ ] Parses and applies absolute y position (`40yy`)
- [ ] Handles decimal values