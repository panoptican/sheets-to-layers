/**
 * Tests for error handling utilities.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createAppError,
  isAppError,
  toAppError,
  formatErrorForUser,
  formatErrorForLog,
  logError,
  createLayerError,
  createWarning,
  safeAsync,
  safeSync,
} from '../../src/core/errors';
import { ErrorType } from '../../src/core/types';

describe('errors', () => {
  describe('createAppError', () => {
    it('creates an error with correct type', () => {
      const error = createAppError(ErrorType.NETWORK_ERROR);
      expect(error.type).toBe(ErrorType.NETWORK_ERROR);
    });

    it('creates an error with user-friendly message', () => {
      const error = createAppError(ErrorType.SHEET_NOT_PUBLIC);
      expect(error.userMessage).toContain('not publicly accessible');
      expect(error.userMessage).toContain('Anyone with the link can view');
    });

    it('includes details when provided', () => {
      const error = createAppError(ErrorType.INVALID_URL, 'URL: https://example.com');
      expect(error.details).toBe('URL: https://example.com');
    });

    it('sets recoverable flag based on error type', () => {
      // Recoverable errors
      expect(createAppError(ErrorType.NETWORK_ERROR).recoverable).toBe(true);
      expect(createAppError(ErrorType.FONT_NOT_FOUND).recoverable).toBe(true);
      expect(createAppError(ErrorType.IMAGE_LOAD_FAILED).recoverable).toBe(true);
      expect(createAppError(ErrorType.COMPONENT_NOT_FOUND).recoverable).toBe(true);
      expect(createAppError(ErrorType.WORKSHEET_NOT_FOUND).recoverable).toBe(true);
      expect(createAppError(ErrorType.LABEL_NOT_FOUND).recoverable).toBe(true);

      // Non-recoverable errors
      expect(createAppError(ErrorType.SHEET_NOT_PUBLIC).recoverable).toBe(false);
      expect(createAppError(ErrorType.SHEET_NOT_FOUND).recoverable).toBe(false);
      expect(createAppError(ErrorType.INVALID_URL).recoverable).toBe(false);
      expect(createAppError(ErrorType.PARSE_ERROR).recoverable).toBe(false);
      expect(createAppError(ErrorType.UNKNOWN_ERROR).recoverable).toBe(false);
    });

    it('creates error that extends Error', () => {
      const error = createAppError(ErrorType.UNKNOWN_ERROR);
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('AppError');
    });

    it('has correct error messages for each type', () => {
      expect(createAppError(ErrorType.NETWORK_ERROR).userMessage).toContain('Network error');
      expect(createAppError(ErrorType.SHEET_NOT_FOUND).userMessage).toContain('not found');
      expect(createAppError(ErrorType.FONT_NOT_FOUND).userMessage).toContain('fonts');
      expect(createAppError(ErrorType.COMPONENT_NOT_FOUND).userMessage).toContain('Component');
      expect(createAppError(ErrorType.IMAGE_LOAD_FAILED).userMessage).toContain('image');
      expect(createAppError(ErrorType.PARSE_ERROR).userMessage).toContain('parse');
      expect(createAppError(ErrorType.WORKSHEET_NOT_FOUND).userMessage).toContain('Worksheet');
      expect(createAppError(ErrorType.LABEL_NOT_FOUND).userMessage).toContain('Label');
    });
  });

  describe('isAppError', () => {
    it('returns true for AppError instances', () => {
      const error = createAppError(ErrorType.NETWORK_ERROR);
      expect(isAppError(error)).toBe(true);
    });

    it('returns false for regular Error instances', () => {
      const error = new Error('Test error');
      expect(isAppError(error)).toBe(false);
    });

    it('returns false for non-Error objects', () => {
      expect(isAppError('string error')).toBe(false);
      expect(isAppError({ message: 'object error' })).toBe(false);
      expect(isAppError(null)).toBe(false);
      expect(isAppError(undefined)).toBe(false);
    });
  });

  describe('toAppError', () => {
    it('returns AppError as-is', () => {
      const original = createAppError(ErrorType.NETWORK_ERROR);
      const converted = toAppError(original);
      expect(converted).toBe(original);
    });

    it('converts regular Error to AppError', () => {
      const original = new Error('Regular error');
      const converted = toAppError(original);
      expect(isAppError(converted)).toBe(true);
      expect(converted.type).toBe(ErrorType.UNKNOWN_ERROR);
      expect(converted.details).toBe('Regular error');
    });

    it('converts string to AppError', () => {
      const converted = toAppError('String error');
      expect(isAppError(converted)).toBe(true);
      expect(converted.type).toBe(ErrorType.UNKNOWN_ERROR);
      expect(converted.details).toBe('String error');
    });

    it('converts other types to AppError', () => {
      const converted = toAppError({ custom: 'error' });
      expect(isAppError(converted)).toBe(true);
      expect(converted.type).toBe(ErrorType.UNKNOWN_ERROR);
    });
  });

  describe('formatErrorForUser', () => {
    it('returns the user message', () => {
      const error = createAppError(ErrorType.SHEET_NOT_PUBLIC);
      const formatted = formatErrorForUser(error);
      expect(formatted).toBe(error.userMessage);
    });
  });

  describe('formatErrorForLog', () => {
    it('includes error type and message', () => {
      const error = createAppError(ErrorType.NETWORK_ERROR);
      const formatted = formatErrorForLog(error);
      expect(formatted).toContain('[Sheets to Layers]');
      expect(formatted).toContain(ErrorType.NETWORK_ERROR);
      expect(formatted).toContain(error.userMessage);
    });

    it('includes details when present', () => {
      const error = createAppError(ErrorType.INVALID_URL, 'Bad URL format');
      const formatted = formatErrorForLog(error);
      expect(formatted).toContain('Bad URL format');
    });
  });

  describe('logError', () => {
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleErrorSpy.mockRestore();
    });

    it('logs error to console', () => {
      const error = createAppError(ErrorType.NETWORK_ERROR);
      logError(error);
      expect(consoleErrorSpy).toHaveBeenCalled();
      const loggedMessage = consoleErrorSpy.mock.calls[0][0];
      expect(loggedMessage).toContain('[Sheets to Layers]');
    });
  });

  describe('createLayerError', () => {
    it('creates error object with layer name', () => {
      const result = createLayerError('MyLayer', ErrorType.FONT_NOT_FOUND);
      expect(result.layerName).toBe('MyLayer');
      expect(result.error).toContain('fonts');
    });

    it('includes details in error message', () => {
      const result = createLayerError('MyLayer', ErrorType.FONT_NOT_FOUND, 'Arial Bold');
      expect(result.error).toContain('Arial Bold');
    });
  });

  describe('createWarning', () => {
    it('creates warning message without layer name', () => {
      const warning = createWarning('Something might be wrong');
      expect(warning).toBe('Something might be wrong');
    });

    it('creates warning message with layer name', () => {
      const warning = createWarning('Font not found', 'TextLayer');
      expect(warning).toBe('TextLayer: Font not found');
    });
  });

  describe('safeAsync', () => {
    it('returns success result on successful operation', async () => {
      const result = await safeAsync(async () => 'success');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toBe('success');
      }
    });

    it('returns error result on failed operation', async () => {
      const result = await safeAsync(async () => {
        throw new Error('Test failure');
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(isAppError(result.error)).toBe(true);
        expect(result.error.details).toBe('Test failure');
      }
    });

    it('uses provided error type', async () => {
      const result = await safeAsync(
        async () => {
          throw new Error('Network issue');
        },
        ErrorType.NETWORK_ERROR
      );
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe(ErrorType.NETWORK_ERROR);
      }
    });

    it('preserves AppError when thrown', async () => {
      const originalError = createAppError(ErrorType.SHEET_NOT_PUBLIC, 'Access denied');
      const result = await safeAsync(async () => {
        throw originalError;
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe(originalError);
      }
    });
  });

  describe('safeSync', () => {
    it('returns success result on successful operation', () => {
      const result = safeSync(() => 42);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toBe(42);
      }
    });

    it('returns error result on failed operation', () => {
      const result = safeSync(() => {
        throw new Error('Sync failure');
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(isAppError(result.error)).toBe(true);
        expect(result.error.details).toBe('Sync failure');
      }
    });

    it('uses provided error type', () => {
      const result = safeSync(
        () => {
          throw new Error('Parse issue');
        },
        ErrorType.PARSE_ERROR
      );
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe(ErrorType.PARSE_ERROR);
      }
    });
  });
});
