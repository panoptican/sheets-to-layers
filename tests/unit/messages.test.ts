/**
 * Tests for message type definitions and utilities.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isUIMessage,
  isPluginMessage,
  sendToUI,
  sendToPlugin,
  type UIMessage,
  type PluginMessage,
  type FetchMessage,
  type SyncMessage,
  type InitMessage,
  type ProgressMessage,
  type ErrorMessage,
} from '../../src/messages';

describe('messages', () => {
  describe('isUIMessage', () => {
    it('returns true for valid UI messages', () => {
      const fetchMessage: FetchMessage = {
        type: 'FETCH',
        payload: { url: 'https://example.com' },
      };
      expect(isUIMessage(fetchMessage)).toBe(true);

      const syncMessage: SyncMessage = {
        type: 'SYNC',
        payload: { scope: 'page' },
      };
      expect(isUIMessage(syncMessage)).toBe(true);

      const uiReadyMessage = { type: 'UI_READY' };
      expect(isUIMessage(uiReadyMessage)).toBe(true);
    });

    it('returns true for FETCH_AND_SYNC message', () => {
      const message = {
        type: 'FETCH_AND_SYNC',
        payload: { url: 'https://example.com', scope: 'document' },
      };
      expect(isUIMessage(message)).toBe(true);
    });

    it('returns true for CANCEL_SYNC message', () => {
      const message = {
        type: 'CANCEL_SYNC',
      };
      expect(isUIMessage(message)).toBe(true);
    });

    it('returns true for RENAME_SELECTION message', () => {
      const message = {
        type: 'RENAME_SELECTION',
        payload: { nameSuffix: '#Title' },
      };
      expect(isUIMessage(message)).toBe(true);
    });

    it('returns true for SHEET_DATA message', () => {
      const message = {
        type: 'SHEET_DATA',
        payload: {
          data: {
            worksheets: [],
            activeWorksheet: 'Sheet1',
          },
        },
      };
      expect(isUIMessage(message)).toBe(true);
    });

    it('returns true for IMAGE_DATA message', () => {
      const message = {
        type: 'IMAGE_DATA',
        payload: {
          nodeId: '123:456',
          url: 'https://example.com/image.png',
          data: new Uint8Array([1, 2, 3]),
        },
      };
      expect(isUIMessage(message)).toBe(true);
    });

    it('returns true for FETCH_ERROR message', () => {
      const message = {
        type: 'FETCH_ERROR',
        payload: { error: 'Network error' },
      };
      expect(isUIMessage(message)).toBe(true);
    });

    it('returns false for null', () => {
      expect(isUIMessage(null)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(isUIMessage(undefined)).toBe(false);
    });

    it('returns false for primitive values', () => {
      expect(isUIMessage('string')).toBe(false);
      expect(isUIMessage(123)).toBe(false);
      expect(isUIMessage(true)).toBe(false);
    });

    it('returns false for objects without type property', () => {
      expect(isUIMessage({})).toBe(false);
      expect(isUIMessage({ payload: {} })).toBe(false);
    });

    it('returns false for objects with non-string type', () => {
      expect(isUIMessage({ type: 123 })).toBe(false);
      expect(isUIMessage({ type: null })).toBe(false);
      expect(isUIMessage({ type: {} })).toBe(false);
    });

    it('returns false for arrays', () => {
      expect(isUIMessage([])).toBe(false);
      expect(isUIMessage([{ type: 'FETCH' }])).toBe(false);
    });
  });

  describe('isPluginMessage', () => {
    it('returns true for valid plugin messages', () => {
      const initMessage: InitMessage = {
        type: 'INIT',
        payload: { hasSelection: true, lastUrl: 'https://example.com' },
      };
      expect(isPluginMessage(initMessage)).toBe(true);

      const progressMessage: ProgressMessage = {
        type: 'PROGRESS',
        payload: { message: 'Processing...', progress: 50 },
      };
      expect(isPluginMessage(progressMessage)).toBe(true);

      const errorMessage: ErrorMessage = {
        type: 'ERROR',
        payload: { message: 'Something went wrong', recoverable: true },
      };
      expect(isPluginMessage(errorMessage)).toBe(true);
    });

    it('returns true for SELECTION_CHANGED message', () => {
      const message = {
        type: 'SELECTION_CHANGED',
        payload: { hasSelection: false },
      };
      expect(isPluginMessage(message)).toBe(true);
    });

    it('returns true for FETCH_SUCCESS message', () => {
      const message = {
        type: 'FETCH_SUCCESS',
        payload: {
          sheetData: {
            worksheets: [],
            activeWorksheet: 'Sheet1',
          },
        },
      };
      expect(isPluginMessage(message)).toBe(true);
    });

    it('returns true for SYNC_COMPLETE message', () => {
      const message = {
        type: 'SYNC_COMPLETE',
        payload: {
          success: true,
          layersProcessed: 10,
          layersUpdated: 8,
          errors: [],
          warnings: [],
        },
      };
      expect(isPluginMessage(message)).toBe(true);
    });

    it('returns true for RESYNC_MODE message', () => {
      const message = {
        type: 'RESYNC_MODE',
        payload: { url: 'https://example.com' },
      };
      expect(isPluginMessage(message)).toBe(true);
    });

    it('returns true for REQUEST_IMAGE_FETCH message', () => {
      const message = {
        type: 'REQUEST_IMAGE_FETCH',
        payload: { url: 'https://example.com/image.png', nodeId: '123:456' },
      };
      expect(isPluginMessage(message)).toBe(true);
    });

    it('returns true for REQUEST_SHEET_FETCH message', () => {
      const message = {
        type: 'REQUEST_SHEET_FETCH',
        payload: { url: 'https://docs.google.com/spreadsheets/d/abc123/edit' },
      };
      expect(isPluginMessage(message)).toBe(true);
    });

    it('returns false for null', () => {
      expect(isPluginMessage(null)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(isPluginMessage(undefined)).toBe(false);
    });

    it('returns false for primitive values', () => {
      expect(isPluginMessage('string')).toBe(false);
      expect(isPluginMessage(123)).toBe(false);
      expect(isPluginMessage(true)).toBe(false);
    });

    it('returns false for objects without type property', () => {
      expect(isPluginMessage({})).toBe(false);
      expect(isPluginMessage({ payload: {} })).toBe(false);
    });

    it('returns false for objects with non-string type', () => {
      expect(isPluginMessage({ type: 123 })).toBe(false);
      expect(isPluginMessage({ type: null })).toBe(false);
    });
  });

  describe('sendToUI', () => {
    let mockFigmaUI: { postMessage: ReturnType<typeof vi.fn> };

    beforeEach(() => {
      mockFigmaUI = { postMessage: vi.fn() };
      (global as Record<string, unknown>).figma = { ui: mockFigmaUI };
    });

    afterEach(() => {
      delete (global as Record<string, unknown>).figma;
    });

    it('calls figma.ui.postMessage with the message', () => {
      const message: PluginMessage = {
        type: 'INIT',
        payload: { hasSelection: true },
      };

      sendToUI(message);

      expect(mockFigmaUI.postMessage).toHaveBeenCalledWith(message);
      expect(mockFigmaUI.postMessage).toHaveBeenCalledTimes(1);
    });

    it('sends progress messages correctly', () => {
      const message: ProgressMessage = {
        type: 'PROGRESS',
        payload: { message: 'Loading...', progress: 75 },
      };

      sendToUI(message);

      expect(mockFigmaUI.postMessage).toHaveBeenCalledWith(message);
    });

    it('sends error messages correctly', () => {
      const message: ErrorMessage = {
        type: 'ERROR',
        payload: { message: 'Failed to sync', recoverable: false },
      };

      sendToUI(message);

      expect(mockFigmaUI.postMessage).toHaveBeenCalledWith(message);
    });
  });

  describe('sendToPlugin', () => {
    let mockParent: { postMessage: ReturnType<typeof vi.fn> };

    beforeEach(() => {
      mockParent = { postMessage: vi.fn() };
      (global as Record<string, unknown>).parent = mockParent;
    });

    afterEach(() => {
      delete (global as Record<string, unknown>).parent;
    });

    it('calls parent.postMessage with wrapped message', () => {
      const message: UIMessage = {
        type: 'FETCH',
        payload: { url: 'https://example.com' },
      };

      sendToPlugin(message);

      expect(mockParent.postMessage).toHaveBeenCalledWith(
        { pluginMessage: message },
        '*'
      );
      expect(mockParent.postMessage).toHaveBeenCalledTimes(1);
    });

    it('sends sync messages correctly', () => {
      const message: SyncMessage = {
        type: 'SYNC',
        payload: { scope: 'selection' },
      };

      sendToPlugin(message);

      expect(mockParent.postMessage).toHaveBeenCalledWith(
        { pluginMessage: message },
        '*'
      );
    });

    it('sends UI_READY message correctly', () => {
      const message: UIMessage = { type: 'UI_READY' };

      sendToPlugin(message);

      expect(mockParent.postMessage).toHaveBeenCalledWith(
        { pluginMessage: message },
        '*'
      );
    });
  });
});
