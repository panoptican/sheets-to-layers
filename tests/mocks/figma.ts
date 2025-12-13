/**
 * Mock Figma API for testing.
 *
 * Provides mock implementations of Figma types and the global `figma` object
 * for unit testing plugin code without the actual Figma environment.
 */

// ============================================================================
// Mock Node Types
// ============================================================================

/**
 * Mock bounding box for absolute positioning.
 */
export interface MockRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Base interface for all mock nodes.
 */
export interface MockBaseNode {
  id: string;
  name: string;
  type: string;
  parent: MockBaseNode | null;
  /** Whether the node is visible */
  visible: boolean;
  /** Opacity (0-1) */
  opacity: number;
  /** X position relative to parent */
  x: number;
  /** Y position relative to parent */
  y: number;
  /** Width in pixels */
  width: number;
  /** Height in pixels */
  height: number;
  /** Rotation in degrees */
  rotation: number;
  /** Absolute bounding box (page coordinates) */
  absoluteBoundingBox: MockRect | null;
  /** Resize the node */
  resize: (width: number, height: number) => void;
  /** Clone the node */
  clone: () => MockBaseNode;
  /** Remove the node from its parent */
  remove: () => void;
}

/**
 * Mock node that can have children.
 */
export interface MockContainerNode extends MockBaseNode {
  children: MockSceneNode[];
}

/**
 * Mock scene node (any visible node).
 */
export type MockSceneNode = MockFrameNode | MockTextNode | MockComponentNode | MockInstanceNode | MockRectangleNode | MockGroupNode | MockEllipseNode | MockVectorNode | MockComponentSetNode;

/**
 * Mock frame node.
 */
export interface MockFrameNode extends MockContainerNode {
  type: 'FRAME';
  fills: MockPaint[];
  /** Auto-layout mode: 'NONE', 'HORIZONTAL', or 'VERTICAL' */
  layoutMode: 'NONE' | 'HORIZONTAL' | 'VERTICAL';
  /** Append a child node */
  appendChild: (child: MockSceneNode) => void;
}

/**
 * Mock group node.
 */
export interface MockGroupNode extends MockContainerNode {
  type: 'GROUP';
}

/**
 * Mock font name.
 */
export interface MockFontName {
  family: string;
  style: string;
}

/**
 * Mock mixed symbol for fonts.
 */
export const MOCK_MIXED_SYMBOL = Symbol('mixed');

/**
 * Mock line height.
 */
export interface MockLineHeight {
  unit: 'AUTO' | 'PIXELS' | 'PERCENT';
  value?: number;
}

/**
 * Mock letter spacing.
 */
export interface MockLetterSpacing {
  unit: 'PIXELS' | 'PERCENT';
  value: number;
}

/**
 * Mock text node.
 */
export interface MockTextNode extends MockBaseNode {
  type: 'TEXT';
  characters: string;
  fontName: MockFontName | typeof MOCK_MIXED_SYMBOL;
  /** For mixed fonts, stores fonts per character index */
  _mixedFonts?: MockFontName[];
  getRangeFontName: (start: number, end: number) => MockFontName;
  /** Horizontal text alignment */
  textAlignHorizontal: 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED';
  /** Vertical text alignment */
  textAlignVertical: 'TOP' | 'CENTER' | 'BOTTOM';
  /** Font size in pixels */
  fontSize: number;
  /** Line height */
  lineHeight: MockLineHeight;
  /** Letter spacing */
  letterSpacing: MockLetterSpacing;
}

/**
 * Mock component node (main component).
 */
export interface MockComponentNode extends MockContainerNode {
  type: 'COMPONENT';
}

/**
 * Mock component set node (variant container).
 */
export interface MockComponentSetNode extends MockBaseNode {
  type: 'COMPONENT_SET';
  children: MockComponentNode[];
}

/**
 * Mock component instance.
 */
export interface MockInstanceNode extends MockContainerNode {
  type: 'INSTANCE';
  mainComponent: MockComponentNode | null;
  /** Swap to a different component */
  swapComponent: (component: MockComponentNode) => void;
}

