import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configRoots, createDocumentConfig, loadDocumentConfig, saveDocumentConfig } from '../../src/core/document-config';
import type { InterpretationPreferences, SheetSnapshot } from '../../src/core/types';
import { cleanupMockFigma, createMockDocument, createMockFigma, createMockPage,
  resetNodeIdCounter, setupMockFigma } from '../mocks/figma';

const preferences: InterpretationPreferences = { orientations: {}, blankText: 'clear-and-hide' };
const snapshot: SheetSnapshot = {
  id: 'snapshot-1', sourceUrl: 'https://docs.google.com/spreadsheets/d/source-123/edit',
  spreadsheetId: 'source-123', fetchedAt: 1, preferences,
  data: { activeWorksheet: 'Sheet1', worksheets: [] },
};

describe('document-owned sync configuration', () => {
  beforeEach(() => resetNodeIdCounter());
  afterEach(() => cleanupMockFigma());

  it('stores scope and interpretation on the document that completed the run', () => {
    const page = createMockPage('Page');
    const first = createMockFigma(createMockDocument([page]), page);
    setupMockFigma(first);
    const config = createDocumentConfig(snapshot, { scope: 'page', rootIds: [page.id], pageId: page.id },
      'Sheet1', preferences);
    saveDocumentConfig(config);
    expect(loadDocumentConfig()).toEqual(config);
    expect(config.preferences.defaultWorksheet).toBe('Sheet1');
    expect(configRoots(config)).toEqual({ scope: 'page', rootIds: [page.id], pageId: page.id });

    const otherPage = createMockPage('Other');
    setupMockFigma(createMockFigma(createMockDocument([otherPage]), otherPage));
    expect(loadDocumentConfig()).toBeNull();
  });

  it('rejects malformed or foreign source metadata without widening scope', () => {
    const page = createMockPage('Page');
    const host = createMockFigma(createMockDocument([page]), page);
    setupMockFigma(host);
    const config = createDocumentConfig(snapshot, { scope: 'page', rootIds: [page.id], pageId: page.id },
      'Sheet1', preferences);
    host.root.setPluginData('sheets-to-layers:sync-config:v1', JSON.stringify({
      ...config, spreadsheetId: 'different-source',
    }));
    expect(loadDocumentConfig()).toBeNull();
    host.root.setPluginData('sheets-to-layers:sync-config:v1', JSON.stringify({
      ...config, rootIds: [],
    }));
    expect(loadDocumentConfig()).toBeNull();
  });

  it('rejects prototype-like orientation keys in saved metadata', () => {
    const page = createMockPage('Page');
    const host = createMockFigma(createMockDocument([page]), page);
    setupMockFigma(host);
    const config = createDocumentConfig(snapshot, { scope: 'page', rootIds: [page.id], pageId: page.id },
      'Sheet1', preferences);
    host.root.setPluginData('sheets-to-layers:sync-config:v1', JSON.stringify({
      ...config, preferences: { ...preferences, orientations: JSON.parse('{"__proto__":"rows"}') },
    }));
    expect(loadDocumentConfig()).toBeNull();
  });
});
