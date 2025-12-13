## TICKET-022: Performance Optimization

**Type:** Enhancement  
**Priority:** Medium  

### Description

Optimize plugin performance for large documents with many layers, including batching operations, minimizing traversals, and efficient data structures.

### Requirements

- Minimize document traversals
- Batch node modifications where possible
- Use efficient data structures for lookups
- Implement progress feedback for long operations
- Consider pagination for very large sheets
- Optimize font loading (deduplicate)

### Technical Specifications

**Batched Operations:**

```typescript
// Batch font loading
async function loadFontsForDocument(layers: LayerToProcess[]): Promise<Set<string>> {
  const fontsNeeded = new Set<string>();
  const loadedFonts = new Set<string>();
  
  // Collect all fonts needed
  for (const layer of layers) {
    if (layer.node.type === 'TEXT') {
      const textNode = layer.node as TextNode;
      
      if (textNode.fontName === figma.mixed) {
        const len = textNode.characters.length;
        for (let i = 0; i < len; i++) {
          const font = textNode.getRangeFontName(i, i + 1) as FontName;
          fontsNeeded.add(`${font.family}::${font.style}`);
        }
      } else {
        const font = textNode.fontName as FontName;
        fontsNeeded.add(`${font.family}::${font.style}`);
      }
    }
  }
  
  // Load all fonts in parallel
  const loadPromises: Promise<void>[] = [];
  for (const fontKey of fontsNeeded) {
    const [family, style] = fontKey.split('::');
    loadPromises.push(
      figma.loadFontAsync({ family, style })
        .then(() => { loadedFonts.add(fontKey); })
        .catch(err => console.warn(`Failed to load font: ${fontKey}`, err))
    );
  }
  
  await Promise.all(loadPromises);
  return loadedFonts;
}
```

**Efficient Component Cache:**

```typescript
class ComponentCache {
  private byName: Map<string, ComponentNode> = new Map();
  private byKey: Map<string, ComponentNode> = new Map();
  
  add(component: ComponentNode): void {
    this.byName.set(normalizeComponentName(component.name), component);
    if (component.key) {
      this.byKey.set(component.key, component);
    }
  }
  
  findByName(name: string): ComponentNode | undefined {
    return this.byName.get(normalizeComponentName(name));
  }
  
  // O(1) lookups instead of traversing each time
}
```

**Single-Pass Traversal:**

```typescript
interface TraversalResult {
  layers: LayerToProcess[];
  repeatFrames: FrameNode[];
  componentCache: ComponentCache;
}

async function singlePassTraversal(scope: SceneNode[]): Promise<TraversalResult> {
  const result: TraversalResult = {
    layers: [],
    repeatFrames: [],
    componentCache: new ComponentCache()
  };
  
  async function traverse(node: BaseNode, depth: number): Promise<void> {
    // Collect component cache entries
    if (node.type === 'COMPONENT') {
      result.componentCache.add(node as ComponentNode);
    }
    if (node.type === 'INSTANCE') {
      const main = (node as InstanceNode).mainComponent;
      if (main) result.componentCache.add(main);
    }
    
    const parsed = parseLayerName(node.name);
    
    if (parsed.isIgnored) return;
    
    // Check for repeat frame
    if (node.type === 'FRAME' && node.name.includes('@#')) {
      result.repeatFrames.push(node as FrameNode);
    }
    
    // Collect layer if it has binding
    if (parsed.hasBinding && 'name' in node) {
      result.layers.push({
        node: node as SceneNode,
        resolvedBinding: resolveInheritance(node as SceneNode, parsed),
        depth
      });
    }
    
    // Traverse children
    if ('children' in node) {
      for (const child of (node as ChildrenMixin).children) {
        await traverse(child, depth + 1);
      }
    }
  }
  
  for (const node of scope) {
    await traverse(node, 0);
  }
  
  return result;
}
```

**Progress Chunking:**

```typescript
async function processLayersWithProgress(
  layers: LayerToProcess[],
  processor: (layer: LayerToProcess) => Promise<void>
): Promise<void> {
  const CHUNK_SIZE = 50;
  const total = layers.length;
  
  for (let i = 0; i < total; i += CHUNK_SIZE) {
    const chunk = layers.slice(i, i + CHUNK_SIZE);
    
    // Process chunk
    await Promise.all(chunk.map(processor));
    
    // Report progress
    const progress = Math.min(100, ((i + chunk.length) / total) * 100);
    sendProgress(`Processing layers... (${i + chunk.length}/${total})`, progress);
    
    // Yield to UI thread
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}
```

### Dependencies

TICKET-019

### Acceptance Criteria

- [ ] Single traversal collects all needed data
- [ ] Font loading is deduplicated
- [ ] Component lookups are O(1)
- [ ] Progress updates don't freeze UI
- [ ] Large documents (1000+ layers) sync in reasonable time
- [ ] Memory usage remains stable during sync