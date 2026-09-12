import { describe, expect, it } from 'vitest';
import {
  jsonResponse,
  loadWorker,
  withUpstreamFetch,
  workerRequest,
} from './worker-harness';

describe('Worker integration harness', () => {
  it('executes the actual Worker with injected upstream responses', async () => {
    const worker = await loadWorker();
    const upstreamRequests: string[] = [];

    const response = await withUpstreamFetch(async (request) => {
      upstreamRequests.push(String(request));
      return jsonResponse({
        sheets: [{ properties: { title: 'Sheet 1', sheetId: 7, index: 0 } }],
      });
    }, () => worker.fetch(
      workerRequest('/?sheetId=integration-sheet'),
      { GOOGLE_API_KEY: 'test-key' }
    ));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      sheets: [{ title: 'Sheet 1', sheetId: 7, index: 0 }],
    });
    expect(upstreamRequests).toHaveLength(1);
    expect(upstreamRequests[0]).toContain('/spreadsheets/integration-sheet');
  });

  it('keeps Worker request and response boundaries deterministic', async () => {
    const worker = await loadWorker();

    const response = await withUpstreamFetch(
      async () => jsonResponse({ values: [['Title'], ['Hello']] }),
      () => worker.fetch(
        workerRequest('/?sheetId=integration-sheet&tabName=Sheet%201'),
        { GOOGLE_API_KEY: 'test-key' }
      )
    );

    expect(response.status).toBe(200);
  });
});
