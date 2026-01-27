## TICKET-017: Plugin UI - Main Interface

**Type:** Feature  
**Priority:** High  

### Description

Implement the main plugin user interface including the Google Sheets URL input, sync scope selection, and action buttons.

### Requirements

- URL input field for Google Sheets link
- Scope selection (entire document, current page, current selection)
- "Fetch" button to preview data without syncing
- "Fetch & Sync" button to fetch and immediately sync
- Progress indicator during fetch/sync operations
- Error message display
- Remember last used URL (per document)

### Technical Specifications

**UI Structure (React or HTML):**

```html
<div class="plugin-container">
  <header>
    <h1>Sheets Sync</h1>
  </header>
  
  <main>
    <section class="url-input">
      <label for="sheets-url">Google Sheets URL</label>
      <input 
        type="url" 
        id="sheets-url" 
        placeholder="Paste your shareable Google Sheets link"
      />
      <p class="help-text">
        Make sure your sheet is set to "Anyone with the link can view"
      </p>
    </section>
    
    <section class="scope-selection">
      <label>Sync scope</label>
      <div class="radio-group">
        <label>
          <input type="radio" name="scope" value="document" />
          Update entire document
        </label>
        <label>
          <input type="radio" name="scope" value="page" checked />
          Update current page only
        </label>
        <label class="selection-option" style="display: none;">
          <input type="radio" name="scope" value="selection" />
          Update current selection only
        </label>
      </div>
    </section>
    
    <section class="error-display" style="display: none;">
      <p class="error-message"></p>
    </section>
    
    <section class="progress" style="display: none;">
      <div class="spinner"></div>
      <p class="progress-text">Fetching data...</p>
    </section>
  </main>
  
  <footer class="actions">
    <button id="fetch-btn" class="secondary">Fetch</button>
    <button id="sync-btn" class="primary">Fetch & Sync</button>
  </footer>
</div>
```

**Message Handling:**

```typescript
// UI to Plugin messages
interface UIMessage {
  type: 'FETCH' | 'FETCH_AND_SYNC' | 'SYNC' | 'UI_READY';
  payload?: {
    url?: string;
    scope?: 'document' | 'page' | 'selection';
  };
}

// Plugin to UI messages
interface PluginMessage {
  type: 'INIT' | 'SELECTION_CHANGED' | 'FETCH_SUCCESS' | 'FETCH_ERROR' | 'SYNC_COMPLETE' | 'SYNC_ERROR' | 'PROGRESS';
  payload?: {
    hasSelection?: boolean;
    lastUrl?: string;
    sheetData?: SheetData;
    error?: string;
    progress?: number;
    message?: string;
  };
}
```

**State Management:**

```typescript
interface UIState {
  url: string;
  scope: 'document' | 'page' | 'selection';
  hasSelection: boolean;
  isLoading: boolean;
  error: string | null;
  sheetData: SheetData | null;
  mode: 'input' | 'preview' | 'syncing';
}
```

**Styles:**

```css
/* Figma-consistent styling */
.plugin-container {
  font-family: Inter, sans-serif;
  font-size: 11px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  height: 100%;
}

.primary {
  background: #18A0FB;
  color: white;
  border: none;
  border-radius: 6px;
  padding: 8px 16px;
  cursor: pointer;
}

.secondary {
  background: transparent;
  border: 1px solid #E5E5E5;
  border-radius: 6px;
  padding: 8px 16px;
  cursor: pointer;
}
```

### Dependencies

TICKET-001

### Acceptance Criteria

- [ ] URL input accepts and validates Google Sheets URLs
- [ ] Scope radio buttons work correctly
- [ ] "Selection" option only appears when layers are selected
- [ ] "Fetch" button triggers data preview mode
- [ ] "Fetch & Sync" button triggers immediate sync
- [ ] Progress indicator shows during operations
- [ ] Error messages display clearly
- [ ] Last URL is remembered per document
- [ ] UI is responsive and follows Figma design patterns