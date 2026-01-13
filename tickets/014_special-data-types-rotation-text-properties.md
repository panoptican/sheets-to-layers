## TICKET-014: Special Data Types - Rotation & Text Properties

**Type:** Feature  
**Priority:** Medium  

### Description

Implement special data type parsers for rotation and text-specific properties (alignment, font size, line height, letter spacing).

### Requirements

- Parse and apply rotation values (`30º`)
- Parse and apply text alignment (`text-align:center`)
- Parse and apply vertical text alignment (`text-align-vertical:bottom`)
- Parse and apply font size (`font-size:14`)
- Parse and apply line height (`line-height:auto`, `line-height:40`, `line-height:120%`)
- Parse and apply letter spacing (`letter-spacing:2`, `letter-spacing:10%`)

### Technical Specifications

**Rotation:**

```typescript
function parseRotation(value: string): number | null {
  // Degree symbol: º (Alt+0 on Mac)
  const match = value.match(/^(-?\d+(?:\.\d+)?)\s*º$/);
  if (match) {
    return parseFloat(match[1]);
  }
  return null;
}

function applyRotation(node: SceneNode, degrees: number): void {
  if ('rotation' in node) {
    node.rotation = degrees;
  }
}
```

**Text Alignment:**

```typescript
type HorizontalAlign = 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED';
type VerticalAlign = 'TOP' | 'CENTER' | 'BOTTOM';

function parseTextAlign(value: string): { horizontal?: HorizontalAlign; vertical?: VerticalAlign } | null {
  const result: { horizontal?: HorizontalAlign; vertical?: VerticalAlign } = {};
  
  // Horizontal alignment
  const hMatch = value.match(/text-align:\s*(left|center|right|justified)/i);
  if (hMatch) {
    result.horizontal = hMatch[1].toUpperCase() as HorizontalAlign;
  }
  
  // Vertical alignment
  const vMatch = value.match(/text-align-vertical:\s*(top|center|bottom)/i);
  if (vMatch) {
    result.vertical = vMatch[1].toUpperCase() as VerticalAlign;
  }
  
  return (result.horizontal || result.vertical) ? result : null;
}

async function applyTextAlign(
  node: TextNode, 
  alignment: { horizontal?: HorizontalAlign; vertical?: VerticalAlign }
): Promise<void> {
  await loadAllFontsInNode(node);
  
  if (alignment.horizontal) {
    node.textAlignHorizontal = alignment.horizontal;
  }
  if (alignment.vertical) {
    node.textAlignVertical = alignment.vertical;
  }
}
```

**Font Size:**

```typescript
function parseFontSize(value: string): number | null {
  const match = value.match(/font-size:\s*(\d+(?:\.\d+)?)/i);
  if (match) {
    return parseFloat(match[1]);
  }
  return null;
}

async function applyFontSize(node: TextNode, size: number): Promise<void> {
  await loadAllFontsInNode(node);
  node.fontSize = size;
}
```

**Line Height:**

```typescript
interface LineHeightValue {
  type: 'AUTO' | 'PIXELS' | 'PERCENT';
  value?: number;
}

function parseLineHeight(value: string): LineHeightValue | null {
  const match = value.match(/line-height:\s*(auto|(\d+(?:\.\d+)?)\s*(%)?)/i);
  if (!match) return null;
  
  if (match[1].toLowerCase() === 'auto') {
    return { type: 'AUTO' };
  }
  
  const numValue = parseFloat(match[2]);
  if (match[3]) {
    return { type: 'PERCENT', value: numValue };
  }
  return { type: 'PIXELS', value: numValue };
}

async function applyLineHeight(node: TextNode, lh: LineHeightValue): Promise<void> {
  await loadAllFontsInNode(node);
  
  switch (lh.type) {
    case 'AUTO':
      node.lineHeight = { unit: 'AUTO' };
      break;
    case 'PIXELS':
      node.lineHeight = { unit: 'PIXELS', value: lh.value! };
      break;
    case 'PERCENT':
      node.lineHeight = { unit: 'PERCENT', value: lh.value! };
      break;
  }
}
```

**Letter Spacing:**

```typescript
interface LetterSpacingValue {
  type: 'PIXELS' | 'PERCENT';
  value: number;
}

function parseLetterSpacing(value: string): LetterSpacingValue | null {
  const match = value.match(/letter-spacing:\s*(-?\d+(?:\.\d+)?)\s*(%|px)?/i);
  if (!match) return null;
  
  const numValue = parseFloat(match[1]);
  const unit = match[2]?.toLowerCase();
  
  return {
    type: unit === '%' ? 'PERCENT' : 'PIXELS',
    value: numValue
  };
}

async function applyLetterSpacing(node: TextNode, ls: LetterSpacingValue): Promise<void> {
  await loadAllFontsInNode(node);
  
  node.letterSpacing = {
    unit: ls.type,
    value: ls.value
  };
}
```

### Dependencies

TICKET-012

### Acceptance Criteria

- [ ] Parses rotation with degree symbol
- [ ] Applies rotation correctly
- [ ] Parses horizontal text alignment (left, center, right, justified)
- [ ] Parses vertical text alignment (top, center, bottom)
- [ ] Applies text alignments to text nodes
- [ ] Parses font-size values
- [ ] Parses line-height (auto, px, %)
- [ ] Parses letter-spacing (px, %)
- [ ] All text properties load fonts before modification
- [ ] Handles case-insensitive property names