/**
 * Mock image paint.
 */
export interface MockImagePaint {
  type: 'IMAGE';
  scaleMode: 'FILL' | 'FIT' | 'CROP' | 'TILE';
  imageHash: string;
}

/**
 * Mock solid paint.
 */
export interface MockSolidPaint {
  type: 'SOLID';
  color: { r: number; g: number; b: number };
}

/**
 * Mock paint type.
 */
export type MockPaint = MockImagePaint | MockSolidPaint;

/**
 * Mock rectangle node.
 */
export interface MockRectangleNode extends MockBaseNode {
  type: 'RECTANGLE';
  fills: MockPaint[];
}

/**
 * Mock ellipse node.
 */
export interface MockEllipseNode extends MockBaseNode {
  type: 'ELLIPSE';
  fills: MockPaint[];
}

/**
 * Mock vector node.
 */
export interface MockVectorNode extends MockBaseNode {
  type: 'VECTOR';
  fills: MockPaint[];
}

/**
 * Mock page node.
 */
export interface MockPageNode extends MockContainerNode {
  type: 'PAGE';
  loadAsync: () => Promise<void>;
  selection: MockSceneNode[];
}

/**
 * Mock document node.
 */
export interface MockDocumentNode extends MockBaseNode {
  type: 'DOCUMENT';
  children: MockPageNode[];
}

// ============================================================================
// Node Factory Functions
// ============================================================================

let nodeIdCounter = 0;

function generateId(): string {
  return `mock-node-${++nodeIdCounter}`;
}

/**
 * Default base properties for mock nodes.
 */
interface BaseNodeOptions {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  opacity?: number;
  rotation?: number;
}

/**
 * Create the base properties shared by all mock nodes.
 * Returns an object whose resize method properly updates width/height.
 */
function createBaseProperties(options: BaseNodeOptions = {}): {
  opacity: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  absoluteBoundingBox: MockRect | null;
  resize: (width: number, height: number) => void;
} {
  const x = options.x ?? 0;
  const y = options.y ?? 0;
  const initialWidth = options.width ?? 100;
  const initialHeight = options.height ?? 100;

  // Create the props object first so resize can reference it
  const props: {
    opacity: number;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    absoluteBoundingBox: MockRect | null;
    resize: (width: number, height: number) => void;
  } = {
    opacity: options.opacity ?? 1,
    x,
    y,
    width: initialWidth,
    height: initialHeight,
    rotation: options.rotation ?? 0,
    absoluteBoundingBox: { x, y, width: initialWidth, height: initialHeight },
    resize: function(this: typeof props, newWidth: number, newHeight: number): void {
      // Note: 'this' is bound to the object that spread these props
      // We use the fact that when spread, resize becomes a method on the new object
    } as (width: number, height: number) => void,
  };

  return props;
}

/**
 * Create a resize function that updates the given node's dimensions.
 */
function createResizeFunction<T extends { width: number; height: number; absoluteBoundingBox: MockRect | null }>(
  node: T
): (width: number, height: number) => void {
  return (newWidth: number, newHeight: number): void => {
    node.width = newWidth;
    node.height = newHeight;
    if (node.absoluteBoundingBox) {
      node.absoluteBoundingBox.width = newWidth;
      node.absoluteBoundingBox.height = newHeight;
    }
  };
}

/**
 * Options for creating a mock frame node.
 */
export interface MockFrameOptions extends BaseNodeOptions {
  /** Auto-layout mode: 'NONE', 'HORIZONTAL', or 'VERTICAL' */
  layoutMode?: 'NONE' | 'HORIZONTAL' | 'VERTICAL';
}

/**
 * Create a remove function that removes the node from its parent.
 */
function createRemoveFunction<T extends MockBaseNode>(node: T): () => void {
  return (): void => {
    if (node.parent && 'children' in node.parent) {
      const parent = node.parent as MockContainerNode;
      const index = parent.children.indexOf(node as unknown as MockSceneNode);
      if (index !== -1) {
        parent.children.splice(index, 1);
      }
      node.parent = null;
    }
  };
}

