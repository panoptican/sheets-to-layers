import { afterEach, describe, expect, it } from 'vitest';
import {
  clearPluginMessages,
  launchPluginBrowser,
  readPluginMessages,
  sendPluginMessage,
  type PluginBrowser,
} from './harness';
import {
  worksheetFixture,
  sheetSnapshot,
  lastMessage,
  enterPreview,
} from './fixtures';

describe('built plugin UI preview', () => {
  let fixture: PluginBrowser | null = null;
  afterEach(async () => {
    await fixture?.browser.close();
    fixture = null;
  });
  it('loads the built UI and round-trips host messages through the real DOM', async () => {
    fixture = await launchPluginBrowser();
    const { page } = fixture;

    expect(await page.locator('#plugin-title').textContent()).toBe(
      'Sheets to Layers',
    );
    expect(await readPluginMessages(page)).toContainEqual({
      pluginMessage: { type: 'UI_READY' },
    });

    await clearPluginMessages(page);
    await page
      .locator('#sheets-url')
      .fill('https://docs.google.com/spreadsheets/d/test/edit');
    await page.locator('#fetch-btn').click();
    const fetchMessage = await lastMessage(page, 'FETCH');
    await sendPluginMessage(
      page,
      'FETCH_SUCCESS',
      {
        snapshot: sheetSnapshot({
          id: 'snapshot-harness',
          spreadsheetId: 'test',
          data: {
            activeWorksheet: 'Sheet 1',
            worksheets: [
              worksheetFixture({ name: 'Sheet 1', rows: { Title: ['Hello'] } }),
            ],
          },
        }),
      },
      { runId: fetchMessage.pluginMessage.runId },
    );

    await page.locator('.preview-mode').waitFor({ state: 'visible' });
    expect((await page.locator('.clickable-header').innerText()).trim()).toBe(
      'Title',
    );
    expect(await readPluginMessages(page)).toContainEqual({
      pluginMessage: {
        type: 'RESIZE_WINDOW',
        payload: { width: 960, height: 600 },
      },
    });
  });

  it('keeps preview value cells visible above the tabs and footer at 720 by 320', async () => {
    fixture = await launchPluginBrowser();
    const { page } = fixture;
    await page.setViewportSize({ width: 720, height: 320 });
    await enterPreview(
      page,
      sheetSnapshot({
        id: 'compact-preview-snapshot',
        spreadsheetId: 'compact-preview',
        data: {
          activeWorksheet: 'Sheet1',
          worksheets: [
            worksheetFixture({
              name: 'Sheet1',
              rows: { Title: ['Visible first row', 'Visible second row'] },
            }),
          ],
        },
      }),
    );
    const secondValue = page.locator('.preview-table .value-cell').nth(1);
    await secondValue.waitFor({ state: 'visible' });
    expect(
      await secondValue.evaluate((cell) => {
        const rect = cell.getBoundingClientRect();
        return (
          rect.top >= 0 &&
          rect.bottom <= window.innerHeight &&
          document
            .elementFromPoint(
              rect.left + rect.width / 2,
              rect.top + rect.height / 2,
            )
            ?.closest('.value-cell') === cell
        );
      }),
    ).toBe(true);
  });

  it('bounds tall and wide previews within the message and render limits', async () => {
    fixture = await launchPluginBrowser();
    const { page } = fixture;
    const wideLabels = Array.from(
      { length: 40 },
      (_, index) => `Column ${index + 1}`,
    );
    const wideValues = Object.fromEntries(
      wideLabels.map((label, index) => [
        label,
        Array.from({ length: 1_000 }, (_, row) => `${index}:${row}`),
      ]),
    );
    await enterPreview(
      page,
      sheetSnapshot({
        id: 'large-snapshot',
        spreadsheetId: 'large',
        data: {
          activeWorksheet: 'Tall',
          worksheets: [
            worksheetFixture({
              name: 'Tall',
              rows: {
                Title: Array.from(
                  { length: 10_000 },
                  (_, row) => `Title ${row}`,
                ),
              },
            }),
            worksheetFixture({
              name: 'Wide',
              labels: wideLabels,
              rows: wideValues,
            }),
          ],
        },
      }),
    );
    expect(await page.locator('.preview-table tbody tr').count()).toBe(100);
    expect(
      await page.locator('.preview-table .value-cell').count(),
    ).toBeLessThanOrEqual(2000);
    expect(await page.locator('.pagination-label').textContent()).toBe(
      'Rows 1–100 of 10,000',
    );
    expect(
      await page
        .locator(
          '.table-pagination button[id$="-prev-btn"] svg, .table-pagination button[id$="-next-btn"] svg',
        )
        .count(),
    ).toBe(2);
    const stripStyles = await page.evaluate(() => {
      const pagination = getComputedStyle(
        document.querySelector<HTMLElement>('.table-pagination')!,
      );
      const body = getComputedStyle(document.body);
      const worksheetBar = getComputedStyle(
        document.querySelector<HTMLElement>('.worksheet-bar')!,
      );
      return {
        paginationBackground: pagination.backgroundColor,
        bodyBackground: body.backgroundColor,
        worksheetPadding: [
          worksheetBar.paddingTop,
          worksheetBar.paddingRight,
          worksheetBar.paddingBottom,
          worksheetBar.paddingLeft,
        ],
      };
    });
    expect(stripStyles.paginationBackground).toBe(stripStyles.bodyBackground);
    expect(new Set(stripStyles.worksheetPadding).size).toBe(1);
    await page.locator('#row-next-btn').press('Enter');
    expect(await page.locator('.index-cell').first().textContent()).toBe('101');
    expect(await page.locator('.pagination-label').textContent()).toBe(
      'Rows 101–200 of 10,000',
    );
    await page.getByRole('tab', { name: 'Wide' }).click();
    expect(
      await page.locator('.preview-table .value-cell').count(),
    ).toBeLessThanOrEqual(2000);
    expect(await page.locator('.pagination-label').allTextContents()).toEqual([
      'Rows 1–100 of 1,000',
      'Columns 1–20 of 40',
    ]);
    await page.locator('#column-next-btn').click();
    expect(await page.locator('.clickable-header').first().textContent()).toBe(
      'Column 21',
    );
    expect(await page.locator('.pagination-label').nth(1).textContent()).toBe(
      'Columns 21–40 of 40',
    );
    const firstTab = page.getByRole('tab').first();
    await firstTab.focus();
    await firstTab.press('End');
    expect(
      await page.getByRole('tab').last().getAttribute('aria-selected'),
    ).toBe('true');
  });
});
