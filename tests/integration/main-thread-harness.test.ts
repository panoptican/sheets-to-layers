import { describe, expect, it } from 'vitest';
import { createMainThreadFixture } from './main-thread-harness';

describe('main-thread integration harness', () => {
  it('runs the real entrypoint through the Figma message boundary', async () => {
    const fixture = await createMainThreadFixture();

    await fixture.sendUiMessage({ type: 'UI_READY' });

    expect(fixture.messages).toContainEqual({
      type: 'INIT',
      payload: { hasSelection: false },
    });

    fixture.messages.length = 0;
    const url = 'https://docs.google.com/spreadsheets/d/integration-test/edit';
    await fixture.sendUiMessage({ type: 'FETCH', payload: { url } });

    expect(fixture.messages).toContainEqual({
      type: 'REQUEST_SHEET_FETCH',
      payload: { url },
    });
  });

  it('keeps storage and host calls observable through the fixture', async () => {
    const fixture = await createMainThreadFixture();
    fixture.storage.set('lastUrl', 'https://docs.google.com/spreadsheets/d/saved/edit');

    await fixture.sendUiMessage({ type: 'UI_READY' });

    expect(fixture.messages).toContainEqual({
      type: 'INIT',
      payload: {
        hasSelection: false,
        lastUrl: 'https://docs.google.com/spreadsheets/d/saved/edit',
      },
    });
  });
});