/**
 * Create a clone function for a frame node.
 */
function createFrameCloneFunction(frame: MockFrameNode): () => MockFrameNode {
  return (): MockFrameNode => {
    // Clone children recursively
    const clonedChildren: MockSceneNode[] = frame.children.map((child) => {
      if ('clone' in child) {
        return (child as MockBaseNode).clone() as MockSceneNode;
      }
      return child;
    });
    const cloned = createMockFrame(
      frame.name,
      clonedChildren,
      [...frame.fills],
      {
        x: frame.x,
        y: frame.y,
        width: frame.width,
        height: frame.height,
        opacity: frame.opacity,
        rotation: frame.rotation,
        layoutMode: frame.layoutMode,
      }
    );
    cloned.visible = frame.visible;
    return cloned;
  };
}

/**
 * Create a mock frame node.
 */
export function createMockFrame(
  name: string,
  children: MockSceneNode[] = [],
  fills: MockPaint[] = [],
  baseOptions?: MockFrameOptions
): MockFrameNode {
  const baseProps = createBaseProperties(baseOptions);
  const layoutMode = baseOptions?.layoutMode ?? 'NONE';
  const frame: MockFrameNode = {
    id: generateId(),
    name,
    type: 'FRAME',
    parent: null,
    visible: true,
    ...baseProps,
    children,
    fills,
    layoutMode,
    appendChild: null as unknown as (child: MockSceneNode) => void,
    clone: null as unknown as () => MockFrameNode,
    remove: null as unknown as () => void,
  };
  // Bind resize function to the actual node
  frame.resize = createResizeFunction(frame);
  // Bind appendChild function
  frame.appendChild = (child: MockSceneNode): void => {
    frame.children.push(child);
    (child as MockBaseNode).parent = frame;
  };
  // Bind clone function
  frame.clone = createFrameCloneFunction(frame);
  // Bind remove function
  frame.remove = createRemoveFunction(frame);
  // Set parent references
  for (const child of children) {
    (child as MockBaseNode).parent = frame;
  }
  return frame;
}

/**
 * Create a clone function for a group node.
 */
function createGroupCloneFunction(group: MockGroupNode): () => MockGroupNode {
  return (): MockGroupNode => {
    const clonedChildren: MockSceneNode[] = group.children.map((child) => {
      if ('clone' in child) {
        return (child as MockBaseNode).clone() as MockSceneNode;
      }
      return child;
    });
    const cloned = createMockGroup(group.name, clonedChildren, {
      x: group.x,
      y: group.y,
      width: group.width,
      height: group.height,
      opacity: group.opacity,
      rotation: group.rotation,
    });
    cloned.visible = group.visible;
    return cloned;
  };
}

/**
 * Create a mock group node.
 */
export function createMockGroup(name: string, children: MockSceneNode[] = [], baseOptions?: BaseNodeOptions): MockGroupNode {
  const baseProps = createBaseProperties(baseOptions);
  const group: MockGroupNode = {
    id: generateId(),
    name,
    type: 'GROUP',
    parent: null,
    visible: true,
    ...baseProps,
    children,
    clone: null as unknown as () => MockGroupNode,
    remove: null as unknown as () => void,
  };
  group.resize = createResizeFunction(group);
  group.clone = createGroupCloneFunction(group);
  group.remove = createRemoveFunction(group);
  for (const child of children) {
    (child as MockBaseNode).parent = group;
  }
  return group;
}

/**
 * Default font for text nodes.
 */
export const DEFAULT_MOCK_FONT: MockFontName = {
  family: 'Inter',
  style: 'Regular',
};

/**
 * Options for creating a mock text node.
 */
export interface MockTextOptions {
  textAlignHorizontal?: 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED';
  textAlignVertical?: 'TOP' | 'CENTER' | 'BOTTOM';
  fontSize?: number;
  lineHeight?: MockLineHeight;
  letterSpacing?: MockLetterSpacing;
}

