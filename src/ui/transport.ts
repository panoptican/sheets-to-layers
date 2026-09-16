import { sendToPlugin as send } from '../messages';
import { parseGoogleSheetsUrl } from '../utils/url';
import { createSheetFetcher } from '../core/fetcher-factory';
import {
  MAX_IMAGE_RESPONSE_BYTES,
  readResponseBytesBounded,
  runImageRequest,
  withRequestDeadline,
} from '../core/transport';
interface NetworkRun {
  id: string;
  controller: AbortController;
}
const imageRequests = new Map<string, Promise<Uint8Array>>();
export function finishImageRequests(runId: string): void {
  for (const key of imageRequests.keys()) {
    if (key.startsWith(runId + ':')) imageRequests.delete(key);
  }
}
export async function fetchSheet(
  operation: NetworkRun,
  url: string,
  isCurrent: () => boolean,
): Promise<void> {
  const id = operation.id;
  const parsed = parseGoogleSheetsUrl(url);
  if (!parsed.isValid) {
    send({
      type: 'FETCH_ERROR',
      runId: id,
      payload: { error: parsed.errorMessage || 'Invalid Google Sheets URL' },
    });
    return;
  }
  try {
    const result = await createSheetFetcher().fetchSheetData(
      parsed.spreadsheetId,
      parsed.gid,
      { signal: operation.controller.signal, refresh: true },
    );
    if (!isCurrent()) return;
    if (!result.success || !result.data) {
      const error =
        typeof result.error === 'string' ? result.error : result.error?.message;
      send({
        type: 'FETCH_ERROR',
        runId: id,
        payload: { error: error || 'Failed to fetch sheet data' },
      });
      return;
    }
    send({
      type: 'SHEET_DATA',
      runId: id,
      payload: { data: result.data, fetchedAt: Date.now() },
    });
  } catch (error) {
    if (isCurrent())
      send({
        type: 'FETCH_ERROR',
        runId: id,
        payload: {
          error: operation.controller.signal.aborted
            ? 'Fetch cancelled.'
            : error instanceof Error
              ? error.message
              : 'Failed to fetch sheet data',
        },
      });
  }
}
async function bytes(url: string, signal: AbortSignal): Promise<Uint8Array> {
  const response = await fetch(url, { signal, credentials: 'omit' });
  if (!response.ok)
    throw new Error(`Image request failed (${response.status}).`);
  if (
    !(response.headers.get('content-type') || '')
      .toLowerCase()
      .startsWith('image/')
  )
    throw new Error('Image URL did not return an image.');
  return await readResponseBytesBounded(
    response,
    MAX_IMAGE_RESPONSE_BYTES,
    signal,
  );
}
export async function fetchImage(
  operation: NetworkRun,
  identity: { requestId: string; nodeId: string; url: string },
  isCurrent: () => boolean,
): Promise<void> {
  const id = operation.id;
  try {
    const key = `${id}:${identity.url}`;
    let request = imageRequests.get(key);
    if (!request) {
      const fetcher = createSheetFetcher();
      // Worker image fetching already acquires the shared image/upstream
      // limit. Wrapping it here would queue the same request twice and can
      // deadlock once the image limit is full.
      request = fetcher.fetchImage
        ? fetcher.fetchImage(identity.url, {
            signal: operation.controller.signal,
          })
        : runImageRequest(
            () =>
              withRequestDeadline(
                (deadlineSignal) => bytes(identity.url, deadlineSignal),
                { signal: operation.controller.signal },
              ),
            operation.controller.signal,
          );
      imageRequests.set(key, request);
      void request.then(
        () => imageRequests.delete(key),
        () => imageRequests.delete(key),
      );
    }
    const data = await request;
    if (isCurrent())
      send({ type: 'IMAGE_DATA', runId: id, payload: { ...identity, data } });
  } catch (error) {
    if (isCurrent())
      send({
        type: 'IMAGE_FETCH_ERROR',
        runId: id,
        payload: {
          ...identity,
          error:
            error instanceof Error ? error.message : 'Failed to load image.',
        },
      });
  }
}
