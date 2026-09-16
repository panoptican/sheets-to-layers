import { afterEach, describe, expect, it } from 'vitest';
import { launchPluginBrowser, type PluginBrowser } from './harness';

describe('built plugin UI appearance', () => {
  let fixture: PluginBrowser | null = null;
  afterEach(async () => {
    await fixture?.browser.close();
    fixture = null;
  });
  it('renders UI3 controls with Figma theme styles and visible labels', async () => {
    fixture = await launchPluginBrowser();
    const { page } = fixture;

    const appearance = await page.evaluate(() => {
      const body = getComputedStyle(document.body);
      const container = getComputedStyle(
        document.querySelector<HTMLElement>('.plugin-container')!,
      );
      const primary = getComputedStyle(
        document.querySelector<HTMLElement>('#sync-btn')!,
      );

      return {
        bodyBackground: body.backgroundColor,
        containerBackground: container.backgroundColor,
        primaryBackground: primary.backgroundColor,
        injectedStyleCount: document.head.querySelectorAll('style[id]').length,
      };
    });

    expect(appearance.bodyBackground).toBe('rgb(255, 255, 255)');
    expect(appearance.containerBackground).not.toBe('rgb(255, 205, 41)');
    expect(appearance.primaryBackground).toBe('rgb(13, 153, 255)');
    expect(appearance.injectedStyleCount).toBeGreaterThan(1);
    await page.locator('#plugin-title').waitFor({ state: 'visible' });
    await page.getByText('Google Sheets URL', { exact: true }).waitFor();
    await page.locator('#sheets-url').waitFor({ state: 'visible' });
    await page.getByText('Sync scope', { exact: true }).waitFor();
    await page.getByText('Entire document', { exact: true }).waitFor();
    await page.getByText('Current page', { exact: true }).waitFor();
    await page.locator('#fetch-btn').waitFor({ state: 'visible' });
    await page.locator('#sync-btn').waitFor({ state: 'visible' });
    expect(await page.locator('#fetch-btn').textContent()).toContain('Fetch');
    expect(await page.locator('#sync-btn').textContent()).toContain(
      'Fetch & Sync',
    );
  });
});