/**
 * Create a clone function for a text node.
 */
function createTextCloneFunction(text: MockTextNode): () => MockTextNode {
  return (): MockTextNode => {
    const cloned = createMockText(
      text.name,
      text.characters,
      text.fontName,
      text._mixedFonts,
      {
        x: text.x,
        y: text.y,
        width: text.width,
        height: text.height,
        opacity: text.opacity,
        rotation: text.rotation,
      },
      {
        textAlignHorizontal: text.textAlignHorizontal,
        textAlignVertical: text.textAlignVertical,
        fontSize: text.fontSize,
        lineHeight: { ...text.lineHeight },
        letterSpacing: { ...text.letterSpacing },
      }
    );
    cloned.visible = text.visible;
    return cloned;
  };
}

/**
 * Create a mock text node.
 */
export function createMockText(
  name: string,
  characters: string = '',
  fontName: MockFontName | typeof MOCK_MIXED_SYMBOL = DEFAULT_MOCK_FONT,
  mixedFonts?: MockFontName[],
  baseOptions?: BaseNodeOptions,
  textOptions?: MockTextOptions
): MockTextNode {
  const baseProps = createBaseProperties(baseOptions);
  const text: MockTextNode = {
    id: generateId(),
    name,
    type: 'TEXT',
    parent: null,
    visible: true,
    ...baseProps,
    characters,
    fontName,
    _mixedFonts: mixedFonts,
    getRangeFontName(start: number, _end: number): MockFontName {
      if (mixedFonts && mixedFonts[start]) {
        return mixedFonts[start];
      }
      if (fontName !== MOCK_MIXED_SYMBOL) {
        return fontName;
      }
      return DEFAULT_MOCK_FONT;
    },
    textAlignHorizontal: textOptions?.textAlignHorizontal ?? 'LEFT',
    textAlignVertical: textOptions?.textAlignVertical ?? 'TOP',
    fontSize: textOptions?.fontSize ?? 12,
    lineHeight: textOptions?.lineHeight ?? { unit: 'AUTO' },
    letterSpacing: textOptions?.letterSpacing ?? { unit: 'PIXELS', value: 0 },
    clone: null as unknown as () => MockTextNode,
    remove: null as unknown as () => void,
  };
  text.resize = createResizeFunction(text);
  text.clone = createTextCloneFunction(text);
  text.remove = createRemoveFunction(text);
  return text;
}

/**
 * Create a clone function for a component node.
 */
function createComponentCloneFunction(component: MockComponentNode): () => MockComponentNode {
  return (): MockComponentNode => {
    const clonedChildren: MockSceneNode[] = component.children.map((child) => {
      if ('clone' in child) {
        return (child as MockBaseNode).clone() as MockSceneNode;
      }
      return child;
    });
    const cloned = createMockComponent(component.name, clonedChildren, {
      x: component.x,
      y: component.y,
      width: component.width,
      height: component.height,
      opacity: component.opacity,
      rotation: component.rotation,
    });
    cloned.visible = component.visible;
    return cloned;
  };
}

/**
 * Create a mock component node.
 */
export function createMockComponent(name: string, children: MockSceneNode[] = [], baseOptions?: BaseNodeOptions): MockComponentNode {
  const baseProps = createBaseProperties(baseOptions);
  const component: MockComponentNode = {
    id: generateId(),
    name,
    type: 'COMPONENT',
    parent: null,
    visible: true,
    ...baseProps,
    children,
    clone: null as unknown as () => MockComponentNode,
    remove: null as unknown as () => void,
  };
  component.resize = createResizeFunction(component);
  component.clone = createComponentCloneFunction(component);
  component.remove = createRemoveFunction(component);
  for (const child of children) {
    (child as MockBaseNode).parent = component;
  }
  return component;
}

/**
 * Create a clone function for an instance node.
 */
