import type { Page } from 'playwright';
import type {
  OperationResult,
  PreflightSummary,
  SheetSnapshot,
  Worksheet,
} from '../../src/core/types';
import { isUIMessage, type UIMessage } from '../../src/messages';
import { readPluginMessages, sendPluginMessage } from './harness';

export function worksheetFixture(
  overrides: Partial<Worksheet> = {},
): Worksheet {
  const rows = overrides.rows ?? { Title: ['A'] };
  return {
    name: 'Sheet1',
    labels: Object.keys(rows),
    rows,
    orientation: 'columns',
    ...overrides,
  };
}

export function sheetSnapshot(
  overrides: Partial<SheetSnapshot> = {},
): SheetSnapshot {
  const spreadsheetId = overrides.spreadsheetId ?? 'source';
  return {
    id: 'snapshot',
    spreadsheetId,
    sourceUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
    fetchedAt: Date.now(),
    preferences: { orientations: {}, blankText: 'clear-and-hide' },
    data: { activeWorksheet: 'Sheet1', worksheets: [worksheetFixture()] },
    ...overrides,
  };
}

export function preflightSummary(
  overrides: Partial<PreflightSummary> = {},
): PreflightSummary {
  return {
    preflightId: 'preflight',
    snapshotId: 'snapshot',
    sourceUrl: sheetSnapshot().sourceUrl,
    scope: 'page',
    rootIds: [],
    defaultWorksheet: 'Sheet1',
    preferences: { orientations: {}, blankText: 'clear-and-hide' },
    totalBindings: 1,
    matchedBindings: 1,
    requiresConfirmation: true,
    repeats: [],
    issues: [],
    ...overrides,
  };
}

export function operationResult(
  overrides: Partial<OperationResult> = {},
): OperationResult {
  return {
    status: 'success',
    success: true,
    snapshotId: 'snapshot',
    counts: { changed: 0, unchanged: 0, skipped: 0, failed: 0 },
    layersProcessed: 0,
    layersUpdated: 0,
    warnings: [],
    errors: [],
    outcomes: [],
    ...overrides,
  };
}

export async function lastMessage<T extends UIMessage['type']>(
  page: Page,
  type: T,
): Promise<{ pluginMessage: Extract<UIMessage, { type: T }> }> {
  const messages = await readPluginMessages(page);
  for (const envelope of messages.reverse()) {
    const message = (envelope as { pluginMessage?: unknown }).pluginMessage;
    if (isUIMessage(message) && message.type === type) {
      return { pluginMessage: message as Extract<UIMessage, { type: T }> };
    }
  }
  throw new Error(`UI did not send ${type}`);
}

/** Exercise the real input/fetch controls, then supply the host-owned snapshot. */
export async function enterPreview(
  page: Page,
  snapshot = sheetSnapshot(),
): Promise<void> {
  await page.locator('#sheets-url').fill(snapshot.sourceUrl);
  await page.locator('#fetch-btn').click();
  const { pluginMessage } = await lastMessage(page, 'FETCH');
  await sendPluginMessage(
    page,
    'FETCH_SUCCESS',
    { snapshot },
    { runId: pluginMessage.runId },
  );
}

export async function chooseDropdown(
  page: Page,
  dropdownId: string,
  value: string,
): Promise<void> {
  await page.locator(`#${dropdownId}`).click();
  // UI3 removes the radio menu immediately after selection.
  await page.locator(`input[type="radio"][value="${value}"]`).last().click();
}

export async function waitForSettings(page: Page): Promise<void> {
  await page.getByRole('dialog', { name: 'Data settings' }).waitFor();
}
