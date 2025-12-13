## TICKET-020: Re-sync & Relaunch Button Functionality

**Type:** Feature  
**Priority:** Medium  

### Description

Implement the re-sync functionality that allows users to quickly re-run the sync with the last used URL, accessible via the relaunch buttons in the Figma inspector panel.

### Requirements

- Store last used URL per document
- "Open Sheets Sync" relaunch button opens the plugin
- "Re-Sync Google Sheets Data" relaunch button immediately syncs with last URL
- Set relaunch data on document after successful sync
- Handle case when no previous URL exists

### Technical Specifications

**Relaunch Data Setup:**

```typescript
async function setRelaunchData(url: string): Promise<void> {
  // Set on document root for visibility in empty selection
  figma.root.setRelaunchData({
    open: '',
    resync: `Last synced from: ${truncateUrl(url, 50)}`
  });
}

function truncateUrl(url: string, maxLength: number): string {
  if (url.length <= maxLength) return url;
  return url.substring(0, maxLength - 3) + '...';
}
```

**Command Handling:**

```typescript
// In main plugin code
const command = figma.command;

async function main(): Promise<void> {
  switch (command) {
    case 'open':
      // Standard plugin open - show UI
      showMainUI();
      break;
      
    case 'resync':
      // Re-sync with last URL
      await handleResync();
      break;
      
    default:
      // First run or menu launch
      showMainUI();
      break;
  }
}

async function handleResync(): Promise<void> {
  const lastUrl = await figma.clientStorage.getAsync('lastUrl');
  
  if (!lastUrl) {
    figma.notify('No previous sync found. Please run Sheets Sync first.', { 
      error: true 
    });
    showMainUI();
    return;
  }
  
  // Show minimal UI with progress
  figma.showUI(__html__, { width: 300, height: 100 });
  figma.ui.postMessage({ 
    type: 'RESYNC_MODE', 
    payload: { url: lastUrl } 
  });
  
  // Run sync
  try {
    const result = await runSync({
      url: lastUrl,
      scope: 'page' // Default to current page for re-sync
    });
    
    if (result.success) {
      figma.notify(`Synced ${result.layersUpdated} layers`);
    } else {
      figma.notify(`Sync completed with ${result.errors.length} errors`, {
        error: true
      });
    }
  } finally {
    figma.closePlugin();
  }
}
```

**Manifest Configuration:**

```json
{
  "relaunchButtons": [
    {
      "command": "open",
      "name": "Open Sheets Sync"
    },
    {
      "command": "resync",
      "name": "Re-Sync Google Sheets Data"
    }
  ]
}
```

**Client Storage:**

```typescript
// Store URL on successful sync
await figma.clientStorage.setAsync('lastUrl', url);

// Retrieve stored URL
const lastUrl = await figma.clientStorage.getAsync('lastUrl') as string | undefined;
```

### Dependencies

TICKET-019, TICKET-017

### Acceptance Criteria

- [ ] Relaunch buttons appear in inspector panel after first sync
- [ ] "Open Sheets Sync" opens plugin with last URL pre-filled
- [ ] "Re-Sync" runs immediate sync with last URL
- [ ] "Re-Sync" shows helpful error if no previous URL
- [ ] Last URL persists across Figma sessions
- [ ] Relaunch data shows truncated URL description