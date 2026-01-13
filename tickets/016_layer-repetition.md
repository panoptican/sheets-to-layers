## TICKET-016: Layer Repetition (Auto-Duplication)

**Type:** Feature  
**Priority:** Medium  

### Description

Implement the `@#` syntax for auto-layout frames that automatically duplicates the first child to match the number of data rows in the sheet.

### Requirements

- Detect `@#` in auto-layout frame names
- Count the number of values for the referenced label
- Duplicate or remove children to match the count
- Preserve the first child as the template
- Only works on frames with auto-layout enabled

### Technical Specifications

**Detection & Validation:**

```typescript
interface RepeatConfig {
  isRepeatFrame: boolean;
  hasAutoLayout: boolean;
}

function detectRepeatFrame(node: SceneNode): RepeatConfig {
  if (node.type !== 'FRAME') {
    return { isRepeatFrame: false, hasAutoLayout: false };
  }
  
  const frame = node as FrameNode;
  const hasRepeatSyntax = frame.name.includes('@#');
  const hasAutoLayout = frame.layoutMode !== 'NONE';
  
  return {
    isRepeatFrame: hasRepeatSyntax,
    hasAutoLayout
  };
}
```

**Repetition Logic:**

```typescript
async function processRepeatFrame(
  frame: FrameNode,
  sheetData: SheetData,
  worksheetName?: string
): Promise<void> {
  const config = detectRepeatFrame(frame);
  
  if (!config.isRepeatFrame) return;
  
  if (!config.hasAutoLayout) {
    console.warn(`Frame "${frame.name}" has @# but no auto-layout. Skipping repetition.`);
    figma.notify(`Auto-layout required for repetition: ${frame.name}`, { error: true });
    return;
  }
  
  if (frame.children.length === 0) {
    console.warn(`Frame "${frame.name}" has no children to duplicate.`);
    return;
  }
  
  // Determine target count from sheet data
  const worksheet = worksheetName 
    ? sheetData.worksheets.find(w => w.name === worksheetName)
    : sheetData.worksheets[0];
    
  if (!worksheet) return;
  
  // Find the first label referenced in children to determine count
  const targetCount = getValueCountForRepeatFrame(frame, worksheet);
  
  if (targetCount <= 0) return;
  
  const currentCount = frame.children.length;
  const template = frame.children[0];
  
  if (currentCount < targetCount) {
    // Need to add children
    for (let i = currentCount; i < targetCount; i++) {
      const clone = template.clone();
      frame.appendChild(clone);
    }
  } else if (currentCount > targetCount) {
    // Need to remove children (from the end, preserving template)
    for (let i = currentCount - 1; i >= targetCount; i--) {
      frame.children[i].remove();
    }
  }
}

function getValueCountForRepeatFrame(
  frame: FrameNode, 
  worksheet: Worksheet
): number {
  // Find the first label in any descendant
  function findFirstLabel(node: BaseNode): string | null {
    const parsed = parseLayerName(node.name);
    if (parsed.labels.length > 0) {
      return parsed.labels[0];
    }
    
    if ('children' in node) {
      for (const child of (node as ChildrenMixin).children) {
        const found = findFirstLabel(child);
        if (found) return found;
      }
    }
    
    return null;
  }
  
  const label = findFirstLabel(frame);
  if (!label) return 0;
  
  const matchedLabel = matchLabel(label, Object.keys(worksheet.rows));
  if (!matchedLabel) return 0;
  
  return worksheet.rows[matchedLabel].length;
}
```

**Processing Order:**

Repeat frames should be processed before their children are synced, so the children exist before attempting to apply values.

```typescript
async function syncWithRepetition(
  layers: LayerToProcess[],
  sheetData: SheetData
): Promise<void> {
  // First pass: process repeat frames
  for (const layer of layers) {
    if (layer.node.type === 'FRAME') {
      await processRepeatFrame(
        layer.node as FrameNode,
        sheetData,
        layer.resolvedBinding.worksheet
      );
    }
  }
  
  // Re-traverse to pick up duplicated layers
  // ... then apply values
}
```

### Dependencies

TICKET-007, TICKET-008

### Acceptance Criteria

- [ ] Detects `@#` syntax in frame names
- [ ] Validates auto-layout is enabled
- [ ] Duplicates first child to match data row count
- [ ] Removes excess children when data has fewer rows
- [ ] Preserves template (first child) properties
- [ ] Shows warning if no auto-layout
- [ ] Works with nested repeat frames
- [ ] Handles empty frames gracefully