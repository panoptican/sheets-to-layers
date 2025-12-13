/**
 * Unit tests for layer traversal engine.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  traverseLayers,
  hasSelection,
  getSelectionCount,
  suggestSyncScope,
  getReferencedLabels,
  getReferencedWorksheets,
} from '../../src/core/traversal';
import {
  createMockDocument,
  createMockPage,
  createMockFrame,
  createMockGroup,
  createMockText,
  createMockComponent,
  createMockInstance,
  createMockRectangle,
  createMockFigma,
  setupMockFigma,
  cleanupMockFigma,
  resetNodeIdCounter,
  type MockPageNode,
  type MockSceneNode,
} from '../mocks/figma';

describe('traverseLayers', () => {
  beforeEach(() => {
    resetNodeIdCounter();
  });

  afterEach(() => {
    cleanupMockFigma();
  });

  describe('basic traversal', () => {
    it('finds layers with bindings', async () => {
      const page = createMockPage('Page 1', [
        createMockFrame('Card', [
          createMockText('#Title'),
          createMockText('#Description'),
        ]),
      ]);
      const doc = createMockDocument([page]);
      setupMockFigma(createMockFigma(doc, page));

      const result = await traverseLayers({ scope: 'page' });

      expect(result.layers).toHaveLength(2);
      expect(result.layers[0].resolvedBinding.labels).toEqual(['Title']);
      expect(result.layers[1].resolvedBinding.labels).toEqual(['Description']);
    });

    it('returns empty array when no bindings exist', async () => {
      const page = createMockPage('Page 1', [
        createMockFrame('Card', [
          createMockText('Regular Text'),
          createMockRectangle('Background'),
        ]),
      ]);
      const doc = createMockDocument([page]);
      setupMockFigma(createMockFigma(doc, page));

      const result = await traverseLayers({ scope: 'page' });

      expect(result.layers).toHaveLength(0);
      expect(result.layersExamined).toBe(3); // Card, Regular Text, Background
    });

    it('counts examined layers correctly', async () => {
      const page = createMockPage('Page 1', [
        createMockFrame('Container', [
          createMockText('#Title'),
          createMockText('Subtitle'),
          createMockRectangle('Box'),
        ]),
      ]);
      const doc = createMockDocument([page]);
      setupMockFigma(createMockFigma(doc, page));

      const result = await traverseLayers({ scope: 'page' });

      expect(result.layersExamined).toBe(4); // Container + 3 children
      expect(result.layers).toHaveLength(1); // Only #Title has binding
    });
  });

  describe('ignore prefix (-)', () => {
    it('skips layers with ignore prefix', async () => {
      const page = createMockPage('Page 1', [
        createMockText('#Title'),
        createMockText('-#Ignored'),
        createMockText('#Description'),
      ]);
      const doc = createMockDocument([page]);
      setupMockFigma(createMockFigma(doc, page));

      const result = await traverseLayers({ scope: 'page' });

      expect(result.layers).toHaveLength(2);
      expect(result.layers.map(l => l.resolvedBinding.labels[0])).toEqual(['Title', 'Description']);
      expect(result.layersIgnored).toBe(1);
    });

    it('skips entire subtree when parent is ignored', async () => {
      const page = createMockPage('Page 1', [
        createMockFrame('-IgnoredSection', [
          createMockText('#Title'),
          createMockText('#Description'),
          createMockFrame('Nested', [
            createMockText('#DeepLabel'),
          ]),
        ]),
        createMockText('#VisibleLabel'),
      ]);
      const doc = createMockDocument([page]);
      setupMockFigma(createMockFigma(doc, page));

      const result = await traverseLayers({ scope: 'page' });

      expect(result.layers).toHaveLength(1);
      expect(result.layers[0].resolvedBinding.labels[0]).toBe('VisibleLabel');
      expect(result.layersIgnored).toBe(1); // Only the parent is counted as ignored
    });
  });

  describe('main components', () => {
    it('skips main components by default', async () => {
      const page = createMockPage('Page 1', [
        createMockComponent('CardComponent', [
          createMockText('#Title'),
        ]),
        createMockText('#Outside'),
      ]);
      const doc = createMockDocument([page]);
      setupMockFigma(createMockFigma(doc, page));

      const result = await traverseLayers({ scope: 'page' });

      expect(result.layers).toHaveLength(1);
      expect(result.layers[0].resolvedBinding.labels[0]).toBe('Outside');
      expect(result.componentsSkipped).toBe(1);
    });

    it('includes force-included components (+prefix)', async () => {
      const page = createMockPage('Page 1', [
        createMockComponent('+CardComponent', [
          createMockText('#Title'),
        ]),
      ]);
      const doc = createMockDocument([page]);
      setupMockFigma(createMockFigma(doc, page));

      const result = await traverseLayers({ scope: 'page' });

      // Should include the component's children
      expect(result.layers).toHaveLength(1);
      expect(result.layers[0].resolvedBinding.labels[0]).toBe('Title');
      expect(result.componentsSkipped).toBe(0);
    });

    it('traverses component instances', async () => {
      const component = createMockComponent('CardComponent', [
        createMockText('#Title'),
      ]);
      const page = createMockPage('Page 1', [
        component,
        createMockInstance('CardInstance', component, [
          createMockText('#Title'),
        ]),
      ]);
      const doc = createMockDocument([page]);
      setupMockFigma(createMockFigma(doc, page));

      const result = await traverseLayers({ scope: 'page' });

      // Should only find the instance's children (component is skipped)
      expect(result.layers).toHaveLength(1);
      expect(result.componentsSkipped).toBe(1);
    });
  });

  describe('sync scopes', () => {
    it('traverses entire document when scope is document', async () => {
      const page1 = createMockPage('Page 1', [
        createMockText('#FromPage1'),
      ]);
      const page2 = createMockPage('Page 2', [
        createMockText('#FromPage2'),
      ]);
      const doc = createMockDocument([page1, page2]);
      setupMockFigma(createMockFigma(doc, page1));

      const result = await traverseLayers({ scope: 'document' });

      expect(result.layers).toHaveLength(2);
      const labels = result.layers.map(l => l.resolvedBinding.labels[0]);
      expect(labels).toContain('FromPage1');
      expect(labels).toContain('FromPage2');
    });

    it('traverses only current page when scope is page', async () => {
      const page1 = createMockPage('Page 1', [
        createMockText('#FromPage1'),
      ]);
      const page2 = createMockPage('Page 2', [
        createMockText('#FromPage2'),
      ]);
      const doc = createMockDocument([page1, page2]);
      setupMockFigma(createMockFigma(doc, page1));

      const result = await traverseLayers({ scope: 'page' });

      expect(result.layers).toHaveLength(1);
      expect(result.layers[0].resolvedBinding.labels[0]).toBe('FromPage1');
    });

    it('traverses only selection when scope is selection', async () => {
      const selectedFrame = createMockFrame('Selected', [
        createMockText('#InSelection'),
      ]);
      const page = createMockPage('Page 1', [
        selectedFrame,
        createMockText('#OutsideSelection'),
      ]);
      page.selection = [selectedFrame] as MockSceneNode[];
      const doc = createMockDocument([page]);
      setupMockFigma(createMockFigma(doc, page));

      const result = await traverseLayers({ scope: 'selection' });

      expect(result.layers).toHaveLength(1);
      expect(result.layers[0].resolvedBinding.labels[0]).toBe('InSelection');
    });

    it('traverses multiple selected items', async () => {
      const text1 = createMockText('#First');
      const text2 = createMockText('#Second');
      const page = createMockPage('Page 1', [
        text1,
        text2,
        createMockText('#Third'),
      ]);
      page.selection = [text1, text2] as MockSceneNode[];
      const doc = createMockDocument([page]);
      setupMockFigma(createMockFigma(doc, page));

      const result = await traverseLayers({ scope: 'selection' });

      expect(result.layers).toHaveLength(2);
      const labels = result.layers.map(l => l.resolvedBinding.labels[0]);
      expect(labels).toContain('First');
      expect(labels).toContain('Second');
      expect(labels).not.toContain('Third');
    });
  });

  describe('depth tracking', () => {
    it('tracks depth correctly', async () => {
      const page = createMockPage('Page 1', [
        createMockFrame('Level0', [
          createMockFrame('Level1', [
            createMockText('#DeepText'),
          ]),
          createMockText('#ShallowText'),
        ]),
      ]);
      const doc = createMockDocument([page]);
      setupMockFigma(createMockFigma(doc, page));

      const result = await traverseLayers({ scope: 'page' });

      const deepLayer = result.layers.find(l => l.resolvedBinding.labels[0] === 'DeepText');
      const shallowLayer = result.layers.find(l => l.resolvedBinding.labels[0] === 'ShallowText');

      expect(deepLayer?.depth).toBe(2); // Page -> Level0 -> Level1 -> DeepText
      expect(shallowLayer?.depth).toBe(1); // Page -> Level0 -> ShallowText
    });
  });

  describe('inheritance resolution', () => {
    it('inherits worksheet from parent', async () => {
      const page = createMockPage('Page 1', [
        createMockFrame('Container // Products', [
          createMockText('#Title'),
        ]),
      ]);
      const doc = createMockDocument([page]);
      setupMockFigma(createMockFigma(doc, page));

      const result = await traverseLayers({ scope: 'page' });

      expect(result.layers).toHaveLength(1);
      expect(result.layers[0].resolvedBinding.worksheet).toBe('Products');
    });

    it('inherits index from parent', async () => {
      const page = createMockPage('Page 1', [
        createMockFrame('Container .5', [
          createMockText('#Title'),
        ]),
      ]);
      const doc = createMockDocument([page]);
      setupMockFigma(createMockFigma(doc, page));

      const result = await traverseLayers({ scope: 'page' });

      expect(result.layers).toHaveLength(1);
      expect(result.layers[0].resolvedBinding.index).toEqual({ type: 'specific', value: 5 });
    });

    it('layer-level values override inherited values', async () => {
      const page = createMockPage('Page 1', [
        createMockFrame('Container // ParentSheet .3', [
          createMockText('#Title // ChildSheet .7'),
        ]),
      ]);
      const doc = createMockDocument([page]);
      setupMockFigma(createMockFigma(doc, page));

      const result = await traverseLayers({ scope: 'page' });

      expect(result.layers).toHaveLength(1);
      expect(result.layers[0].resolvedBinding.worksheet).toBe('ChildSheet');
      expect(result.layers[0].resolvedBinding.index).toEqual({ type: 'specific', value: 7 });
    });

    it('inherits from grandparent when parent has no value', async () => {
      const page = createMockPage('Page 1', [
        createMockFrame('Grandparent // GrandSheet', [
          createMockFrame('Parent', [
            createMockText('#Title'),
          ]),
        ]),
      ]);
      const doc = createMockDocument([page]);
      setupMockFigma(createMockFigma(doc, page));

      const result = await traverseLayers({ scope: 'page' });

      expect(result.layers).toHaveLength(1);
      expect(result.layers[0].resolvedBinding.worksheet).toBe('GrandSheet');
    });
  });

  describe('multiple labels', () => {
    it('collects all labels from layer', async () => {
      const page = createMockPage('Page 1', [
        createMockText('#Title #Colour #Status'),
      ]);
      const doc = createMockDocument([page]);
      setupMockFigma(createMockFigma(doc, page));

      const result = await traverseLayers({ scope: 'page' });

      expect(result.layers).toHaveLength(1);
      expect(result.layers[0].resolvedBinding.labels).toEqual(['Title', 'Colour', 'Status']);
    });
  });

  describe('repeat frames', () => {
    it('marks repeat frame layers', async () => {
      const page = createMockPage('Page 1', [
        createMockFrame('Cards @#', [
          createMockText('#Title'),
        ]),
      ]);
      const doc = createMockDocument([page]);
      setupMockFigma(createMockFigma(doc, page));

      const result = await traverseLayers({ scope: 'page' });

      // Both the repeat frame container and child should be in results
      // But only the child has hasBinding=true, the container is marked as repeat frame
      const repeatFrame = result.layers.find(l => l.resolvedBinding.isRepeatFrame);
      expect(repeatFrame).toBeUndefined(); // Container doesn't have binding

      // The child has binding
      expect(result.layers).toHaveLength(1);
      expect(result.layers[0].resolvedBinding.labels[0]).toBe('Title');
    });
  });

  describe('traversal order', () => {
    it('maintains depth-first order', async () => {
      const page = createMockPage('Page 1', [
        createMockFrame('First', [
          createMockText('#A'),
          createMockText('#B'),
        ]),
        createMockFrame('Second', [
          createMockText('#C'),
        ]),
      ]);
      const doc = createMockDocument([page]);
      setupMockFigma(createMockFigma(doc, page));

      const result = await traverseLayers({ scope: 'page' });

      const labels = result.layers.map(l => l.resolvedBinding.labels[0]);
      expect(labels).toEqual(['A', 'B', 'C']);
    });
  });
});

describe('hasSelection', () => {
  afterEach(() => {
    cleanupMockFigma();
  });

  it('returns true when layers are selected', () => {
    const text = createMockText('#Title');
    const page = createMockPage('Page 1', [text]);
    page.selection = [text] as MockSceneNode[];
    const doc = createMockDocument([page]);
    setupMockFigma(createMockFigma(doc, page));

    expect(hasSelection()).toBe(true);
  });

  it('returns false when no layers are selected', () => {
    const page = createMockPage('Page 1', [
      createMockText('#Title'),
    ]);
    page.selection = [];
    const doc = createMockDocument([page]);
    setupMockFigma(createMockFigma(doc, page));

    expect(hasSelection()).toBe(false);
  });
});

describe('getSelectionCount', () => {
  afterEach(() => {
    cleanupMockFigma();
  });

  it('returns correct count', () => {
    const text1 = createMockText('#A');
    const text2 = createMockText('#B');
    const page = createMockPage('Page 1', [text1, text2]);
    page.selection = [text1, text2] as MockSceneNode[];
    const doc = createMockDocument([page]);
    setupMockFigma(createMockFigma(doc, page));

    expect(getSelectionCount()).toBe(2);
  });
});

describe('suggestSyncScope', () => {
  afterEach(() => {
    cleanupMockFigma();
  });

  it('suggests selection when layers are selected', () => {
    const text = createMockText('#Title');
    const page = createMockPage('Page 1', [text]);
    page.selection = [text] as MockSceneNode[];
    const doc = createMockDocument([page]);
    setupMockFigma(createMockFigma(doc, page));

    expect(suggestSyncScope()).toBe('selection');
  });

  it('suggests page when no layers are selected', () => {
    const page = createMockPage('Page 1', [
      createMockText('#Title'),
    ]);
    page.selection = [];
    const doc = createMockDocument([page]);
    setupMockFigma(createMockFigma(doc, page));

    expect(suggestSyncScope()).toBe('page');
  });
});

describe('getReferencedLabels', () => {
  afterEach(() => {
    cleanupMockFigma();
  });

  it('collects all unique labels', async () => {
    const page = createMockPage('Page 1', [
      createMockText('#Title'),
      createMockText('#Description'),
      createMockText('#Title'), // Duplicate
      createMockText('#Price'),
    ]);
    const doc = createMockDocument([page]);
    setupMockFigma(createMockFigma(doc, page));

    const labels = await getReferencedLabels('page');

    expect(labels.size).toBe(3);
    expect(labels.has('Title')).toBe(true);
    expect(labels.has('Description')).toBe(true);
    expect(labels.has('Price')).toBe(true);
  });
});

describe('getReferencedWorksheets', () => {
  afterEach(() => {
    cleanupMockFigma();
  });

  it('collects all unique worksheets', async () => {
    const page = createMockPage('Page 1', [
      createMockFrame('Container // Products', [
        createMockText('#Title'),
      ]),
      createMockFrame('Another // Categories', [
        createMockText('#Name'),
      ]),
      createMockText('#NoWorksheet'),
    ]);
    const doc = createMockDocument([page]);
    setupMockFigma(createMockFigma(doc, page));

    const worksheets = await getReferencedWorksheets('page');

    expect(worksheets.size).toBe(2);
    expect(worksheets.has('Products')).toBe(true);
    expect(worksheets.has('Categories')).toBe(true);
  });
});
