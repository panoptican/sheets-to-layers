import { afterEach, describe, expect, it } from 'vitest';
import {
  launchPluginBrowser,
  readPluginMessages,
  sendPluginMessage,
  type PluginBrowser,
} from './harness';
import {
  chooseDropdown,
  waitForSettings,
  worksheetFixture,
  sheetSnapshot,
  enterPreview,
} from './fixtures';

describe('built plugin UI settings', () => {
  let fixture: PluginBrowser | null = null;
  afterEach(async () => {
    await fixture?.browser.close();
    fixture = null;
  });
  it('keeps the sync default separate from the worksheet being browsed and reorients raw preview data locally', async () => {
    fixture = await launchPluginBrowser();
    const { page } = fixture;
    await enterPreview(
      page,
      sheetSnapshot({
        id: 'preferences-snapshot',
        spreadsheetId: 'preferences',
        preferences: {
          orientations: {},
          blankText: 'clear-and-hide',
          defaultWorksheet: 'Products',
        },
        data: {
          activeWorksheet: 'Products',
          worksheets: [
            worksheetFixture({
              name: 'Products',
              rows: { Title: ['A'] },
              rawData: [['Title'], ['A']],
            }),
            worksheetFixture({
              name: 'Archive',
              rows: { Title: ['Old'] },
              rawData: [['Title'], ['Old']],
            }),
            worksheetFixture({
              name: 'Matrix',
              labels: ['Name', 'Ada'],
              rows: { Name: ['Ada'], Ada: ['Grace'] },
              rawData: [
                ['Name', 'Ada'],
                ['Grace', 'Hopper'],
              ],
            }),
          ],
        },
      }),
    );
    await page.getByRole('tab', { name: 'Archive' }).click();
    expect(
      await page.getByRole('button', { name: 'Back' }).locator('svg').count(),
    ).toBe(1);
    expect(await page.locator('#default-worksheet').count()).toBe(0);
    await page.locator('#preview-settings-btn').click();
    await waitForSettings(page);
    expect(
      await page.getByRole('dialog', { name: 'Data settings' }).isVisible(),
    ).toBe(true);
    expect(await page.locator('#preview-settings-close-btn svg').count()).toBe(
      1,
    );
    const dropdowns = page.locator(
      '#default-worksheet, #orientation-select, #blank-text-policy',
    );
    expect(await dropdowns.count()).toBe(3);
    expect(
      await dropdowns.evaluateAll((nodes) =>
        nodes.every(
          (node) =>
            node.tagName === 'DIV' && node.getAttribute('tabindex') === '0',
        ),
      ),
    ).toBe(true);
    expect(await dropdowns.locator('svg').count()).toBe(3);
    expect(await page.locator('#worker-url').count()).toBe(0);
    expect(await page.locator('#allow-third-party-fallback').count()).toBe(0);
    expect(await page.locator('#default-worksheet').textContent()).toBe(
      'Products',
    );
    await chooseDropdown(page, 'default-worksheet', 'Archive');
    await page.locator('#preview-settings-cancel-btn').click();
    await page.locator('#preview-settings-btn').click();
    await waitForSettings(page);
    expect(await page.locator('#default-worksheet').textContent()).toBe(
      'Products',
    );
    await chooseDropdown(page, 'default-worksheet', 'Archive');
    await page.locator('#preview-settings-save-btn').click();
    await page.getByRole('tab', { name: 'Matrix' }).click();
    await page.locator('#preview-settings-btn').click();
    await waitForSettings(page);
    await chooseDropdown(page, 'orientation-select', 'rows');
    await page.locator('#preview-settings-save-btn').click();
    expect(await page.locator('.clickable-header').first().textContent()).toBe(
      'Name',
    );
    expect(await page.locator('.clickable-header').nth(1).textContent()).toBe(
      'Grace',
    );
    expect(
      (await readPluginMessages(page)).filter(
        (message) =>
          (message as { pluginMessage?: { type?: string } }).pluginMessage
            ?.type === 'FETCH',
      ),
    ).toHaveLength(1);
  });

  it('dismisses data settings without applying changes and restores focus', async () => {
    fixture = await launchPluginBrowser();
    const { page } = fixture;
    await enterPreview(
      page,
      sheetSnapshot({
        id: 'modal-settings-snapshot',
        spreadsheetId: 'modal-settings',
        preferences: {
          orientations: {},
          blankText: 'clear-and-hide',
          defaultWorksheet: 'Sheet1',
        },
        data: {
          activeWorksheet: 'Sheet1',
          worksheets: [
            worksheetFixture({
              name: 'Sheet1',
              rows: { Title: ['A'] },
              rawData: [['Title'], ['A']],
            }),
            worksheetFixture({
              name: 'Archive',
              rows: { Title: ['Old'] },
              rawData: [['Title'], ['Old']],
            }),
          ],
        },
      }),
    );

    expect(await page.locator('.table-pagination').count()).toBe(0);
    expect(await page.locator('#bind-worksheet-btn').count()).toBe(0);
    await sendPluginMessage(page, 'SELECTION_CHANGED', {
      hasSelection: true,
    });
    expect(await page.locator('#bind-worksheet-btn').count()).toBe(0);
    const archiveTab = page.getByRole('tab', { name: 'Archive' });
    await archiveTab.click();
    expect(await page.locator('#bind-worksheet-btn').textContent()).toBe(
      'Use Archive for selected layers',
    );
    const tabLayout = await archiveTab.evaluate((tab) => {
      const strip = tab.parentElement!;
      const tabRect = tab.getBoundingClientRect();
      const stripRect = strip.getBoundingClientRect();
      return {
        overflowY: getComputedStyle(strip).overflowY,
        scrollHeight: strip.scrollHeight,
        clientHeight: strip.clientHeight,
        tabTop: tabRect.top,
        tabBottom: tabRect.bottom,
        stripTop: stripRect.top,
        stripBottom: stripRect.bottom,
      };
    });
    expect(tabLayout.overflowY).toBe('hidden');
    expect(tabLayout.scrollHeight).toBe(tabLayout.clientHeight);
    expect(tabLayout.tabTop).toBeGreaterThanOrEqual(tabLayout.stripTop);
    expect(tabLayout.tabBottom).toBeLessThanOrEqual(tabLayout.stripBottom);

    await page.locator('#preview-settings-btn').click();
    await waitForSettings(page);
    expect(
      await page
        .locator('#default-worksheet')
        .evaluate((node) => node === document.activeElement),
    ).toBe(true);
    await chooseDropdown(page, 'blank-text-policy', 'leave-unchanged');
    await page.keyboard.press('Escape');
    expect(await page.getByRole('dialog').count()).toBe(0);
    expect(
      await page
        .locator('#preview-settings-btn')
        .evaluate((node) => node === document.activeElement),
    ).toBe(true);

    await page.locator('#preview-settings-btn').click();
    await waitForSettings(page);
    expect(await page.locator('#blank-text-policy').textContent()).toBe(
      'Clear and hide blank text',
    );
    await page.locator('#preview-settings-dialog + div').click({
      position: { x: 2, y: 2 },
    });
    expect(await page.getByRole('dialog').count()).toBe(0);

    await page.locator('#preview-settings-btn').click();
    await waitForSettings(page);
    await chooseDropdown(page, 'default-worksheet', 'Archive');
    await page.locator('#preview-settings-save-btn').click();
    expect(await page.locator('#bind-worksheet-btn').count()).toBe(0);
  });

  it('keeps data settings contextual to a fetched sheet', async () => {
    fixture = await launchPluginBrowser();
    const { page } = fixture;
    await sendPluginMessage(page, 'INIT', { hasSelection: false });
    expect(await page.locator('#settings-btn').count()).toBe(0);
    expect(await page.locator('#preview-settings-btn').count()).toBe(0);
    expect(await page.locator('#worker-url').count()).toBe(0);
    expect(await page.locator('#allow-third-party-fallback').count()).toBe(0);
  });
});
