import { afterEach, describe, expect, it } from 'vitest';
import {
  clearPluginMessages,
  launchPluginBrowser,
  readPluginMessages,
  sendPluginMessage,
  type PluginBrowser,
} from './harness';

describe('built plugin UI browser harness', () => {
  let fixture: PluginBrowser | null = null;

  afterEach(async () => {
    await fixture?.browser.close();
    fixture = null;
  });

  it('loads the built UI and round-trips host messages through the real DOM', async () => {
    fixture = await launchPluginBrowser();
    const { page } = fixture;

    expect(await page.locator('#plugin-title').textContent()).toBe('Sheets to Layers');
    expect(await readPluginMessages(page)).toContainEqual({ pluginMessage: { type: 'UI_READY' } });

    await clearPluginMessages(page);
    await sendPluginMessage(page, 'FETCH_SUCCESS', {
      sheetData: {
        activeWorksheet: 'Sheet 1',
        worksheets: [{
          name: 'Sheet 1',
          labels: ['Title'],
          rows: { Title: ['Hello'] },
          orientation: 'columns',
        }],
      },
    });

    await page.locator('.preview-mode').waitFor({ state: 'visible' });
    expect((await page.locator('.clickable-header').innerText()).trim()).toBe('Title');
    expect(await readPluginMessages(page)).toContainEqual({
      pluginMessage: {
        type: 'RESIZE_WINDOW',
        payload: { width: 960, height: 600 },
      },
    });
  });
});
