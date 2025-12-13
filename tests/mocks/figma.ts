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
 * Base interface for all mock nodes.
 */
export interface MockBaseNode {
  id: string;
  name: string;
  type: string;
  parent: MockBaseNode | null;
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
export type MockSceneNode = MockFrameNode | MockTextNode | MockComponentNode | MockInstanceNode | MockRectangleNode | MockGroupNode;

/**
 * Mock frame node.
 */
export interface MockFrameNode extends MockContainerNode {
  type: 'FRAME';
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
 * Mock text node.
 */
export interface MockTextNode extends MockBaseNode {
  type: 'TEXT';
  characters: string;
  fontName: MockFontName | typeof MOCK_MIXED_SYMBOL;
  /** For mixed fonts, stores fonts per character index */
  _mixedFonts?: MockFontName[];
  getRangeFontName: (start: number, end: number) => MockFontName;
}

/**
 * Mock component node (main component).
 */
export interface MockComponentNode extends MockContainerNode {
  type: 'COMPONENT';
}

/**
 * Mock component instance.
 */
export interface MockInstanceNode extends MockContainerNode {
  type: 'INSTANCE';
  mainComponent: MockComponentNode | null;
}

/**
 * Mock rectangle node.
 */
export interface MockRectangleNode extends MockBaseNode {
  type: 'RECTANGLE';
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
 * Create a mock frame node.
 */
export function createMockFrame(name: string, children: MockSceneNode[] = []): MockFrameNode {
  const frame: MockFrameNode = {
    id: generateId(),
    name,
    type: 'FRAME',
    parent: null,
    children,
  };
  // Set parent references
  for (const child of children) {
    (child as MockBaseNode).parent = frame;
  }
  return frame;
}

/**
 * Create a mock group node.
 */
export function createMockGroup(name: string, children: MockSceneNode[] = []): MockGroupNode {
  const group: MockGroupNode = {
    id: generateId(),
    name,
    type: 'GROUP',
    parent: null,
    children,
  };
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
 * Create a mock text node.
 */
export function createMockText(
  name: string,
  characters: string = '',
  fontName: MockFontName | typeof MOCK_MIXED_SYMBOL = DEFAULT_MOCK_FONT,
  mixedFonts?: MockFontName[]
): MockTextNode {
  return {
    id: generateId(),
    name,
    type: 'TEXT',
    parent: null,
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
  };
}

/**
 * Create a mock component node.
 */
export function createMockComponent(name: string, children: MockSceneNode[] = []): MockComponentNode {
  const component: MockComponentNode = {
    id: generateId(),
    name,
    type: 'COMPONENT',
    parent: null,
    children,
  };
  for (const child of children) {
    (child as MockBaseNode).parent = component;
  }
  return component;
}

/**
 * Create a mock component instance.
 */
export function createMockInstance(name: string, mainComponent: MockComponentNode | null = null, children: MockSceneNode[] = []): MockInstanceNode {
  const instance: MockInstanceNode = {
    id: generateId(),
    name,
    type: 'INSTANCE',
    parent: null,
    mainComponent,
    children,
  };
  for (const child of children) {
    (child as MockBaseNode).parent = instance;
  }
  return instance;
}

/**
 * Create a mock rectangle node.
 */
export function createMockRectangle(name: string): MockRectangleNode {
  return {
    id: generateId(),
    name,
    type: 'RECTANGLE',
    parent: null,
  };
}

/**
 * Create a mock page node.
 */
export function createMockPage(name: string, children: MockSceneNode[] = []): MockPageNode {
  const page: MockPageNode = {
    id: generateId(),
    name,
    type: 'PAGE',
    parent: null,
    children,
    selection: [],
    loadAsync: async () => {
      // No-op for testing - page is already "loaded"
    },
  };
  for (const child of children) {
    (child as MockBaseNode).parent = page;
  }
  return page;
}

/**
 * Create a mock document node.
 */
export function createMockDocument(children: MockPageNode[] = []): MockDocumentNode {
  const doc: MockDocumentNode = {
    id: 'mock-document',
    name: 'Document',
    type: 'DOCUMENT',
    parent: null,
    children,
  };
  for (const child of children) {
    (child as MockBaseNode).parent = doc;
  }
  return doc;
}

// ============================================================================
// Mock Figma Global
// ============================================================================

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
  /** Track which fonts have been loaded (for test assertions) */
  _loadedFonts: Set<string>;
  /** Set of fonts that should fail to load */
  _failingFonts?: Set<string>;
}

/**
 * Create a mock Figma global with the given document structure.
 */
export function createMockFigma(root: MockDocumentNode, currentPage?: MockPageNode): MockFigma {
  const loadedFonts = new Set<string>();
  let failingFonts: Set<string> | undefined;

  const mockFigma: MockFigma = {
    root,
    currentPage: currentPage || root.children[0] || createMockPage('Page 1'),
    mixed: MOCK_MIXED_SYMBOL,
    _loadedFonts: loadedFonts,
    _failingFonts: failingFonts,
    async loadFontAsync(font: MockFontName): Promise<void> {
      const fontKey = `${font.family}:${font.style}`;
      if (mockFigma._failingFonts?.has(fontKey)) {
        throw new Error(`Font not found: ${font.family} ${font.style}`);
      }
      loadedFonts.add(fontKey);
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
