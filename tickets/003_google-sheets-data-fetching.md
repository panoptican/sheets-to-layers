## TICKET-003: Google Sheets Data Fetching

**Type:** Feature  
**Priority:** High  

### Description

Implement the data fetching mechanism to retrieve spreadsheet data from Google Sheets using the public export endpoint. Handle network requests, parse responses, and normalize data into the internal data structure.

### Requirements

- Fetch spreadsheet data from public Google Sheets URLs
- Support fetching all worksheets in a spreadsheet
- Handle network errors gracefully
- Implement request timeout handling
- Cache fetched data for the session
- Support both CSV export and JSON formats

### Technical Specifications

**Fetching Strategy:**

Since the original plugin used public shareable links, use the published CSV/JSON export endpoints:

```typescript
async function fetchSheetData(spreadsheetId: string): Promise<SheetData> {
  // Option 1: Use the published JSON endpoint (if sheet is published to web)
  // https://docs.google.com/spreadsheets/d/{ID}/gviz/tq?tqx=out:json
  
  // Option 2: Use CSV export endpoint per worksheet
  // https://docs.google.com/spreadsheets/d/{ID}/export?format=csv&gid={GID}
  
  // First, fetch metadata to get worksheet names and gids
  const metadataUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
  
  // Implementation with fetch API in UI context (has network access)
}

async function fetchWorksheet(
  spreadsheetId: string, 
  gid: string
): Promise<string[][]> {
  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`;
  
  const response = await fetch(url);
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error('Sheet is not publicly accessible. Please set sharing to "Anyone with the link can view".');
    }
    throw new Error(`Failed to fetch sheet: ${response.statusText}`);
  }
  
  const csvText = await response.text();
  return parseCSV(csvText);
}

function parseCSV(csvText: string): string[][] {
  // Handle quoted fields, escaped quotes, newlines in fields
  // Consider using a robust CSV parser library
}
```

**Error Handling:**

```typescript
enum FetchError {
  NETWORK_ERROR = 'NETWORK_ERROR',
  NOT_PUBLIC = 'NOT_PUBLIC',
  NOT_FOUND = 'NOT_FOUND',
  TIMEOUT = 'TIMEOUT',
  INVALID_FORMAT = 'INVALID_FORMAT'
}

interface FetchResult {
  success: boolean;
  data?: SheetData;
  error?: {
    type: FetchError;
    message: string;
  };
}
```

**Network Configuration:**

- Requests must be made from UI context (iframe has network access)
- Timeout: 30 seconds
- Retry logic: 1 retry on timeout

### Dependencies

TICKET-001, TICKET-002

### Acceptance Criteria

- [ ] Successfully fetches data from public Google Sheets
- [ ] Retrieves all worksheets in a spreadsheet
- [ ] Parses CSV data correctly including edge cases (quotes, newlines)
- [ ] Provides clear error message when sheet is not public
- [ ] Provides clear error message on network timeout
- [ ] Handles 404 (sheet not found) gracefully
- [ ] Cached data prevents redundant fetches during session

---