function createInstanceCloneFunction(instance: MockInstanceNode): () => MockInstanceNode {
  return (): MockInstanceNode => {
    const clonedChildren: MockSceneNode[] = instance.children.map((child) => {
      if ('clone' in child) {
        return (child as MockBaseNode).clone() as MockSceneNode;
      }
      return child;
    });
    const cloned = createMockInstance(
      instance.name,
      instance.mainComponent,
      clonedChildren,
      {
        x: instance.x,
        y: instance.y,
        width: instance.width,
        height: instance.height,
        opacity: instance.opacity,
        rotation: instance.rotation,
      }
    );
    cloned.visible = instance.visible;
    return cloned;
  };
}

/**
 * Create a mock component instance.
 */
export function createMockInstance(name: string, mainComponent: MockComponentNode | null = null, children: MockSceneNode[] = [], baseOptions?: BaseNodeOptions): MockInstanceNode {
  const baseProps = createBaseProperties(baseOptions);
  const instance: MockInstanceNode = {
    id: generateId(),
    name,
    type: 'INSTANCE',
    parent: null,
    visible: true,
    ...baseProps,
    mainComponent,
    children,
    swapComponent(component: MockComponentNode): void {
      instance.mainComponent = component;
    },
    clone: null as unknown as () => MockInstanceNode,
    remove: null as unknown as () => void,
  };
  instance.resize = createResizeFunction(instance);
  instance.clone = createInstanceCloneFunction(instance);
  instance.remove = createRemoveFunction(instance);
  for (const child of children) {
    (child as MockBaseNode).parent = instance;
  }
  return instance;
}

/**
 * Create a clone function for a component set node.
 */
function createComponentSetCloneFunction(componentSet: MockComponentSetNode): () => MockComponentSetNode {
  return (): MockComponentSetNode => {
    const clonedVariants: MockComponentNode[] = componentSet.children.map((child) => {
      if ('clone' in child) {
        return (child as MockBaseNode).clone() as MockComponentNode;
      }
      return child;
    });
    const cloned = createMockComponentSet(componentSet.name, clonedVariants, {
      x: componentSet.x,
      y: componentSet.y,
      width: componentSet.width,
      height: componentSet.height,
      opacity: componentSet.opacity,
      rotation: componentSet.rotation,
    });
    cloned.visible = componentSet.visible;
    return cloned;
  };
}

/**
 * Create a mock component set (variant container).
 */
export function createMockComponentSet(name: string, variants: MockComponentNode[] = [], baseOptions?: BaseNodeOptions): MockComponentSetNode {
  const baseProps = createBaseProperties(baseOptions);
  const componentSet: MockComponentSetNode = {
    id: generateId(),
    name,
    type: 'COMPONENT_SET',
    parent: null,
    visible: true,
    ...baseProps,
    children: variants,
    clone: null as unknown as () => MockComponentSetNode,
    remove: null as unknown as () => void,
  };
  componentSet.resize = createResizeFunction(componentSet);
  componentSet.clone = createComponentSetCloneFunction(componentSet);
  componentSet.remove = createRemoveFunction(componentSet);
  for (const variant of variants) {
    (variant as MockBaseNode).parent = componentSet;
  }
  return componentSet;
}

/**
 * Create a clone function for a rectangle node.
 */
function createRectangleCloneFunction(rect: MockRectangleNode): () => MockRectangleNode {
  return (): MockRectangleNode => {
    const cloned = createMockRectangle(rect.name, [...rect.fills], {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      opacity: rect.opacity,
      rotation: rect.rotation,
    });
    cloned.visible = rect.visible;
    return cloned;
  };
}

/**
 * Create a mock rectangle node.
 */
export function createMockRectangle(name: string, fills: MockPaint[] = [], baseOptions?: BaseNodeOptions): MockRectangleNode {
  const baseProps = createBaseProperties(baseOptions);
  const rect: MockRectangleNode = {
    id: generateId(),
    name,
    type: 'RECTANGLE',
    parent: null,
    visible: true,
    ...baseProps,
    fills,
    clone: null as unknown as () => MockRectangleNode,
    remove: null as unknown as () => void,
  };
  rect.resize = createResizeFunction(rect);
  rect.clone = createRectangleCloneFunction(rect);
  rect.remove = createRemoveFunction(rect);
  return rect;
}

