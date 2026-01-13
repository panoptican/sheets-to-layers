## TICKET-011: Component Instance Swapping

**Type:** Feature  
**Priority:** High  

### Description

Implement component swapping functionality for InstanceNode layers, allowing the sheet value to specify which component to swap to by name.

### Requirements

- Detect when a layer is an InstanceNode
- Find target component by name within sync scope
- Perform component swap preserving overrides
- Support Component Variant syntax (`Property=Value, Property=Value`)
- Handle component not found errors
- Only search components within the sync scope area

### Technical Specifications

**Component Finder:**

```typescript
interface ComponentCache {
  components: Map<string, ComponentNode>;
  componentSets: Map<string, ComponentSetNode>;
}

async function buildComponentCache(scope: SceneNode[]): Promise<ComponentCache> {
  const cache: ComponentCache = {
    components: new Map(),
    componentSets: new Map()
  };
  
  async function findComponents(node: BaseNode): Promise<void> {
    if (node.type === 'COMPONENT') {
      const comp = node as ComponentNode;
      cache.components.set(normalizeComponentName(comp.name), comp);
    } else if (node.type === 'COMPONENT_SET') {
      const set = node as ComponentSetNode;
      cache.componentSets.set(normalizeComponentName(set.name), set);
      // Also cache individual variants
      for (const child of set.children) {
        if (child.type === 'COMPONENT') {
          cache.components.set(normalizeComponentName(child.name), child as ComponentNode);
        }
      }
    } else if (node.type === 'INSTANCE') {
      // Include instances so their main components are available
      const instance = node as InstanceNode;
      if (instance.mainComponent) {
        cache.components.set(
          normalizeComponentName(instance.mainComponent.name), 
          instance.mainComponent
        );
      }
    }
    
    if ('children' in node) {
      for (const child of (node as ChildrenMixin).children) {
        await findComponents(child);
      }
    }
  }
  
  for (const node of scope) {
    await findComponents(node);
  }
  
  return cache;
}

function normalizeComponentName(name: string): string {
  // Case-insensitive, but preserve spaces and punctuation
  return name.toLowerCase();
}
```

**Component Swapping:**

```typescript
async function syncComponentSwap(
  node: InstanceNode, 
  componentName: string,
  componentCache: ComponentCache
): Promise<void> {
  // Check if this is a variant specification
  if (isVariantSyntax(componentName)) {
    await swapToVariant(node, componentName, componentCache);
    return;
  }
  
  // Find component by name
  const normalizedName = normalizeComponentName(componentName);
  const targetComponent = componentCache.components.get(normalizedName);
  
  if (!targetComponent) {
    console.warn(`Component not found: ${componentName}`);
    figma.notify(`Component not found: ${componentName}`, { error: true });
    return;
  }
  
  // Swap using modern API
  node.swapComponent(targetComponent);
}

function isVariantSyntax(value: string): boolean {
  // Variant syntax: "Property=Value, Property=Value"
  return value.includes('=') && !value.startsWith('http');
}

async function swapToVariant(
  node: InstanceNode,
  variantString: string,
  componentCache: ComponentCache
): Promise<void> {
  // Parse variant properties
  // Format: "Property=Value, Property=Value"
  const normalizedVariant = normalizeComponentName(variantString);
  
  // Try to find exact variant match
  const targetComponent = componentCache.components.get(normalizedVariant);
  
  if (targetComponent) {
    node.swapComponent(targetComponent);
  } else {
    console.warn(`Variant not found: ${variantString}`);
    figma.notify(`Variant not found: ${variantString}`, { error: true });
  }
}
```

### Dependencies

TICKET-007, TICKET-008

### Acceptance Criteria

- [ ] Identifies InstanceNode layers correctly
- [ ] Finds components by name (case-insensitive)
- [ ] Swaps component preserving overrides
- [ ] Supports variant syntax `Property=Value, Property=Value`
- [ ] Shows warning when component not found
- [ ] Only searches within sync scope (prevents finding library components not in scope)
- [ ] Handles nested component instances