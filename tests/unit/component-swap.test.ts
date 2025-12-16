/**
 * Unit tests for component instance swapping.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createMockComponent,
  createMockComponentSet,
  createMockInstance,
  createMockFrame,
  createMockText,
  createMockPage,
  createMockDocument,
  createMockFigma,
  setupMockFigma,
  cleanupMockFigma,
  resetNodeIdCounter,
  type MockComponentNode,
  type MockInstanceNode,
} from '../mocks/figma';
import {
  normalizeComponentName,
  isVariantSyntax,
  parseVariantProperties,
  buildVariantName,
  buildComponentCache,
  findComponentByName,
  findComponentSetByName,
  findVariantComponent,
  canSwapComponent,
  swapComponent,
  batchSwapComponents,
  getCurrentComponentName,
  componentNamesMatch,
  getComponentCacheStats,
} from '../../src/core/component-swap';

describe('Component Swap', () => {
  beforeEach(() => {
    resetNodeIdCounter();
    const page = createMockPage('Page 1');
    const doc = createMockDocument([page]);
    const mockFigma = createMockFigma(doc, page);
    setupMockFigma(mockFigma);
  });

  afterEach(() => {
    cleanupMockFigma();
  });

  // ============================================================================
  // Name Normalization Tests
  // ============================================================================

  describe('normalizeComponentName', () => {
    it('lowercases names', () => {
      expect(normalizeComponentName('Button')).toBe('button');
      expect(normalizeComponentName('BUTTON')).toBe('button');
      expect(normalizeComponentName('BuTtOn')).toBe('button');
    });

    it('preserves spaces and punctuation', () => {
      expect(normalizeComponentName('Button / Primary')).toBe('button / primary');
      expect(normalizeComponentName('Size=Large')).toBe('size=large');
    });

    it('trims whitespace', () => {
      expect(normalizeComponentName('  Button  ')).toBe('button');
    });
  });

  // ============================================================================
  // Variant Syntax Tests
  // ============================================================================

  describe('isVariantSyntax', () => {
    it('returns true for simple variant syntax', () => {
      expect(isVariantSyntax('Size=Large')).toBe(true);
      expect(isVariantSyntax('Color=Primary')).toBe(true);
    });

    it('returns true for multiple properties', () => {
      expect(isVariantSyntax('Size=Large, Color=Primary')).toBe(true);
    });

    it('returns false for URLs', () => {
      expect(isVariantSyntax('https://example.com?foo=bar')).toBe(false);
      expect(isVariantSyntax('http://example.com?foo=bar')).toBe(false);
    });

    it('returns false for plain names', () => {
      expect(isVariantSyntax('Button')).toBe(false);
      expect(isVariantSyntax('Button/Primary')).toBe(false);
    });

    it('returns false for empty/invalid values', () => {
      expect(isVariantSyntax('')).toBe(false);
      expect(isVariantSyntax(null as unknown as string)).toBe(false);
    });
  });

  describe('parseVariantProperties', () => {
    it('parses single property', () => {
      const result = parseVariantProperties('Size=Large');
      expect(result.properties.get('size')).toBe('Large');
    });

    it('parses multiple properties', () => {
      const result = parseVariantProperties('Size=Large, Color=Primary');
      expect(result.properties.get('size')).toBe('Large');
      expect(result.properties.get('color')).toBe('Primary');
    });

    it('handles whitespace', () => {
      const result = parseVariantProperties('  Size = Large  ,  Color = Primary  ');
      expect(result.properties.get('size')).toBe('Large');
      expect(result.properties.get('color')).toBe('Primary');
    });

    it('preserves original string', () => {
      const result = parseVariantProperties('Size=Large');
      expect(result.original).toBe('Size=Large');
    });

    it('handles empty string', () => {
      const result = parseVariantProperties('');
      expect(result.properties.size).toBe(0);
    });
  });

  describe('buildVariantName', () => {
    it('builds variant name from properties', () => {
      const props = new Map([
        ['size', 'Large'],
        ['color', 'Primary'],
      ]);
      expect(buildVariantName(props)).toBe('size=Large, color=Primary');
    });

    it('handles empty properties', () => {
      expect(buildVariantName(new Map())).toBe('');
    });
  });

  // ============================================================================
  // Component Cache Tests
  // ============================================================================

  describe('buildComponentCache', () => {
    it('finds components in scope', async () => {
      const button = createMockComponent('Button');
      const frame = createMockFrame('Frame', [button as unknown as MockInstanceNode]);

      const cache = await buildComponentCache([frame as unknown as SceneNode]);

      expect(cache.components.has('button')).toBe(true);
      expect(cache.components.get('button')).toBe(button);
    });

    it('finds component sets and their variants', async () => {
      const variant1 = createMockComponent('Size=Small');
      const variant2 = createMockComponent('Size=Large');
      const componentSet = createMockComponentSet('Button', [variant1, variant2]);
      const frame = createMockFrame('Frame', [componentSet as unknown as MockInstanceNode]);

      const cache = await buildComponentCache([frame as unknown as SceneNode]);

      expect(cache.componentSets.has('button')).toBe(true);
      expect(cache.components.has('size=small')).toBe(true);
      expect(cache.components.has('size=large')).toBe(true);
    });

    it('finds components from instances', async () => {
      const mainComponent = createMockComponent('Button');
      const instance = createMockInstance('#Switch', mainComponent);
      const frame = createMockFrame('Frame', [instance]);

      const cache = await buildComponentCache([frame as unknown as SceneNode]);

      expect(cache.components.has('button')).toBe(true);
    });

    it('handles nested components', async () => {
      const nestedButton = createMockComponent('NestedButton');
      const innerFrame = createMockFrame('Inner', [nestedButton as unknown as MockInstanceNode]);
      const outerFrame = createMockFrame('Outer', [innerFrame]);

      const cache = await buildComponentCache([outerFrame as unknown as SceneNode]);

      expect(cache.components.has('nestedbutton')).toBe(true);
    });

    it('handles empty scope', async () => {
      const cache = await buildComponentCache([]);

      expect(cache.components.size).toBe(0);
      expect(cache.componentSets.size).toBe(0);
    });
  });

  describe('findComponentByName', () => {
    it('finds component by exact name', async () => {
      const button = createMockComponent('Button');
      const frame = createMockFrame('Frame', [button as unknown as MockInstanceNode]);
      const cache = await buildComponentCache([frame as unknown as SceneNode]);

      const found = findComponentByName('Button', cache);

      expect(found).toBe(button);
    });

    it('finds component case-insensitively', async () => {
      const button = createMockComponent('Button');
      const frame = createMockFrame('Frame', [button as unknown as MockInstanceNode]);
      const cache = await buildComponentCache([frame as unknown as SceneNode]);

      expect(findComponentByName('button', cache)).toBe(button);
      expect(findComponentByName('BUTTON', cache)).toBe(button);
      expect(findComponentByName('BuTtOn', cache)).toBe(button);
    });

    it('returns undefined for unknown component', async () => {
      const cache = await buildComponentCache([]);

      expect(findComponentByName('Unknown', cache)).toBeUndefined();
    });
  });

  describe('findVariantComponent', () => {
    it('finds variant by properties', async () => {
      const variant = createMockComponent('Size=Large, Color=Primary');
      const componentSet = createMockComponentSet('Button', [variant]);
      const frame = createMockFrame('Frame', [componentSet as unknown as MockInstanceNode]);
      const cache = await buildComponentCache([frame as unknown as SceneNode]);

      const props = new Map([
        ['size', 'Large'],
        ['color', 'Primary'],
      ]);
      const found = findVariantComponent(props, cache);

      expect(found).toBe(variant);
    });

    it('finds variant with subset of properties', async () => {
      const variant = createMockComponent('Size=Large, Color=Primary');
      const componentSet = createMockComponentSet('Button', [variant]);
      const frame = createMockFrame('Frame', [componentSet as unknown as MockInstanceNode]);
      const cache = await buildComponentCache([frame as unknown as SceneNode]);

      const props = new Map([['size', 'Large']]);
      const found = findVariantComponent(props, cache);

      expect(found).toBe(variant);
    });

    it('returns undefined for no match', async () => {
      const variant = createMockComponent('Size=Small');
      const componentSet = createMockComponentSet('Button', [variant]);
      const frame = createMockFrame('Frame', [componentSet as unknown as MockInstanceNode]);
      const cache = await buildComponentCache([frame as unknown as SceneNode]);

      const props = new Map([['size', 'Large']]);
      const found = findVariantComponent(props, cache);

      expect(found).toBeUndefined();
    });
  });

  // ============================================================================
  // Component Swapping Tests
  // ============================================================================

  describe('canSwapComponent', () => {
    it('returns true for instance nodes', () => {
      const instance = createMockInstance('#Switch');
      expect(canSwapComponent(instance as unknown as SceneNode)).toBe(true);
    });

    it('returns false for other node types', () => {
      const frame = createMockFrame('Frame');
      const text = createMockText('Text');
      const component = createMockComponent('Component');

      expect(canSwapComponent(frame as unknown as SceneNode)).toBe(false);
      expect(canSwapComponent(text as unknown as SceneNode)).toBe(false);
      expect(canSwapComponent(component as unknown as SceneNode)).toBe(false);
    });
  });

  describe('swapComponent', () => {
    it('swaps to component by name', async () => {
      const buttonA = createMockComponent('ButtonA');
      const buttonB = createMockComponent('ButtonB');
      const instance = createMockInstance('#Switch', buttonA);
      const frame = createMockFrame('Frame', [
        buttonA as unknown as MockInstanceNode,
        buttonB as unknown as MockInstanceNode,
        instance,
      ]);
      const cache = await buildComponentCache([frame as unknown as SceneNode]);

      const result = await swapComponent(instance as unknown as SceneNode, 'ButtonB', cache);

      expect(result.success).toBe(true);
      expect(result.componentChanged).toBe(true);
      expect(instance.mainComponent).toBe(buttonB);
    });

    it('swaps using variant syntax', async () => {
      const small = createMockComponent('Size=Small');
      const large = createMockComponent('Size=Large');
      const componentSet = createMockComponentSet('Button', [small, large]);
      const instance = createMockInstance('#Switch', small);
      const frame = createMockFrame('Frame', [
        componentSet as unknown as MockInstanceNode,
        instance,
      ]);
      const cache = await buildComponentCache([frame as unknown as SceneNode]);

      const result = await swapComponent(instance as unknown as SceneNode, 'Size=Large', cache);

      expect(result.success).toBe(true);
      expect(result.componentChanged).toBe(true);
      expect(instance.mainComponent).toBe(large);
    });

    it('does not change if already using target component', async () => {
      const button = createMockComponent('Button');
      const instance = createMockInstance('#Switch', button);
      const frame = createMockFrame('Frame', [
        button as unknown as MockInstanceNode,
        instance,
      ]);
      const cache = await buildComponentCache([frame as unknown as SceneNode]);

      const result = await swapComponent(instance as unknown as SceneNode, 'Button', cache);

      expect(result.success).toBe(true);
      expect(result.componentChanged).toBe(false);
    });

    it('fails for non-instance nodes', async () => {
      const frame = createMockFrame('#Switch');
      const cache = await buildComponentCache([]);

      const result = await swapComponent(frame as unknown as SceneNode, 'Button', cache);

      expect(result.success).toBe(false);
      expect(result.error?.error).toContain('Only INSTANCE nodes');
    });

    it('fails for unknown component', async () => {
      const button = createMockComponent('Button');
      const instance = createMockInstance('#Switch', button);
      const frame = createMockFrame('Frame', [instance]);
      const cache = await buildComponentCache([frame as unknown as SceneNode]);

      const result = await swapComponent(instance as unknown as SceneNode, 'Unknown', cache);

      expect(result.success).toBe(false);
      expect(result.error?.error).toContain('Component not found');
    });

    it('fails for empty component name', async () => {
      const button = createMockComponent('Button');
      const instance = createMockInstance('#Switch', button);
      const cache = await buildComponentCache([]);

      const result = await swapComponent(instance as unknown as SceneNode, '', cache);

      expect(result.success).toBe(false);
      expect(result.error?.error).toContain('empty');
    });

    it('fails for unknown variant', async () => {
      const small = createMockComponent('Size=Small');
      const componentSet = createMockComponentSet('Button', [small]);
      const instance = createMockInstance('#Switch', small);
      const frame = createMockFrame('Frame', [
        componentSet as unknown as MockInstanceNode,
        instance,
      ]);
      const cache = await buildComponentCache([frame as unknown as SceneNode]);

      const result = await swapComponent(instance as unknown as SceneNode, 'Size=Large', cache);

      expect(result.success).toBe(false);
      expect(result.error?.error).toContain('Variant not found');
    });
  });

  // ============================================================================
  // Batch Processing Tests
  // ============================================================================

  describe('batchSwapComponents', () => {
    it('swaps multiple instances', async () => {
      const buttonA = createMockComponent('ButtonA');
      const buttonB = createMockComponent('ButtonB');
      const instance1 = createMockInstance('#Switch1', buttonA);
      const instance2 = createMockInstance('#Switch2', buttonA);
      const frame = createMockFrame('Frame', [
        buttonA as unknown as MockInstanceNode,
        buttonB as unknown as MockInstanceNode,
        instance1,
        instance2,
      ]);
      const cache = await buildComponentCache([frame as unknown as SceneNode]);

      const entries = [
        { node: instance1 as unknown as SceneNode, componentName: 'ButtonB' },
        { node: instance2 as unknown as SceneNode, componentName: 'ButtonB' },
      ];
      const result = await batchSwapComponents(entries, cache);

      expect(result.totalProcessed).toBe(2);
      expect(result.successCount).toBe(2);
      expect(result.changedCount).toBe(2);
      expect(result.failureCount).toBe(0);
    });

    it('continues after individual failures', async () => {
      const button = createMockComponent('Button');
      const instance = createMockInstance('#Switch', button);
      const frame = createMockFrame('Frame', [
        button as unknown as MockInstanceNode,
        instance,
      ]);
      const cache = await buildComponentCache([frame as unknown as SceneNode]);

      const entries = [
        { node: instance as unknown as SceneNode, componentName: 'Button' },
        { node: frame as unknown as SceneNode, componentName: 'Button' }, // Will fail
      ];
      const result = await batchSwapComponents(entries, cache);

      expect(result.totalProcessed).toBe(2);
      expect(result.successCount).toBe(1);
      expect(result.failureCount).toBe(1);
      expect(result.errors).toHaveLength(1);
    });

    it('handles empty batch', async () => {
      const cache = { components: new Map(), componentSets: new Map() };
      const result = await batchSwapComponents([], cache);

      expect(result.totalProcessed).toBe(0);
      expect(result.successCount).toBe(0);
    });
  });

  // ============================================================================
  // Utility Tests
  // ============================================================================

  describe('getCurrentComponentName', () => {
    it('returns main component name', async () => {
      const button = createMockComponent('Button');
      const instance = createMockInstance('#Switch', button);

      expect(await getCurrentComponentName(instance as unknown as InstanceNode)).toBe('Button');
    });

    it('returns undefined for no main component', async () => {
      const instance = createMockInstance('#Switch', null);

      expect(await getCurrentComponentName(instance as unknown as InstanceNode)).toBeUndefined();
    });
  });

  describe('componentNamesMatch', () => {
    it('matches case-insensitively', () => {
      expect(componentNamesMatch('Button', 'button')).toBe(true);
      expect(componentNamesMatch('BUTTON', 'button')).toBe(true);
    });

    it('does not match different names', () => {
      expect(componentNamesMatch('Button', 'Icon')).toBe(false);
    });
  });

  describe('getComponentCacheStats', () => {
    it('returns correct counts', async () => {
      const button = createMockComponent('Button');
      const variant = createMockComponent('Size=Large');
      const componentSet = createMockComponentSet('Icon', [variant]);
      const frame = createMockFrame('Frame', [
        button as unknown as MockInstanceNode,
        componentSet as unknown as MockInstanceNode,
      ]);
      const cache = await buildComponentCache([frame as unknown as SceneNode]);

      const stats = getComponentCacheStats(cache);

      expect(stats.componentCount).toBe(2); // Button + Size=Large variant
      expect(stats.componentSetCount).toBe(1); // Icon
    });
  });
});