/**
 * Create a clone function for an ellipse node.
 */
function createEllipseCloneFunction(ellipse: MockEllipseNode): () => MockEllipseNode {
  return (): MockEllipseNode => {
    const cloned = createMockEllipse(ellipse.name, [...ellipse.fills], {
      x: ellipse.x,
      y: ellipse.y,
      width: ellipse.width,
      height: ellipse.height,
      opacity: ellipse.opacity,
      rotation: ellipse.rotation,
    });
    cloned.visible = ellipse.visible;
    return cloned;
  };
}

/**
 * Create a mock ellipse node.
 */
export function createMockEllipse(name: string, fills: MockPaint[] = [], baseOptions?: BaseNodeOptions): MockEllipseNode {
  const baseProps = createBaseProperties(baseOptions);
  const ellipse: MockEllipseNode = {
    id: generateId(),
    name,
    type: 'ELLIPSE',
    parent: null,
    visible: true,
    ...baseProps,
    fills,
    clone: null as unknown as () => MockEllipseNode,
    remove: null as unknown as () => void,
  };
  ellipse.resize = createResizeFunction(ellipse);
  ellipse.clone = createEllipseCloneFunction(ellipse);
  ellipse.remove = createRemoveFunction(ellipse);
  return ellipse;
}

/**
 * Create a clone function for a vector node.
 */
function createVectorCloneFunction(vector: MockVectorNode): () => MockVectorNode {
  return (): MockVectorNode => {
    const cloned = createMockVector(vector.name, [...vector.fills], {
      x: vector.x,
      y: vector.y,
      width: vector.width,
      height: vector.height,
      opacity: vector.opacity,
      rotation: vector.rotation,
    });
    cloned.visible = vector.visible;
    return cloned;
  };
}

/**
 * Create a mock vector node.
 */
export function createMockVector(name: string, fills: MockPaint[] = [], baseOptions?: BaseNodeOptions): MockVectorNode {
  const baseProps = createBaseProperties(baseOptions);
  const vector: MockVectorNode = {
    id: generateId(),
    name,
    type: 'VECTOR',
    parent: null,
    visible: true,
    ...baseProps,
    fills,
    clone: null as unknown as () => MockVectorNode,
    remove: null as unknown as () => void,
  };
  vector.resize = createResizeFunction(vector);
  vector.clone = createVectorCloneFunction(vector);
  vector.remove = createRemoveFunction(vector);
  return vector;
}

/**
 * Create a mock page node.
 */
export function createMockPage(name: string, children: MockSceneNode[] = [], baseOptions?: BaseNodeOptions): MockPageNode {
  const baseProps = createBaseProperties(baseOptions);
  const page: MockPageNode = {
    id: generateId(),
    name,
    type: 'PAGE',
    parent: null,
    visible: true,
    ...baseProps,
    children,
    selection: [],
    loadAsync: async () => {
      // No-op for testing - page is already "loaded"
    },
  };
  page.resize = createResizeFunction(page);
  for (const child of children) {
    (child as MockBaseNode).parent = page;
  }
  return page;
}

/**
 * Create a mock document node.
 */
export function createMockDocument(children: MockPageNode[] = [], baseOptions?: BaseNodeOptions): MockDocumentNode {
  const baseProps = createBaseProperties(baseOptions);
  const doc: MockDocumentNode = {
    id: 'mock-document',
    name: 'Document',
    type: 'DOCUMENT',
    parent: null,
    visible: true,
    ...baseProps,
    children,
  };
  doc.resize = createResizeFunction(doc);
  for (const child of children) {
    (child as MockBaseNode).parent = doc;
  }
  return doc;
}

// ============================================================================
// Mock Figma Global
// ============================================================================

/**
 * Mock image object returned by createImage.
 */
export interface MockImage {
  hash: string;
}

/**
 * Mock implementation of the Figma global object.
 */
