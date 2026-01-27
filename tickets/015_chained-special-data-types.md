## TICKET-015: Chained Special Data Types

**Type:** Feature  
**Priority:** Medium  

### Description

Implement the ability to chain multiple special data types in a single value, separated by spaces or commas.

### Requirements

- Parse multiple special data types from a single value string
- Apply all parsed types in sequence
- Support comma separation and space separation
- Handle conflicts (e.g., multiple colors) by using last value

### Technical Specifications

**Chained Parser:**

```typescript
interface ParsedSpecialValue {
  visibility?: 'show' | 'hide';
  color?: RGB;
  opacity?: number;
  dimension?: DimensionValue;
  position?: PositionValue;
  rotation?: number;
  textAlign?: { horizontal?: HorizontalAlign; vertical?: VerticalAlign };
  fontSize?: number;
  lineHeight?: LineHeightValue;
  letterSpacing?: LetterSpacingValue;
}

function parseChainedSpecialTypes(value: string): ParsedSpecialValue {
  const result: ParsedSpecialValue = {};
  
  // Remove leading '/' if present
  const cleanValue = value.startsWith('/') ? value.substring(1) : value;
  
  // Split by comma or space (but not inside property values like "text-align:center")
  const parts = cleanValue.split(/[,\s]+/).filter(p => p.trim());
  
  // Rejoin property:value pairs that were split
  const tokens: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].includes(':') && !parts[i].match(/:\s*\S/)) {
      // Property name without value, next part is the value
      tokens.push(parts[i] + parts[i + 1]);
      i++;
    } else {
      tokens.push(parts[i]);
    }
  }
  
  for (const token of tokens) {
    // Try each parser
    if (token.toLowerCase() === 'show' || token.toLowerCase() === 'hide') {
      result.visibility = token.toLowerCase() as 'show' | 'hide';
      continue;
    }
    
    const color = parseHexColor(token);
    if (color) {
      result.color = color;
      continue;
    }
    
    const opacity = parseOpacity(token);
    if (opacity !== null) {
      result.opacity = opacity;
      continue;
    }
    
    const dimension = parseDimension(token);
    if (dimension) {
      result.dimension = dimension;
      continue;
    }
    
    const position = parsePosition(token);
    if (position) {
      result.position = position;
      continue;
    }
    
    const rotation = parseRotation(token);
    if (rotation !== null) {
      result.rotation = rotation;
      continue;
    }
    
    // Text properties
    const textAlign = parseTextAlign(token);
    if (textAlign) {
      result.textAlign = { ...result.textAlign, ...textAlign };
      continue;
    }
    
    const fontSize = parseFontSize(token);
    if (fontSize !== null) {
      result.fontSize = fontSize;
      continue;
    }
    
    const lineHeight = parseLineHeight(token);
    if (lineHeight) {
      result.lineHeight = lineHeight;
      continue;
    }
    
    const letterSpacing = parseLetterSpacing(token);
    if (letterSpacing) {
      result.letterSpacing = letterSpacing;
      continue;
    }
  }
  
  return result;
}
```

**Chained Applier:**

```typescript
async function applyChainedSpecialTypes(
  node: SceneNode, 
  parsed: ParsedSpecialValue
): Promise<void> {
  if (parsed.visibility) {
    applyVisibility(node, parsed.visibility);
  }
  
  if (parsed.color) {
    applyFillColor(node, parsed.color);
  }
  
  if (parsed.opacity !== undefined) {
    applyOpacity(node, parsed.opacity);
  }
  
  if (parsed.dimension) {
    applyDimension(node, parsed.dimension);
  }
  
  if (parsed.position) {
    applyPosition(node, parsed.position);
  }
  
  if (parsed.rotation !== undefined) {
    applyRotation(node, parsed.rotation);
  }
  
  // Text-specific properties
  if (node.type === 'TEXT') {
    const textNode = node as TextNode;
    
    if (parsed.textAlign) {
      await applyTextAlign(textNode, parsed.textAlign);
    }
    
    if (parsed.fontSize !== undefined) {
      await applyFontSize(textNode, parsed.fontSize);
    }
    
    if (parsed.lineHeight) {
      await applyLineHeight(textNode, parsed.lineHeight);
    }
    
    if (parsed.letterSpacing) {
      await applyLetterSpacing(textNode, parsed.letterSpacing);
    }
  }
}
```

**Example:**

```typescript
// Input: "letter-spacing:4px, #f00, 30%, 20º, text-align:center"
// Result: {
//   letterSpacing: { type: 'PIXELS', value: 4 },
//   color: { r: 1, g: 0, b: 0 },
//   opacity: 0.3,
//   rotation: 20,
//   textAlign: { horizontal: 'CENTER' }
// }
```

### Dependencies

TICKET-012, TICKET-013, TICKET-014

### Acceptance Criteria

- [ ] Parses multiple comma-separated values
- [ ] Parses multiple space-separated values
- [ ] Applies all parsed properties to node
- [ ] Later values override earlier ones (e.g., second color wins)
- [ ] Handles mixed separators
- [ ] Text properties only apply to text nodes