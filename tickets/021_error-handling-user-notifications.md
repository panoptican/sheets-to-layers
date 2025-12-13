## TICKET-021: Error Handling & User Notifications

**Type:** Feature  
**Priority:** Medium  

### Description

Implement comprehensive error handling across the plugin with user-friendly notifications and helpful error messages.

### Requirements

- Catch and handle all potential errors gracefully
- Display user-friendly error messages
- Provide actionable guidance for common errors
- Log detailed errors for debugging
- Use Figma's notify API for non-blocking messages
- Show blocking errors in UI for critical failures

### Technical Specifications

**Error Types:**

```typescript
enum ErrorType {
  NETWORK_ERROR = 'NETWORK_ERROR',
  SHEET_NOT_PUBLIC = 'SHEET_NOT_PUBLIC',
  SHEET_NOT_FOUND = 'SHEET_NOT_FOUND',
  INVALID_URL = 'INVALID_URL',
  FONT_NOT_FOUND = 'FONT_NOT_FOUND',
  COMPONENT_NOT_FOUND = 'COMPONENT_NOT_FOUND',
  IMAGE_LOAD_FAILED = 'IMAGE_LOAD_FAILED',
  PARSE_ERROR = 'PARSE_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

interface AppError extends Error {
  type: ErrorType;
  userMessage: string;
  details?: string;
  recoverable: boolean;
}

function createAppError(
  type: ErrorType, 
  details?: string
): AppError {
  const messages: Record<ErrorType, { message: string; recoverable: boolean }> = {
    [ErrorType.NETWORK_ERROR]: {
      message: 'Network error. Please check your internet connection.',
      recoverable: true
    },
    [ErrorType.SHEET_NOT_PUBLIC]: {
      message: 'This sheet is not publicly accessible. Please set sharing to "Anyone with the link can view".',
      recoverable: false
    },
    [ErrorType.SHEET_NOT_FOUND]: {
      message: 'Sheet not found. Please check the URL is correct.',
      recoverable: false
    },
    [ErrorType.INVALID_URL]: {
      message: 'Invalid Google Sheets URL. Please paste a valid shareable link.',
      recoverable: false
    },
    [ErrorType.FONT_NOT_FOUND]: {
      message: 'Some fonts could not be loaded. Text styling may be incomplete.',
      recoverable: true
    },
    [ErrorType.COMPONENT_NOT_FOUND]: {
      message: 'Component not found in sync scope. Make sure the component is on the current page.',
      recoverable: true
    },
    [ErrorType.IMAGE_LOAD_FAILED]: {
      message: 'Failed to load image from URL.',
      recoverable: true
    },
    [ErrorType.PARSE_ERROR]: {
      message: 'Failed to parse sheet data. Please check the sheet format.',
      recoverable: false
    },
    [ErrorType.UNKNOWN_ERROR]: {
      message: 'An unexpected error occurred.',
      recoverable: false
    }
  };
  
  const config = messages[type];
  const error = new Error(config.message) as AppError;
  error.type = type;
  error.userMessage = config.message;
  error.details = details;
  error.recoverable = config.recoverable;
  
  return error;
}
```

**Notification Handler:**

```typescript
function notifyUser(
  message: string, 
  options: { 
    error?: boolean; 
    timeout?: number;
    button?: { text: string; action: () => void };
  } = {}
): void {
  const notifyOptions: NotificationOptions = {
    timeout: options.timeout ?? (options.error ? 5000 : 3000),
    error: options.error
  };
  
  if (options.button) {
    notifyOptions.button = {
      text: options.button.text,
      action: options.button.action
    };
  }
  
  figma.notify(message, notifyOptions);
}

function notifyError(error: AppError): void {
  notifyUser(error.userMessage, { 
    error: true,
    timeout: 6000
  });
  
  // Log detailed error for debugging
  console.error(`[Sheets Sync] ${error.type}:`, error.details || error.message);
}
```

**Error Boundary for Sync:**

```typescript
async function safeSyncLayer(
  layer: LayerToProcess,
  ...args: any[]
): Promise<{ success: boolean; error?: AppError }> {
  try {
    await processLayer(layer, ...args);
    return { success: true };
  } catch (error) {
    const appError = error instanceof AppError 
      ? error 
      : createAppError(ErrorType.UNKNOWN_ERROR, error.message);
    
    // Non-blocking notification for recoverable errors
    if (appError.recoverable) {
      notifyUser(`${layer.node.name}: ${appError.userMessage}`, { error: true });
    }
    
    return { success: false, error: appError };
  }
}
```

### Dependencies

TICKET-019

### Acceptance Criteria

- [ ] Network errors show helpful retry message
- [ ] Sheet permission errors explain how to fix sharing
- [ ] Invalid URLs are caught before fetch attempt
- [ ] Font errors allow sync to continue
- [ ] Component not found errors identify missing component
- [ ] Image errors show which image failed
- [ ] Unknown errors are logged for debugging
- [ ] Notifications don't block user interaction