export interface MockFigma {
  root: MockDocumentNode;
  currentPage: MockPageNode;
  /** Symbol used to indicate mixed values (like mixed fonts) */
  mixed: typeof MOCK_MIXED_SYMBOL;
  /** Load a font asynchronously (mock always succeeds) */
  loadFontAsync: (font: MockFontName) => Promise<void>;
  /** Create an image from bytes */
  createImage: (data: Uint8Array) => MockImage;
  /** Track which fonts have been loaded (for test assertions) */
  _loadedFonts: Set<string>;
  /** Set of fonts that should fail to load */
  _failingFonts?: Set<string>;
  /** Track created images for test assertions */
  _createdImages: MockImage[];
}

let imageCounter = 0;

/**
 * Create a mock Figma global with the given document structure.
 */
export function createMockFigma(root: MockDocumentNode, currentPage?: MockPageNode): MockFigma {
  const loadedFonts = new Set<string>();
  let failingFonts: Set<string> | undefined;
  const createdImages: MockImage[] = [];

  const mockFigma: MockFigma = {
    root,
    currentPage: currentPage || root.children[0] || createMockPage('Page 1'),
    mixed: MOCK_MIXED_SYMBOL,
    _loadedFonts: loadedFonts,
    _failingFonts: failingFonts,
    _createdImages: createdImages,
    async loadFontAsync(font: MockFontName): Promise<void> {
      const fontKey = `${font.family}:${font.style}`;
      if (mockFigma._failingFonts?.has(fontKey)) {
        throw new Error(`Font not found: ${font.family} ${font.style}`);
      }
      loadedFonts.add(fontKey);
    },
    createImage(data: Uint8Array): MockImage {
      const hash = `mock-image-hash-${++imageCounter}-${data.length}`;
      const image: MockImage = { hash };
      createdImages.push(image);
      return image;
    },
  };

  return mockFigma;
}

/**
 * Set up the global figma object with mocks.
 * Call this in beforeEach() of your tests.
 */
export function setupMockFigma(mockFigma: MockFigma): void {
  (globalThis as unknown as { figma: MockFigma }).figma = mockFigma;
}

/**
 * Clean up the global figma object.
 * Call this in afterEach() of your tests.
 */
export function cleanupMockFigma(): void {
  delete (globalThis as unknown as { figma?: MockFigma }).figma;
}

/**
 * Reset the node ID counter.
 * Useful for deterministic test IDs.
 */
export function resetNodeIdCounter(): void {
  nodeIdCounter = 0;
}

/**
 * Get the mock figma global (for test assertions).
 */
export function getMockFigma(): MockFigma | undefined {
  return (globalThis as unknown as { figma?: MockFigma }).figma;
}

/**
 * Set fonts that should fail to load.
 * @param fonts - Array of font keys in "family:style" format
 */
export function setFailingFonts(fonts: string[]): void {
  const mockFigma = getMockFigma();
  if (mockFigma) {
    mockFigma._failingFonts = new Set(fonts);
  }
}

/**
 * Get the set of fonts that have been loaded.
 * Useful for asserting that fonts were loaded before text changes.
 */
export function getLoadedFonts(): Set<string> {
  const mockFigma = getMockFigma();
  return mockFigma?._loadedFonts ?? new Set();
}

/**
 * Clear the loaded fonts tracking.
 */
export function clearLoadedFonts(): void {
  const mockFigma = getMockFigma();
  if (mockFigma) {
    mockFigma._loadedFonts.clear();
  }
}

/**
 * Get the list of created images.
 * Useful for asserting that images were created.
 */
export function getCreatedImages(): MockImage[] {
  const mockFigma = getMockFigma();
  return mockFigma?._createdImages ?? [];
}

/**
 * Clear the created images tracking.
 */
export function clearCreatedImages(): void {
  const mockFigma = getMockFigma();
  if (mockFigma) {
    mockFigma._createdImages.length = 0;
  }
}

/**
 * Reset the image counter.
 * Useful for deterministic test image hashes.
 */
export function resetImageCounter(): void {
  imageCounter = 0;
}
