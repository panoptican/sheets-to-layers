/**
 * Error handling utilities for Sheets Sync plugin.
 * Provides consistent error creation, messaging, and notification.
 */

import type { AppError } from './types';
import { ErrorType } from './types';

// ============================================================================
// Error Messages
// ============================================================================

/**
 * User-friendly messages and recovery status for each error type.
 */
const ERROR_CONFIGS: Record<ErrorType, { message: string; recoverable: boolean }> = {
  [ErrorType.NETWORK_ERROR]: {
    message: 'Network error. Please check your internet connection and try again.',
    recoverable: true,
  },
  [ErrorType.SHEET_NOT_PUBLIC]: {
    message: 'This sheet is not publicly accessible. Please set sharing to "Anyone with the link can view".',
    recoverable: false,
  },
  [ErrorType.SHEET_NOT_FOUND]: {
    message: 'Sheet not found. Please check the URL is correct.',
    recoverable: false,
  },
  [ErrorType.INVALID_URL]: {
    message: 'Invalid Google Sheets URL. Please paste a valid shareable link.',
    recoverable: false,
  },
  [ErrorType.FONT_NOT_FOUND]: {
    message: 'Some fonts could not be loaded. Text styling may be incomplete.',
    recoverable: true,
  },
  [ErrorType.COMPONENT_NOT_FOUND]: {
    message: 'Component not found. Make sure the component exists in the document.',
    recoverable: true,
  },
  [ErrorType.IMAGE_LOAD_FAILED]: {
    message: 'Failed to load image from URL.',
    recoverable: true,
  },
  [ErrorType.PARSE_ERROR]: {
    message: 'Failed to parse sheet data. Please check the sheet format.',
    recoverable: false,
  },
  [ErrorType.WORKSHEET_NOT_FOUND]: {
    message: 'Worksheet not found. Check that the worksheet name matches.',
    recoverable: true,
  },
  [ErrorType.LABEL_NOT_FOUND]: {
    message: 'Label not found in sheet data.',
    recoverable: true,
  },
  [ErrorType.UNKNOWN_ERROR]: {
    message: 'An unexpected error occurred.',
    recoverable: false,
  },
};

// ============================================================================
// Error Factory
// ============================================================================

/**
 * Create an application error with user-friendly messaging.
 *
 * @param type - The error category
 * @param details - Optional technical details for debugging
 * @returns An AppError instance
 */
export function createAppError(type: ErrorType, details?: string): AppError {
  const config = ERROR_CONFIGS[type] || ERROR_CONFIGS[ErrorType.UNKNOWN_ERROR];

  const error = new Error(config.message) as AppError;
  error.type = type;
  error.userMessage = config.message;
  error.details = details;
  error.recoverable = config.recoverable;
  error.name = 'AppError';

  return error;
}

/**
 * Check if an error is an AppError instance.
 */
export function isAppError(error: unknown): error is AppError {
  return (
    error instanceof Error &&
    'type' in error &&
    'userMessage' in error &&
    'recoverable' in error
  );
}

/**
 * Convert any error to an AppError.
 * If already an AppError, returns as-is.
 * Otherwise wraps in an UNKNOWN_ERROR.
 */
export function toAppError(error: unknown): AppError {
  if (isAppError(error)) {
    return error;
  }

  if (error instanceof Error) {
    return createAppError(ErrorType.UNKNOWN_ERROR, error.message);
  }

  return createAppError(ErrorType.UNKNOWN_ERROR, String(error));
}

// ============================================================================
// Error Formatting
// ============================================================================

/**
 * Format an error for user display.
 * Returns a concise, user-friendly message.
 */
export function formatErrorForUser(error: AppError): string {
  return error.userMessage;
}

/**
 * Format an error for logging.
 * Includes technical details for debugging.
 */
export function formatErrorForLog(error: AppError): string {
  const parts = [`[Sheets Sync] ${error.type}: ${error.userMessage}`];

  if (error.details) {
    parts.push(`Details: ${error.details}`);
  }

  if (error.stack) {
    parts.push(`Stack: ${error.stack}`);
  }

  return parts.join('\n');
}

/**
 * Log an error with appropriate context.
 */
export function logError(error: AppError): void {
  console.error(formatErrorForLog(error));
}

// ============================================================================
// Layer-specific Error Helpers
// ============================================================================

/**
 * Create an error message for a specific layer.
 */
export function createLayerError(
  layerName: string,
  type: ErrorType,
  details?: string
): { layerName: string; error: string } {
  const config = ERROR_CONFIGS[type] || ERROR_CONFIGS[ErrorType.UNKNOWN_ERROR];
  return {
    layerName,
    error: details ? `${config.message} (${details})` : config.message,
  };
}

/**
 * Create a warning message for recoverable issues.
 */
export function createWarning(message: string, layerName?: string): string {
  return layerName ? `${layerName}: ${message}` : message;
}

// ============================================================================
// Async Error Wrapper
// ============================================================================

/**
 * Wrap an async operation with error handling.
 * Returns a result object instead of throwing.
 */
export async function safeAsync<T>(
  operation: () => Promise<T>,
  errorType: ErrorType = ErrorType.UNKNOWN_ERROR
): Promise<{ success: true; value: T } | { success: false; error: AppError }> {
  try {
    const value = await operation();
    return { success: true, value };
  } catch (err) {
    const error = isAppError(err) ? err : createAppError(errorType, err instanceof Error ? err.message : String(err));
    logError(error);
    return { success: false, error };
  }
}

/**
 * Wrap a sync operation with error handling.
 * Returns a result object instead of throwing.
 */
export function safeSync<T>(
  operation: () => T,
  errorType: ErrorType = ErrorType.UNKNOWN_ERROR
): { success: true; value: T } | { success: false; error: AppError } {
  try {
    const value = operation();
    return { success: true, value };
  } catch (err) {
    const error = isAppError(err) ? err : createAppError(errorType, err instanceof Error ? err.message : String(err));
    logError(error);
    return { success: false, error };
  }
}
