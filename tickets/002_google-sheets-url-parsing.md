## TICKET-002: Google Sheets URL Parsing & Validation

**Type:** Feature  
**Priority:** High  

### Description

Implement URL parsing and validation for Google Sheets shareable links. Extract the spreadsheet ID from various Google Sheets URL formats and validate that the URL points to a publicly accessible sheet.

### Requirements

- Parse Google Sheets URLs in multiple formats (edit, view, share links)
- Extract spreadsheet ID from URL
- Validate URL format before attempting data fetch
- Handle edge cases (malformed URLs, non-sheets URLs)
- Provide clear error messages for invalid inputs

### Technical Specifications

**URL Formats to Support:**

```
https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/edit
https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/edit#gid={SHEET_ID}
https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/edit?usp=sharing
https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}
```

**Implementation:**

```typescript
interface ParsedSheetUrl {
  spreadsheetId: string;
  gid?: string;
  isValid: boolean;
  errorMessage?: string;
}

function parseGoogleSheetsUrl(url: string): ParsedSheetUrl {
  const patterns = [
    /docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/,
    /spreadsheets\/d\/([a-zA-Z0-9-_]+)/
  ];
  
  // Extract gid if present
  const gidMatch = url.match(/[#&?]gid=(\d+)/);
  
  // Implementation details...
}

function buildExportUrl(spreadsheetId: string, format: 'csv' | 'json'): string {
  // For CSV: https://docs.google.com/spreadsheets/d/{ID}/export?format=csv&gid={GID}
  // For JSON via Sheets API v4 or published sheet endpoint
}
```

**Validation Rules:**

- URL must contain 'docs.google.com/spreadsheets' or be a shortened goo.gl link
- Spreadsheet ID must be alphanumeric with hyphens and underscores
- Must be non-empty string
- Must not be a Google Forms or other Google Docs link

### Dependencies

TICKET-001

### Acceptance Criteria

- [ ] Successfully parses all standard Google Sheets URL formats
- [ ] Returns spreadsheet ID correctly
- [ ] Identifies and returns gid when present in URL
- [ ] Returns appropriate error for malformed URLs
- [ ] Returns appropriate error for non-Google Sheets URLs
- [ ] Unit tests pass for all URL format variations