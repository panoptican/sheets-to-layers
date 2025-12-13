## TICKET-007: Layer Traversal Engine

**Type:** Feature  
**Priority:** High  

### Description

Implement the layer traversal system that walks through the Figma document tree, respects sync scope (document/page/selection), handles layer ignoring, and builds a list of layers to process.

### Requirements

- Support three sync scopes: entire document, current page, current selection
- Respect `-` prefix for ignoring layers and their children
- Ignore main components by default (unless `+` prefixed)
- Handle dynamic page loading for document-wide syncs
- Build an ordered list of layers to process
- Track parent context for worksheet/index inheritance

### Technical Specifications

**Traversal Implementation:**

```typescript
interface TraversalOptions {
  scope: 'document' | 'page' | 'selection';
}

interface LayerToProcess {
  node: SceneNode;
  resolvedBinding: ParsedLayerName;
  depth: number;
}

async function traverseLayers(options: TraversalOptions): Promise<LayerToProcess[]> {
  const layers: LayerToProcess[] = [];
  
  switch (options.scope) {
    case 'document':
      // Load all pages first (required for dynamic page loading)
      for (const page of figma.root.children) {
        await page.loadAsync();
        await traverseNode(page, layers, 0);
      }
      break;
      
    case 'page':
      await traverseNode(figma.currentPage, layers, 0);
      break;
      
    case 'selection':
      for (const node of figma.currentPage.selection) {
        await traverseNode(node, layers, 0);
      }
      break;
  }
  
  return layers;
}

async function traverseNode(
  node: BaseNode, 
  layers: LayerToProcess[], 
  depth: number
): Promise<void> {
  // Skip document nodes
  if (node.type === 'DOCUMENT') {
    for (const child of (node as DocumentNode).children) {
      await traverseNode(child, layers, depth);
    }
    return;
  }
  
  const parsed = parseLayerName(node.name);
  
  // Check if layer should be ignored
  if (parsed.isIgnored) {
    return; // Skip this layer and all children
  }
  
  // Check if main component (skip unless force included)
  if (node.type === 'COMPONENT' && !parsed.forceInclude) {
    return; // Skip main components by default
  }
  
  // Process this layer if it has a binding
  if (parsed.hasBinding && 'name' in node) {
    const resolved = resolveInheritance(node as SceneNode, parsed);
    layers.push({
      node: node as SceneNode,
      resolvedBinding: resolved,
      depth
    });
  }
  
  // Traverse children
  if ('children' in node) {
    for (const child of (node as ChildrenMixin).children) {
      await traverseNode(child, layers, depth + 1);
    }
  }
}
```

**Scope Detection:**

```typescript
function determineSyncScope(): 'document' | 'page' | 'selection' {
  const selection = figma.currentPage.selection;
  
  // If layers are selected, offer 'selection' option
  if (selection.length > 0) {
    return 'selection'; // This would be user's choice in UI
  }
  
  return 'page'; // Default to current page
}

function hasSelection(): boolean {
  return figma.currentPage.selection.length > 0;
}
```

### Dependencies

TICKET-005, TICKET-006

### Acceptance Criteria

- [ ] Traverses all layers when scope is 'document'
- [ ] Traverses only current page layers when scope is 'page'
- [ ] Traverses only selected layers and children when scope is 'selection'
- [ ] Respects `-` prefix and skips ignored layers and their children
- [ ] Skips main components unless `+` prefixed
- [ ] Handles deeply nested layer hierarchies
- [ ] Works with dynamic page loading
- [ ] Maintains correct traversal order (top-to-bottom, depth-first)