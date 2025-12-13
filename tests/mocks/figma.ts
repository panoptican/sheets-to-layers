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
 * Mock text node.
 */
export interface MockTextNode extends MockBaseNode {
  type: 'TEXT';
  characters: string;
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
 * Create a mock text node.
 */
export function createMockText(name: string, characters: string = ''): MockTextNode {
  return {
    id: generateId(),
    name,
    type: 'TEXT',
    parent: null,
    characters,
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
}

/**
 * Create a mock Figma global with the given document structure.
 */
export function createMockFigma(root: MockDocumentNode, currentPage?: MockPageNode): MockFigma {
  return {
    root,
    currentPage: currentPage || root.children[0] || createMockPage('Page 1'),
  };
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
