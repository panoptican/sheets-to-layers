import { describe, expect, it } from 'vitest';
import {
  createMockDocument,
  createMockFrame,
  createMockFigma,
  createMockPage,
  createMockText,
  MOCK_MIXED_SYMBOL,
} from '../mocks/figma';

describe('shared Figma mock boundary', () => {
  it('models removal and asynchronous lookup of stale nodes', async () => {
    const text = createMockText('#Title');
    const frame = createMockFrame('Row', [text]);
    const page = createMockPage('Page 1', [frame]);
    const figma = createMockFigma(createMockDocument([page]), page);

    expect(await figma.getNodeByIdAsync(text.id)).toBe(text);
    frame.remove();

    expect(frame.removed).toBe(true);
    expect(text.removed).toBe(true);
    expect(text.parent).toBeNull();
    expect(await figma.getNodeByIdAsync(text.id)).toBeNull();
  });

  it('gives clones fresh IDs and correctly reconnects cloned parents', () => {
    const text = createMockText('#Title');
    const frame = createMockFrame('Row', [text]);
    const clone = frame.clone();
    const clonedText = clone.children[0];

    expect(clone.id).not.toBe(frame.id);
    expect(clonedText.id).not.toBe(text.id);
    expect(clonedText.parent).toBe(clone);
    expect(clone.parent).toBeNull();
  });

  it('reports mixed fonts for ranges that cross character boundaries', () => {
    const regular = { family: 'Inter', style: 'Regular' };
    const bold = { family: 'Inter', style: 'Bold' };
    const text = createMockText('Mixed', 'AB', MOCK_MIXED_SYMBOL, [regular, bold]);

    expect(text.getRangeFontName(0, 1)).toEqual(regular);
    expect(text.getRangeFontName(1, 2)).toEqual(bold);
    expect(text.getRangeFontName(0, 2)).toBe(MOCK_MIXED_SYMBOL);
  });
});
