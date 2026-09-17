import type { DocumentSyncConfig, InterpretationPreferences, SheetSnapshot, SyncScope } from './types';
import type { ScopeRoots } from './traversal';
import { isDocumentSyncConfig } from '../messages';
import { parseGoogleSheetsUrlForMain } from '../utils/url';

const CONFIG_KEY = 'sheets-to-layers:sync-config:v1';

function hasSafeOrientations(preferences: InterpretationPreferences): boolean {
  return Object.keys(preferences.orientations).every((key) =>
    key !== '__proto__' && key !== 'constructor' && key !== 'prototype');
}

/** Missing or invalid metadata is treated as untrusted, never as page-wide authority. */
export function loadDocumentConfig(): DocumentSyncConfig | null {
  const raw = figma.root.getPluginData(CONFIG_KEY);
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isDocumentSyncConfig(value)) return null;
    const parsed = parseGoogleSheetsUrlForMain(value.sourceUrl);
    if (!parsed.isValid || parsed.spreadsheetId !== value.spreadsheetId) return null;
    if (value.scope === 'page' && (typeof value.pageId !== 'string' ||
      value.rootIds.length !== 1 || value.rootIds[0] !== value.pageId)) return null;
    if (value.rootIds.length === 0) return null;
    if (!hasSafeOrientations(value.preferences)) return null;
    return value;
  } catch {
    return null;
  }
}

export function createDocumentConfig(
  snapshot: SheetSnapshot,
  roots: ScopeRoots,
  defaultWorksheet: string,
  preferences: InterpretationPreferences
): DocumentSyncConfig {
  if (roots.rootIds.length === 0) throw new Error('Choose a nonempty sync scope before saving.');
  return {
    version: 1,
    sourceUrl: snapshot.sourceUrl,
    spreadsheetId: snapshot.spreadsheetId,
    defaultWorksheet,
    scope: roots.scope,
    rootIds: [...roots.rootIds],
    ...(roots.scope === 'page' ? { pageId: roots.pageId } : {}),
    preferences: {
      orientations: { ...preferences.orientations },
      blankText: preferences.blankText,
      defaultWorksheet,
    },
    completedAt: Date.now(),
  };
}

/** Called only after a completed success/partial run, including image settlement. */
export function saveDocumentConfig(config: DocumentSyncConfig): void {
  const parsed = parseGoogleSheetsUrlForMain(config.sourceUrl);
  if (!isDocumentSyncConfig(config) || !hasSafeOrientations(config.preferences) || !parsed.isValid ||
    parsed.spreadsheetId !== config.spreadsheetId || config.rootIds.length === 0) {
    throw new Error('Incomplete document sync configuration.');
  }
  figma.root.setPluginData(CONFIG_KEY, JSON.stringify(config));
  figma.root.setRelaunchData({
    open: '',
    resync: `Last synced from: ${config.sourceUrl.slice(0, 47)}${config.sourceUrl.length > 47 ? '...' : ''}`,
  });
}

export function configRoots(config: DocumentSyncConfig): ScopeRoots {
  return {
    scope: config.scope as SyncScope,
    rootIds: [...config.rootIds],
    ...(config.pageId ? { pageId: config.pageId } : {}),
  };
}
