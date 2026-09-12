import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  launchPluginBrowser, sendPluginMessage, type PluginBrowser,
} from './harness';

describe('built UI untrusted spreadsheet content', () => {
  let fixture: PluginBrowser;
  beforeAll(async () => { fixture = await launchPluginBrowser(); });
  afterAll(async () => { await fixture?.browser.close(); });

  it('round-trips quoted headers, worksheet names, and values without event attributes', async () => {
    const label = 'Name" onclick="window.previewInjected=1';
    const worksheet = 'Products" onfocus="window.previewInjected=2';
    const value = '<img src=x onerror="window.previewInjected=3"> & "quoted"';
    await sendPluginMessage(fixture.page, 'FETCH_SUCCESS', {
      sheetData: {
        activeWorksheet: worksheet,
        worksheets: [
          { name: worksheet, labels: [label], rows: { [label]: [value] }, orientation: 'columns' },
          { name: 'Other', labels: ['Name'], rows: { Name: ['Other'] }, orientation: 'columns' },
        ],
      },
    });
    const header = fixture.page.locator('.clickable-header');
    expect(await header.getAttribute('data-label')).toBe(label);
    expect(await header.getAttribute('onclick')).toBeNull();
    expect(await header.getAttribute('title')).toContain(label);
    const tab = fixture.page.locator('[role="tab"]').first();
    expect(await tab.getAttribute('data-worksheet')).toBe(worksheet);
    expect(await tab.getAttribute('onfocus')).toBeNull();
    expect(await fixture.page.locator('.value-cell').getAttribute('aria-label')).toContain('<img');
    expect(await fixture.page.locator('.preview-table img').count()).toBe(0);
    await header.click();
    await tab.focus();
    expect(await fixture.page.evaluate(() => (window as unknown as { previewInjected?: number }).previewInjected)).toBeUndefined();
  });

  it('keeps an untrusted suggested URL within its input value', async () => {
    const separate = await launchPluginBrowser();
    try {
      const url = 'https://docs.google.com/spreadsheets/d/test/edit?x=" autofocus onfocus="window.previewInjected=1';
      await sendPluginMessage(separate.page, 'INIT', { hasSelection: false, lastUrl: url });
      const input = separate.page.locator('#sheets-url');
      expect(await input.inputValue()).toBe(url);
      expect(await input.getAttribute('onfocus')).toBeNull();
      await input.focus();
      expect(await separate.page.evaluate(() => (window as unknown as { previewInjected?: number }).previewInjected)).toBeUndefined();
    } finally { await separate.browser.close(); }
  });
});
