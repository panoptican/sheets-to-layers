## TICKET-009: Text Layer Content Sync

**Type:** Feature  
**Priority:** High  

### Description

Implement the value application logic for text layers, including font loading, text content replacement, and handling of multi-label bindings.

### Requirements

- Set text content on TextNode layers from sheet values
- Load required fonts before modifying text
- Handle multi-label bindings (apply text from first label, properties from others)
- Preserve existing text styles where possible
- Handle empty values gracefully

### Technical Specifications

**Text Sync Implementation:**

```typescript
async function syncTextLayer(
  node: TextNode, 
  value: string,
  additionalValues: string[] = []
): Promise<void> {
  // Load font(s) used by the text node
  await loadFontsForTextNode(node);
  
  // Check if value is a special data type (starts with /)
  if (value.startsWith('/')) {
    // Handle special data type for text layers
    const specialValue = value.substring(1);
    await applySpecialDataType(node, specialValue);
    return;
  }
  
  // Set the text content
  node.characters = value;
  
  // Apply any additional values (special data types from additional labels)
  for (const additionalValue of additionalValues) {
    await applySpecialDataType(node, additionalValue);
  }
}

async function loadFontsForTextNode(node: TextNode): Promise<void> {
  // Get all fonts used in the text node
  const fonts = node.getRangeAllFontNames(0, node.characters.length);
  
  // Load each unique font
  const uniqueFonts = new Set(fonts.map(f => `${f.family}-${f.style}`));
  
  for (const font of fonts) {
    try {
      await figma.loadFontAsync(font);
    } catch (error) {
      console.warn(`Could not load font: ${font.family} ${font.style}`);
      // Optionally fall back to a default font
    }
  }
}

// Handle mixed fonts in text
async function loadAllFontsInNode(node: TextNode): Promise<void> {
  if (node.fontName === figma.mixed) {
    // Node has multiple fonts, need to load all
    const len = node.characters.length;
    for (let i = 0; i < len; i++) {
      const font = node.getRangeFontName(i, i + 1) as FontName;
      await figma.loadFontAsync(font);
    }
  } else {
    await figma.loadFontAsync(node.fontName as FontName);
  }
}
```

**Edge Cases:**

```typescript
function handleEmptyValue(node: TextNode, value: string): boolean {
  if (!value || value.trim() === '') {
    // Optionally: leave existing content, or set to empty
    // Based on original plugin behavior, empty values clear the content
    return true;
  }
  return false;
}
```

### Dependencies

TICKET-007, TICKET-008

### Acceptance Criteria

- [ ] Text content updates correctly from sheet values
- [ ] Fonts are loaded before text modification
- [ ] Mixed font text nodes handled correctly
- [ ] Empty values result in empty text (or preserved based on setting)
- [ ] Multi-label binding applies text + special data types
- [ ] Special data type prefix `/` triggers property changes instead of text
- [ ] Error handling for unavailable fonts