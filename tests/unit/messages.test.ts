/**
 * Tests for message type definitions and utilities.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  isUIMessage,
  isPluginMessage,
  isSheetData,
  isDocumentSyncConfig,
  isInterpretationPreferences,
  sendToUI,
  sendToPlugin,
  type UIMessage,
  type PluginMessage,
  type FetchMessage,
  type SyncMessage,
  type InitMessage,
  type ProgressMessage,
  type ErrorMessage,
} from "../../src/messages";

const preferences = { orientations: {}, blankText: "clear-and-hide" as const };
const settings = {
  workerUrl: "https://worker.example",
  allowThirdPartyFallback: false,
};
const config = {
  version: 1 as const,
  sourceUrl: "https://docs.google.com/spreadsheets/d/test/edit",
  spreadsheetId: "test",
  defaultWorksheet: "Sheet1",
  scope: "page" as const,
  rootIds: ["page:1"],
  pageId: "page:1",
  preferences,
  completedAt: 1,
};
const snapshot = {
  id: "snapshot:1",
  sourceUrl: config.sourceUrl,
  spreadsheetId: "test",
  fetchedAt: 1,
  data: { worksheets: [], activeWorksheet: "Sheet1" },
  preferences,
};

describe("messages", () => {
  describe("correlated operation contracts", () => {
    it.each([
      "FETCH",
      "FETCH_AND_SYNC",
      "SYNC",
      "CANCEL_SYNC",
      "SHEET_DATA",
      "IMAGE_DATA",
      "FETCH_ERROR",
      "APPLY",
      "RETRY_FAILED",
    ])("rejects %s without a run ID", (type) => {
      expect(
        isUIMessage({
          type,
          payload: {
            url: config.sourceUrl,
            scope: "page",
            preferences,
            data: snapshot.data,
            fetchedAt: 1,
            error: "error",
            snapshotId: snapshot.id,
            preflightId: "preflight:1",
            excludedIssueIds: [],
          },
        }),
      ).toBe(false);
    });

    it("requires matching preflight and snapshot identities in Apply", () => {
      const message = {
        type: "APPLY",
        runId: "run:1",
        payload: {
          snapshotId: snapshot.id,
          preflightId: "preflight:1",
          excludedIssueIds: ["missing-label:1"],
        },
      };
      expect(isUIMessage(message)).toBe(true);
      expect(
        isUIMessage({
          ...message,
          payload: { ...message.payload, preflightId: undefined },
        }),
      ).toBe(false);
      expect(
        isUIMessage({
          ...message,
          payload: { ...message.payload, excludedIssueIds: [false] },
        }),
      ).toBe(false);
    });

    it("requires an image request identity and bounded binary payload", () => {
      const payload = {
        requestId: "request:1",
        nodeId: "node:1",
        url: "https://image.example/a.png",
        data: new Uint8Array([1]),
      };
      expect(isUIMessage({ type: "IMAGE_DATA", runId: "run:1", payload })).toBe(
        true,
      );
      expect(
        isUIMessage({
          type: "IMAGE_DATA",
          runId: "run:1",
          payload: { ...payload, requestId: undefined },
        }),
      ).toBe(false);
      expect(
        isUIMessage({
          type: "IMAGE_DATA",
          runId: "run:1",
          payload: { ...payload, data: [] },
        }),
      ).toBe(false);
      expect(
        isUIMessage({
          type: "IMAGE_DATA",
          runId: "run:1",
          payload: { ...payload, data: new Uint8Array(20 * 1024 * 1024 + 1) },
        }),
      ).toBe(false);
    });

    it("keeps deep binding identities valid while bounding operation IDs", () => {
      const payload = {
        requestId: `preflight:${"0.".repeat(180)}`,
        nodeId: "node:1",
        url: "https://image.example/a.png",
      };
      expect(
        isPluginMessage({
          type: "REQUEST_IMAGE_FETCH",
          runId: "run:1",
          payload,
        }),
      ).toBe(true);
      expect(
        isPluginMessage({
          type: "REQUEST_IMAGE_FETCH",
          runId: "r".repeat(257),
          payload,
        }),
      ).toBe(false);
      expect(
        isPluginMessage({
          type: "IMAGE_ACK",
          runId: "run:1",
          payload: { ...payload, status: "unchanged" },
        }),
      ).toBe(true);
    });

    it("rejects prototype-like preference keys at the shared boundary", () => {
      for (const key of ["__proto__", "constructor", "prototype"]) {
        const orientations = JSON.parse(`{"${key}":"columns"}`);
        expect(
          isInterpretationPreferences({ ...preferences, orientations }),
        ).toBe(false);
      }
    });

    it("validates retained raw cells and normalized data at the message boundary", () => {
      const worksheet = {
        name: "Sheet1",
        labels: ["Title"],
        rows: { Title: ["A"] },
        orientation: "columns",
        rawData: [["Title"], ["A"]],
      };
      expect(
        isSheetData({ worksheets: [worksheet], activeWorksheet: "Sheet1" }),
      ).toBe(true);
      expect(
        isSheetData({
          worksheets: [{ ...worksheet, rawData: [[{}]] }],
          activeWorksheet: "Sheet1",
        }),
      ).toBe(false);
      expect(
        isSheetData({
          worksheets: [{ ...worksheet, rows: {} }],
          activeWorksheet: "Sheet1",
        }),
      ).toBe(false);
      expect(
        isSheetData({
          worksheets: [{ ...worksheet, rows: { Title: [42] } }],
          activeWorksheet: "Sheet1",
        }),
      ).toBe(false);
    });

    it("requires a coherent stored page scope and finite completion timestamp", () => {
      expect(isDocumentSyncConfig(config)).toBe(true);
      expect(isDocumentSyncConfig({ ...config, rootIds: [] })).toBe(false);
      expect(isDocumentSyncConfig({ ...config, rootIds: ["other-page"] })).toBe(
        false,
      );
      expect(isDocumentSyncConfig({ ...config, completedAt: Infinity })).toBe(
        false,
      );
      expect(
        isDocumentSyncConfig({
          ...config,
          preferences: { ...preferences, orientations: { Sheet1: "sideways" } },
        }),
      ).toBe(false);
    });

    it("rejects per-worksheet and aggregate cell limit bypasses", () => {
      const worksheet = {
        name: "Sheet1",
        labels: ["Title"],
        rows: { Title: Array(99999).fill("A") },
        orientation: "columns",
      };
      expect(
        isSheetData({ worksheets: [worksheet], activeWorksheet: "Sheet1" }),
      ).toBe(true);
      expect(
        isSheetData({
          worksheets: [
            { ...worksheet, rows: { Title: Array(100000).fill("A") } },
          ],
          activeWorksheet: "Sheet1",
        }),
      ).toBe(false);
      expect(
        isSheetData({
          worksheets: [{ ...worksheet, rawData: [Array(100001).fill("A")] }],
          activeWorksheet: "Sheet1",
        }),
      ).toBe(false);
      expect(
        isSheetData({
          worksheets: Array(6).fill(worksheet),
          activeWorksheet: "Sheet1",
        }),
      ).toBe(false);
    });

    it("accepts structured binding actions and rejects invalid rows", () => {
      for (const action of [
        { type: "label", label: "First Name", row: 2 },
        { type: "worksheet", worksheet: "Q1 / West" },
        { type: "index", index: { type: "random" } },
      ]) {
        expect(
          isUIMessage({ type: "RENAME_SELECTION", payload: { action } }),
        ).toBe(true);
      }
      expect(
        isUIMessage({
          type: "RENAME_SELECTION",
          payload: { action: { type: "label", label: "Title", row: 0 } },
        }),
      ).toBe(false);
      expect(
        isUIMessage({
          type: "RENAME_SELECTION",
          payload: { nameSuffix: "#Title.2" },
        }),
      ).toBe(false);
    });

    it("keeps settings outside operation identities and requires explicit fallback preference", () => {
      expect(
        isUIMessage({ type: "SAVE_SETTINGS", payload: { settings } }),
      ).toBe(true);
      expect(
        isUIMessage({
          type: "SAVE_SETTINGS",
          payload: { settings: { workerUrl: settings.workerUrl } },
        }),
      ).toBe(false);
      expect(
        isPluginMessage({ type: "SETTINGS_SAVED", payload: { settings } }),
      ).toBe(true);
    });

    it("rejects malformed or uncorrelated progress and result messages", () => {
      expect(
        isPluginMessage({
          type: "PROGRESS",
          payload: { message: "Loading", progress: 1 },
        }),
      ).toBe(false);
      expect(
        isPluginMessage({
          type: "PROGRESS",
          runId: "run:1",
          payload: { message: "Loading", progress: NaN },
        }),
      ).toBe(false);
      expect(
        isPluginMessage({
          type: "SYNC_COMPLETE",
          runId: "run:1",
          payload: { status: "success" },
        }),
      ).toBe(false);
    });
  });
  describe("isUIMessage", () => {
    it("returns true for valid UI messages", () => {
      const fetchMessage: FetchMessage = {
        type: "FETCH",
        runId: "run:1",
        payload: { url: "https://example.com", preferences },
      };
      expect(isUIMessage(fetchMessage)).toBe(true);

      const syncMessage: SyncMessage = {
        type: "SYNC",
        runId: "run:1",
        payload: { scope: "page", snapshotId: "snapshot:1", preferences },
      };
      expect(isUIMessage(syncMessage)).toBe(true);

      const uiReadyMessage = { type: "UI_READY" };
      expect(isUIMessage(uiReadyMessage)).toBe(true);
    });

    it("returns true for FETCH_AND_SYNC message", () => {
      const message = {
        type: "FETCH_AND_SYNC",
        runId: "run:1",
        payload: { url: "https://example.com", scope: "document", preferences },
      };
      expect(isUIMessage(message)).toBe(true);
    });

    it("returns true for CANCEL_SYNC message", () => {
      const message = {
        type: "CANCEL_SYNC",
        runId: "run:1",
      };
      expect(isUIMessage(message)).toBe(true);
    });

    it("returns true for RENAME_SELECTION message", () => {
      const message = {
        type: "RENAME_SELECTION",
        payload: { action: { type: "label", label: "Title" } },
      };
      expect(isUIMessage(message)).toBe(true);
    });

    it("returns true for SHEET_DATA message", () => {
      const message = {
        type: "SHEET_DATA",
        runId: "run:1",
        payload: {
          fetchedAt: 1,
          data: {
            worksheets: [],
            activeWorksheet: "Sheet1",
          },
        },
      };
      expect(isUIMessage(message)).toBe(true);
    });

    it("returns true for IMAGE_DATA message", () => {
      const message = {
        type: "IMAGE_DATA",
        runId: "run:1",
        payload: {
          nodeId: "123:456",
          requestId: "image:1",
          url: "https://example.com/image.png",
          data: new Uint8Array([1, 2, 3]),
        },
      };
      expect(isUIMessage(message)).toBe(true);
    });

    it("returns true for FETCH_ERROR message", () => {
      const message = {
        type: "FETCH_ERROR",
        runId: "run:1",
        payload: { error: "Network error" },
      };
      expect(isUIMessage(message)).toBe(true);
    });

    it("returns false for null", () => {
      expect(isUIMessage(null)).toBe(false);
    });

    it("returns false for undefined", () => {
      expect(isUIMessage(undefined)).toBe(false);
    });

    it("returns false for primitive values", () => {
      expect(isUIMessage("string")).toBe(false);
      expect(isUIMessage(123)).toBe(false);
      expect(isUIMessage(true)).toBe(false);
    });

    it("returns false for objects without type property", () => {
      expect(isUIMessage({})).toBe(false);
      expect(isUIMessage({ payload: {} })).toBe(false);
    });

    it("returns false for objects with non-string type", () => {
      expect(isUIMessage({ type: 123 })).toBe(false);
      expect(isUIMessage({ type: null })).toBe(false);
      expect(isUIMessage({ type: {} })).toBe(false);
    });

    it("returns false for arrays", () => {
      expect(isUIMessage([])).toBe(false);
      expect(isUIMessage([{ type: "FETCH" }])).toBe(false);
    });
  });

  describe("isPluginMessage", () => {
    it("returns true for valid plugin messages", () => {
      const initMessage: InitMessage = {
        type: "INIT",
        payload: {
          settings,
          hasSelection: true,
          lastUrl: "https://example.com",
        },
      };
      expect(isPluginMessage(initMessage)).toBe(true);

      const progressMessage: ProgressMessage = {
        type: "PROGRESS",
        runId: "run:1",
        payload: { message: "Processing...", progress: 50 },
      };
      expect(isPluginMessage(progressMessage)).toBe(true);

      const errorMessage: ErrorMessage = {
        type: "ERROR",
        runId: "run:1",
        payload: { message: "Something went wrong", recoverable: true },
      };
      expect(isPluginMessage(errorMessage)).toBe(true);
    });

    it("returns true for SELECTION_CHANGED message", () => {
      const message = {
        type: "SELECTION_CHANGED",
        payload: { hasSelection: false },
      };
      expect(isPluginMessage(message)).toBe(true);
    });

    it("returns true for FETCH_SUCCESS message", () => {
      const message = {
        type: "FETCH_SUCCESS",
        runId: "run:1",
        payload: { snapshot },
      };
      expect(isPluginMessage(message)).toBe(true);
    });

    it("returns true for SYNC_COMPLETE message", () => {
      const message = {
        type: "SYNC_COMPLETE",
        runId: "run:1",
        payload: {
          status: "success",
          snapshotId: "snapshot:1",
          counts: { changed: 8, unchanged: 2, skipped: 0, failed: 0 },
          outcomes: [],
          success: true,
          layersProcessed: 10,
          layersUpdated: 8,
          errors: [],
          warnings: [],
        },
      };
      expect(isPluginMessage(message)).toBe(true);
    });

    it("returns true for RESYNC_MODE message", () => {
      const message = {
        type: "RESYNC_MODE",
        runId: "run:1",
        payload: { config },
      };
      expect(isPluginMessage(message)).toBe(true);
    });

    it("returns true for REQUEST_IMAGE_FETCH message", () => {
      const message = {
        type: "REQUEST_IMAGE_FETCH",
        runId: "run:1",
        payload: {
          url: "https://example.com/image.png",
          nodeId: "123:456",
          requestId: "image:1",
        },
      };
      expect(isPluginMessage(message)).toBe(true);
    });

    it("returns true for REQUEST_SHEET_FETCH message", () => {
      const message = {
        type: "REQUEST_SHEET_FETCH",
        runId: "run:1",
        payload: {
          url: "https://docs.google.com/spreadsheets/d/abc123/edit",
          snapshotId: "snapshot:1",
          preferences,
        },
      };
      expect(isPluginMessage(message)).toBe(true);
    });

    it("returns false for null", () => {
      expect(isPluginMessage(null)).toBe(false);
    });

    it("returns false for undefined", () => {
      expect(isPluginMessage(undefined)).toBe(false);
    });

    it("returns false for primitive values", () => {
      expect(isPluginMessage("string")).toBe(false);
      expect(isPluginMessage(123)).toBe(false);
      expect(isPluginMessage(true)).toBe(false);
    });

    it("returns false for objects without type property", () => {
      expect(isPluginMessage({})).toBe(false);
      expect(isPluginMessage({ payload: {} })).toBe(false);
    });

    it("returns false for objects with non-string type", () => {
      expect(isPluginMessage({ type: 123 })).toBe(false);
      expect(isPluginMessage({ type: null })).toBe(false);
    });
  });

  describe("sendToUI", () => {
    let mockFigmaUI: { postMessage: ReturnType<typeof vi.fn> };

    beforeEach(() => {
      mockFigmaUI = { postMessage: vi.fn() };
      (global as Record<string, unknown>).figma = { ui: mockFigmaUI };
    });

    afterEach(() => {
      delete (global as Record<string, unknown>).figma;
    });

    it("calls figma.ui.postMessage with the message", () => {
      const message: PluginMessage = {
        type: "INIT",
        payload: { settings, hasSelection: true },
      };

      sendToUI(message);

      expect(mockFigmaUI.postMessage).toHaveBeenCalledWith(message);
      expect(mockFigmaUI.postMessage).toHaveBeenCalledTimes(1);
    });

    it("sends progress messages correctly", () => {
      const message: ProgressMessage = {
        type: "PROGRESS",
        runId: "run:1",
        payload: { message: "Loading...", progress: 75 },
      };

      sendToUI(message);

      expect(mockFigmaUI.postMessage).toHaveBeenCalledWith(message);
    });

    it("sends error messages correctly", () => {
      const message: ErrorMessage = {
        type: "ERROR",
        runId: "run:1",
        payload: { message: "Failed to sync", recoverable: false },
      };

      sendToUI(message);

      expect(mockFigmaUI.postMessage).toHaveBeenCalledWith(message);
    });
  });

  describe("sendToPlugin", () => {
    let mockParent: { postMessage: ReturnType<typeof vi.fn> };

    beforeEach(() => {
      mockParent = { postMessage: vi.fn() };
      (global as Record<string, unknown>).parent = mockParent;
    });

    afterEach(() => {
      delete (global as Record<string, unknown>).parent;
    });

    it("calls parent.postMessage with wrapped message", () => {
      const message: UIMessage = {
        type: "FETCH",
        runId: "run:1",
        payload: { url: "https://example.com", preferences },
      };

      sendToPlugin(message);

      expect(mockParent.postMessage).toHaveBeenCalledWith(
        { pluginMessage: message },
        "*",
      );
      expect(mockParent.postMessage).toHaveBeenCalledTimes(1);
    });

    it("sends sync messages correctly", () => {
      const message: SyncMessage = {
        type: "SYNC",
        runId: "run:1",
        payload: { scope: "selection", snapshotId: "snapshot:1", preferences },
      };

      sendToPlugin(message);

      expect(mockParent.postMessage).toHaveBeenCalledWith(
        { pluginMessage: message },
        "*",
      );
    });

    it("sends UI_READY message correctly", () => {
      const message: UIMessage = { type: "UI_READY" };

      sendToPlugin(message);

      expect(mockParent.postMessage).toHaveBeenCalledWith(
        { pluginMessage: message },
        "*",
      );
    });
  });
});
