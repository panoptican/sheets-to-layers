## TICKET-019: Sync Engine - Main Orchestration

**Type:** Feature  
**Priority:** High  

### Description

Implement the main sync engine that orchestrates the entire sync process: fetching data, traversing layers, matching values, and applying changes.

### Requirements

- Coordinate all sync phases in correct order
- Handle repeat frames before other layers
- Build component cache before component swapping
- Manage index trackers across sync
- Provide progress feedback
- Handle errors gracefully with partial success
- Generate sync report/summary

### Technical Specifications

**Sync Engine:**

```typescript
interface SyncOptions {
  url: string;
  scope: 'document' | 'page' | 'selection';
}

interface SyncResult {
  success: boolean;
  layersProcessed: number;
  layersUpdated: number;
  errors: SyncError[];
  warnings: string[];
}

interface SyncError {
  layerName: string;
  layerId: string;
  error: string;
}

async function runSync(options: SyncOptions): Promise<SyncResult> {
  const result: SyncResult = {
    success: true,
    layersProcessed: 0,
    layersUpdated: 0,
    errors: [],
    warnings: []
  };
  
  try {
    // Phase 1: Parse URL and fetch sheet data
    sendProgress('Fetching sheet data...', 0);
    const parsedUrl = parseGoogleSheetsUrl(options.url);
    if (!parsedUrl.isValid) {
      throw new Error(parsedUrl.errorMessage);
    }
    
    const sheetData = await fetchSheetData(parsedUrl.spreadsheetId);
    
    // Phase 2: Build component cache
    sendProgress('Building component cache...', 20);
    const scopeNodes = getScopeNodes(options.scope);
    const componentCache = await buildComponentCache(scopeNodes);
    
    // Phase 3: First traversal - process repeat frames
    sendProgress('Processing repeat frames...', 40);
    const layers = await traverseLayers({ scope: options.scope });
    
    for (const layer of layers) {
      if (layer.node.type === 'FRAME') {
        await processRepeatFrame(
          layer.node as FrameNode,
          sheetData,
          layer.resolvedBinding.worksheet
        );
      }
    }
    
    // Phase 4: Re-traverse to pick up duplicated layers
    sendProgress('Syncing layer content...', 60);
    const finalLayers = await traverseLayers({ scope: options.scope });
    
    // Phase 5: Initialize index tracker
    const indexTracker = new IndexTracker(sheetData);
    
    // Phase 6: Process each layer
    const totalLayers = finalLayers.length;
    for (let i = 0; i < finalLayers.length; i++) {
      const layer = finalLayers[i];
      result.layersProcessed++;
      
      try {
        const updated = await processLayer(
          layer,
          sheetData,
          indexTracker,
          componentCache
        );
        
        if (updated) {
          result.layersUpdated++;
        }
      } catch (error) {
        result.errors.push({
          layerName: layer.node.name,
          layerId: layer.node.id,
          error: error.message
        });
      }
      
      // Update progress
      const progress = 60 + (40 * (i / totalLayers));
      sendProgress(`Processing ${layer.node.name}...`, progress);
    }
    
    // Phase 7: Store last URL
    await figma.clientStorage.setAsync('lastUrl', options.url);
    
    sendProgress('Complete!', 100);
    
  } catch (error) {
    result.success = false;
    result.errors.push({
      layerName: '',
      layerId: '',
      error: error.message
    });
  }
  
  return result;
}

function getScopeNodes(scope: 'document' | 'page' | 'selection'): SceneNode[] {
  switch (scope) {
    case 'document':
      return figma.root.children.flatMap(page => page.children);
    case 'page':
      return [...figma.currentPage.children];
    case 'selection':
      return [...figma.currentPage.selection];
  }
}

function sendProgress(message: string, percent: number): void {
  figma.ui.postMessage({
    type: 'PROGRESS',
    payload: { message, progress: percent }
  });
}
```

**Layer Processing:**

```typescript
async function processLayer(
  layer: LayerToProcess,
  sheetData: SheetData,
  indexTracker: IndexTracker,
  componentCache: ComponentCache
): Promise<boolean> {
  const { node, resolvedBinding } = layer;
  
  if (!resolvedBinding.hasBinding || resolvedBinding.labels.length === 0) {
    return false;
  }
  
  // Get worksheet
  const worksheet = resolvedBinding.worksheet
    ? sheetData.worksheets.find(w => 
        normalizeLabel(w.name) === normalizeLabel(resolvedBinding.worksheet!)
      )
    : sheetData.worksheets[0];
    
  if (!worksheet) {
    throw new Error(`Worksheet not found: ${resolvedBinding.worksheet}`);
  }
  
  // Get primary value
  const primaryLabel = resolvedBinding.labels[0];
  const matchedLabel = matchLabel(primaryLabel, Object.keys(worksheet.rows));
  
  if (!matchedLabel) {
    return false; // No matching label in sheet
  }
  
  const indexType = resolvedBinding.index ?? { type: 'increment' as const };
  const index = indexTracker.getNextIndex(matchedLabel, indexType, worksheet.name);
  
  if (index < 0) {
    return false; // No values available
  }
  
  const value = worksheet.rows[matchedLabel][index];
  
  // Get additional values for multi-label layers
  const additionalValues: string[] = [];
  for (let i = 1; i < resolvedBinding.labels.length; i++) {
    const addLabel = resolvedBinding.labels[i];
    const addMatchedLabel = matchLabel(addLabel, Object.keys(worksheet.rows));
    if (addMatchedLabel) {
      const addValue = worksheet.rows[addMatchedLabel][index];
      if (addValue) additionalValues.push(addValue);
    }
  }
  
  // Apply value based on node type
  return await applyValue(node, value, additionalValues, componentCache);
}

async function applyValue(
  node: SceneNode,
  value: string,
  additionalValues: string[],
  componentCache: ComponentCache
): Promise<boolean> {
  if (!value && additionalValues.length === 0) {
    return false;
  }
  
  // Determine how to apply based on node type and value type
  
  if (node.type === 'TEXT') {
    // Check for special data type prefix
    if (value.startsWith('/')) {
      const parsed = parseChainedSpecialTypes(value);
      await applyChainedSpecialTypes(node, parsed);
    } else {
      await syncTextLayer(node as TextNode, value, additionalValues);
    }
    return true;
  }
  
  if (node.type === 'INSTANCE') {
    // Check for special data type prefix
    if (value.startsWith('/')) {
      const parsed = parseChainedSpecialTypes(value);
      await applyChainedSpecialTypes(node, parsed);
    } else {
      // Assume component swap
      await syncComponentSwap(node as InstanceNode, value, componentCache);
    }
    return true;
  }
  
  // For other layer types
  if (isImageUrl(value)) {
    await syncImageFill(node, value);
    return true;
  }
  
  // Try special data types
  const parsed = parseChainedSpecialTypes(value);
  if (Object.keys(parsed).length > 0) {
    await applyChainedSpecialTypes(node, parsed);
    return true;
  }
  
  return false;
}
```

### Dependencies

TICKET-003 through TICKET-016

### Acceptance Criteria

- [ ] Completes sync process end-to-end
- [ ] Processes repeat frames before content sync
- [ ] Builds component cache correctly
- [ ] Tracks indices per label throughout sync
- [ ] Reports progress to UI
- [ ] Continues on individual layer errors
- [ ] Returns comprehensive sync result
- [ ] Stores last URL for re-sync feature