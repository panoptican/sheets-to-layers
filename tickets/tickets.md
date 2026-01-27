# Sheets to Layers - Implementation Tickets

## Table of Contents

1. [TICKET-001: Plugin Infrastructure & Project Setup](#ticket-001-plugin-infrastructure--project-setup)
2. [TICKET-002: Google Sheets URL Parsing & Validation](#ticket-002-google-sheets-url-parsing--validation)
3. [TICKET-003: Google Sheets Data Fetching](#ticket-003-google-sheets-data-fetching)
4. [TICKET-004: Sheet Structure Detection & Orientation](#ticket-004-sheet-structure-detection--orientation)
5. [TICKET-005: Layer Name Parsing - Basic Label Syntax](#ticket-005-layer-name-parsing---basic-label-syntax)
6. [TICKET-006: Layer Name Parsing - Worksheet & Index Syntax](#ticket-006-layer-name-parsing---worksheet--index-syntax)
7. [TICKET-007: Layer Traversal Engine](#ticket-007-layer-traversal-engine)
8. [TICKET-008: Index Tracking System](#ticket-008-index-tracking-system)
9. [TICKET-009: Text Layer Content Sync](#ticket-009-text-layer-content-sync)
10. [TICKET-010: Image Fill Sync from URLs](#ticket-010-image-fill-sync-from-urls)
11. [TICKET-011: Component Instance Swapping](#ticket-011-component-instance-swapping)
12. [TICKET-012: Special Data Types - Visibility & Color](#ticket-012-special-data-types---visibility--color)
13. [TICKET-013: Special Data Types - Opacity & Dimensions](#ticket-013-special-data-types---opacity--dimensions)
14. [TICKET-014: Special Data Types - Rotation & Text Properties](#ticket-014-special-data-types---rotation--text-properties)
15. [TICKET-015: Chained Special Data Types](#ticket-015-chained-special-data-types)
16. [TICKET-016: Layer Repetition (Auto-Duplication)](#ticket-016-layer-repetition-auto-duplication)
17. [TICKET-017: Plugin UI - Main Interface](#ticket-017-plugin-ui---main-interface)
18. [TICKET-018: Plugin UI - Data Preview Mode](#ticket-018-plugin-ui---data-preview-mode)
19. [TICKET-019: Sync Engine - Main Orchestration](#ticket-019-sync-engine---main-orchestration)
20. [TICKET-020: Re-sync & Relaunch Button Functionality](#ticket-020-re-sync--relaunch-button-functionality)
21. [TICKET-021: Error Handling & User Notifications](#ticket-021-error-handling--user-notifications)
22. [TICKET-022: Performance Optimization](#ticket-022-performance-optimization)
23. [TICKET-023: Unit Tests & Integration Tests](#ticket-023-unit-tests--integration-tests)
24. [TICKET-024: Documentation & README](#ticket-024-documentation--readme)
25. [TICKET-025: Accessibility & Keyboard Navigation](#ticket-025-accessibility--keyboard-navigation)

---

## TICKET-001: Plugin Infrastructure & Project Setup

**Type:** Technical Task
**Priority:** High

### Description

Establish the foundational plugin architecture including project structure, build configuration, manifest setup, and core TypeScript types. This creates the scaffolding upon which all other features will be built.

### Requirements

- Initialize a TypeScript Figma plugin project with modern tooling
- Configure manifest.json with appropriate permissions and UI settings
- Establish the plugin's dual-context architecture (main thread + UI iframe)
- Define core TypeScript interfaces for data structures
- Set up message passing between UI and plugin contexts
- Configure build system (esbuild/webpack) for development and production

### Technical Specifications

**manifest.json:**

```json
{
  "name": "Sheets Sync",
  "id": "YOUR_PLUGIN_ID",
  "api": "1.0.0",
  "main": "dist/code.js",
  "ui": "dist/ui.html",
  "editorType": ["figma"],
  "documentAccess": "dynamic-page",
  "networkAccess": {
    "allowedDomains": [
      "docs.google.com",
      "sheets.googleapis.com",
      "drive.google.com",
      "*.googleusercontent.com"
    ]
  },
  "relaunchButtons": [
    {"command": "open", "name": "Open Sheets Sync"},
    {"command": "resync", "name": "Re-Sync Google Sheets Data"}
  ]
}
```

**Core Type Definitions:**

```typescript
interface SheetData {
  worksheets: Worksheet[];
  activeWorksheet: string;
}

interface Worksheet {
  name: string;
  labels: string[];
  rows: Record<string, string[]>;
  orientation: 'columns' | 'rows';
}

interface LayerBinding {
  label: string;
  worksheet?: string;
  index: IndexType;
}

type IndexType =
  | { type: 'specific'; value: number }
  | { type: 'increment' }
  | { type: 'incrementNonBlank' }
  | { type: 'random' }
  | { type: 'randomNonBlank' };

interface SyncContext {
  sheetData: SheetData;
  indexTrackers: Map<string, number>;
  randomHistory: Map<string, Set<number>>;
  scope: 'document' | 'page' | 'selection';
}

interface PluginMessage {
  type: string;
  payload?: any;
}
```

**File Structure:**

```
/src
  /core
    types.ts
    parser.ts
    sync-engine.ts
  /ui
    ui.tsx (or ui.html + ui.ts)
    styles.css
  code.ts (main plugin entry)
/dist
manifest.json
package.json
tsconfig.json
```

### Dependencies

None (foundational ticket)

### Acceptance Criteria

- [ ] Plugin loads in Figma without errors
- [ ] UI window displays when plugin is launched
- [ ] Message passing works bidirectionally between contexts
- [ ] TypeScript compiles without errors
- [ ] Development hot-reload works correctly
- [ ] Production build generates optimized bundle
- [ ] Relaunch buttons appear on nodes after initial run

---

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

---

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

## TICKET-004: Sheet Structure Detection & Orientation

**Type:** Feature
**Priority:** High

### Description

Implement automatic detection of sheet structure including label positions (top row vs. left column) based on bold formatting conventions, and normalize data into a consistent internal format regardless of orientation.

### Requirements

- Detect whether labels are in the top row or left column
- Use bold formatting as the orientation indicator (bolded left column = row-based labels)
- Handle edge cases (no bold formatting defaults to column headers)
- Parse and normalize data into consistent Label → Values structure
- Detect the data bounds (avoid including stray content outside the grid)

### Technical Specifications

**Orientation Detection Logic:**

```typescript
interface SheetMetadata {
  orientation: 'columns' | 'rows';
  labels: string[];
  valueCount: number;
}

function detectOrientation(rawData: string[][], formatting?: CellFormatting[][]): SheetMetadata {
  // If first column cells are bold and first row is not → row orientation
  // Otherwise → column orientation (default)

  // Note: Google Sheets CSV export doesn't include formatting
  // May need to use the Sheets API v4 or alternative detection:
  // - Heuristic: if first column has unique values and first row doesn't → likely row-based
}

// Alternative heuristic when formatting unavailable:
function detectOrientationHeuristic(rawData: string[][]): 'columns' | 'rows' {
  if (rawData.length === 0) return 'columns';

  const firstRow = rawData[0];
  const firstCol = rawData.map(row => row[0]);

  // Check for patterns suggesting row-based layout
  // (e.g., first column has label-like strings, first row has value-like content)
}
```

**Data Normalization:**

```typescript
function normalizeSheetData(
  rawData: string[][],
  orientation: 'columns' | 'rows'
): Record<string, string[]> {
  const normalized: Record<string, string[]> = {};

  if (orientation === 'columns') {
    // First row = labels, subsequent rows = values
    const labels = rawData[0];
    labels.forEach((label, colIndex) => {
      normalized[label] = rawData.slice(1).map(row => row[colIndex] || '');
    });
  } else {
    // First column = labels, subsequent columns = values
    rawData.forEach(row => {
      const label = row[0];
      normalized[label] = row.slice(1);
    });
  }

  return normalized;
}
```

**Data Bounds Detection:**

```typescript
function findDataBounds(rawData: string[][]): { rows: number; cols: number } {
  // Find the last row/column with any non-empty content
  // This prevents stray content outside the main grid from being included
}
```

### Dependencies

TICKET-003

### Acceptance Criteria

- [ ] Correctly identifies column-based label orientation (default)
- [ ] Correctly identifies row-based label orientation when applicable
- [ ] Normalizes both orientations into consistent Label → Values format
- [ ] Ignores empty rows/columns beyond the data grid
- [ ] Handles sheets with only one row or column
- [ ] Handles empty sheets gracefully

---

## TICKET-005: Layer Name Parsing - Basic Label Syntax

**Type:** Feature
**Priority:** High

### Description

Implement the layer name parsing system to extract data binding instructions from Figma layer names. This ticket covers the core `#Label` syntax for binding layers to sheet columns/rows.

### Requirements

- Parse `#Label` syntax from layer names
- Support case-insensitive label matching
- Ignore spaces, underscores, and dashes in label matching
- Allow labels to appear anywhere in layer name (prefix or suffix)
- Return null/undefined when no binding is present

### Technical Specifications

**Parser Implementation:**

```typescript
interface ParsedLayerName {
  hasBinding: boolean;
  labels: string[];  // Support for multiple labels on one layer
  worksheet?: string;
  index?: IndexType;
  isIgnored: boolean;
  forceInclude: boolean;
}

function parseLayerName(layerName: string): ParsedLayerName {
  const result: ParsedLayerName = {
    hasBinding: false,
    labels: [],
    isIgnored: false,
    forceInclude: false
  };

  // Check for ignore prefix
  if (layerName.startsWith('-')) {
    result.isIgnored = true;
    return result;
  }

  // Check for force include prefix (main components)
  if (layerName.startsWith('+')) {
    result.forceInclude = true;
    layerName = layerName.substring(1);
  }

  // Extract labels (#Label syntax)
  const labelPattern = /#([a-zA-Z0-9_\- ]+?)(?=\s*[#./]|$)/g;
  let match;
  while ((match = labelPattern.exec(layerName)) !== null) {
    result.labels.push(match[1]);
    result.hasBinding = true;
  }

  return result;
}

function normalizeLabel(label: string): string {
  // Remove spaces, underscores, dashes and lowercase for comparison
  return label.replace(/[\s_-]/g, '').toLowerCase();
}

function matchLabel(layerLabel: string, sheetLabels: string[]): string | null {
  const normalizedLayerLabel = normalizeLabel(layerLabel);

  for (const sheetLabel of sheetLabels) {
    if (normalizeLabel(sheetLabel) === normalizedLayerLabel) {
      return sheetLabel;
    }
  }

  return null;
}
```

**Test Cases:**

```typescript
// All these should match "First Name" label:
parseLayerName('#First name')      // { labels: ['First name'], ... }
parseLayerName('#first_name')      // { labels: ['first_name'], ... }
parseLayerName('Layer #FIRST-NAME') // { labels: ['FIRST-NAME'], ... }
parseLayerName('#FirstName')       // { labels: ['FirstName'], ... }

// No binding
parseLayerName('Regular Layer')    // { hasBinding: false, ... }

// Multiple labels
parseLayerName('#status #colour')  // { labels: ['status', 'colour'], ... }
```

### Dependencies

TICKET-001

### Acceptance Criteria

- [ ] Extracts single label from `#Label` syntax
- [ ] Extracts multiple labels from layer name
- [ ] Case-insensitive matching works correctly
- [ ] Space/underscore/dash variations match correctly
- [ ] Returns hasBinding: false for layers without `#` syntax
- [ ] Handles edge cases (empty strings, special characters)

---

## TICKET-006: Layer Name Parsing - Worksheet & Index Syntax

**Type:** Feature
**Priority:** High

### Description

Extend the layer name parser to support worksheet specification (`//WorksheetName`) and index specification (`.N`, `.n`, `.i`, `.x`, `.r`) syntaxes.

### Requirements

- Parse `//WorksheetName` syntax for specifying source worksheet
- Parse `.N` syntax for specific index (1-based)
- Parse `.n` syntax for auto-increment
- Parse `.i` syntax for increment ignoring blanks
- Parse `.x` syntax for random index (may include blanks)
- Parse `.r` syntax for random index excluding blanks
- Support worksheet inheritance from parent Frame/Group/Page
- Support index inheritance from parent Frame/Group

### Technical Specifications

**Extended Parser:**

```typescript
function parseLayerName(layerName: string): ParsedLayerName {
  // ... existing label parsing ...

  // Extract worksheet reference (// syntax)
  const worksheetPattern = /\/\/\s*([a-zA-Z0-9_\- ]+?)(?=\s*[#.]|$)/;
  const worksheetMatch = layerName.match(worksheetPattern);
  if (worksheetMatch) {
    result.worksheet = worksheetMatch[1].trim();
  }

  // Extract index specification (must be at end of layer name)
  const indexPatterns = [
    { pattern: /\.(\d+)$/, type: 'specific' as const },
    { pattern: /\.n$/i, type: 'increment' as const },
    { pattern: /\.i$/i, type: 'incrementNonBlank' as const },
    { pattern: /\.x$/i, type: 'random' as const },
    { pattern: /\.r$/i, type: 'randomNonBlank' as const }
  ];

  for (const { pattern, type } of indexPatterns) {
    const match = layerName.match(pattern);
    if (match) {
      result.index = type === 'specific'
        ? { type: 'specific', value: parseInt(match[1], 10) }
        : { type };
      break;
    }
  }

  return result;
}
```

**Inheritance Resolution:**

```typescript
function resolveInheritance(
  node: SceneNode,
  parsedName: ParsedLayerName
): ParsedLayerName {
  let resolved = { ...parsedName };

  // Walk up the tree to find inherited worksheet/index
  let current: BaseNode | null = node.parent;

  while (current && current.type !== 'PAGE' && current.type !== 'DOCUMENT') {
    const parentParsed = parseLayerName(current.name);

    // Inherit worksheet if not specified
    if (!resolved.worksheet && parentParsed.worksheet) {
      resolved.worksheet = parentParsed.worksheet;
    }

    // Inherit index if not specified
    if (!resolved.index && parentParsed.index) {
      resolved.index = parentParsed.index;
    }

    current = current.parent;
  }

  // Also check page name for worksheet
  if (!resolved.worksheet && node.parent) {
    const page = findParentPage(node);
    if (page) {
      const pageParsed = parseLayerName(page.name);
      if (pageParsed.worksheet) {
        resolved.worksheet = pageParsed.worksheet;
      }
    }
  }

  return resolved;
}
```

**Test Cases:**

```typescript
parseLayerName('Page 1 // Properties')     // { worksheet: 'Properties', ... }
parseLayerName('#Title.1')                  // { labels: ['Title'], index: { type: 'specific', value: 1 } }
parseLayerName('#Title.5')                  // { labels: ['Title'], index: { type: 'specific', value: 5 } }
parseLayerName('#Title.n')                  // { labels: ['Title'], index: { type: 'increment' } }
parseLayerName('#Title.i')                  // { labels: ['Title'], index: { type: 'incrementNonBlank' } }
parseLayerName('#Title.x')                  // { labels: ['Title'], index: { type: 'random' } }
parseLayerName('#Title.r')                  // { labels: ['Title'], index: { type: 'randomNonBlank' } }
parseLayerName('Card // Sheet2 #Name.3')   // { worksheet: 'Sheet2', labels: ['Name'], index: { type: 'specific', value: 3 } }
```

### Dependencies

TICKET-005

### Acceptance Criteria

- [ ] Correctly parses `//WorksheetName` syntax
- [ ] Correctly parses all index types (`.N`, `.n`, `.i`, `.x`, `.r`)
- [ ] Worksheet inherits from parent Frame/Group/Page
- [ ] Index inherits from parent Frame/Group
- [ ] Specific index on child overrides inherited index
- [ ] Combined syntax works correctly (worksheet + label + index)

---

## TICKET-007: Layer Traversal Engine

**Type:** Feature
**Priority:** High

### Description

Implement the layer traversal system that walks through the Figma document tree, respects sync scope (document/page/selection), handles layer ignoring, and builds a list of layers to process.

### Requirements

- Support three sync scopes: entire document, current page, current selection
- Respect `-` prefix for ignoring layers and their children
- Ignore main components by default (unless `+` prefixed)
- Handle dynamic page loading for document-wide syncs
- Build an ordered list of layers to process
- Track parent context for worksheet/index inheritance

### Technical Specifications

**Traversal Implementation:**

```typescript
interface TraversalOptions {
  scope: 'document' | 'page' | 'selection';
}

interface LayerToProcess {
  node: SceneNode;
  resolvedBinding: ParsedLayerName;
  depth: number;
}

async function traverseLayers(options: TraversalOptions): Promise<LayerToProcess[]> {
  const layers: LayerToProcess[] = [];

  switch (options.scope) {
    case 'document':
      // Load all pages first (required for dynamic page loading)
      for (const page of figma.root.children) {
        await page.loadAsync();
        await traverseNode(page, layers, 0);
      }
      break;

    case 'page':
      await traverseNode(figma.currentPage, layers, 0);
      break;

    case 'selection':
      for (const node of figma.currentPage.selection) {
        await traverseNode(node, layers, 0);
      }
      break;
  }

  return layers;
}

async function traverseNode(
  node: BaseNode,
  layers: LayerToProcess[],
  depth: number
): Promise<void> {
  // Skip document nodes
  if (node.type === 'DOCUMENT') {
    for (const child of (node as DocumentNode).children) {
      await traverseNode(child, layers, depth);
    }
    return;
  }

  const parsed = parseLayerName(node.name);

  // Check if layer should be ignored
  if (parsed.isIgnored) {
    return; // Skip this layer and all children
  }

  // Check if main component (skip unless force included)
  if (node.type === 'COMPONENT' && !parsed.forceInclude) {
    return; // Skip main components by default
  }

  // Process this layer if it has a binding
  if (parsed.hasBinding && 'name' in node) {
    const resolved = resolveInheritance(node as SceneNode, parsed);
    layers.push({
      node: node as SceneNode,
      resolvedBinding: resolved,
      depth
    });
  }

  // Traverse children
  if ('children' in node) {
    for (const child of (node as ChildrenMixin).children) {
      await traverseNode(child, layers, depth + 1);
    }
  }
}
```

**Scope Detection:**

```typescript
function determineSyncScope(): 'document' | 'page' | 'selection' {
  const selection = figma.currentPage.selection;

  // If layers are selected, offer 'selection' option
  if (selection.length > 0) {
    return 'selection'; // This would be user's choice in UI
  }

  return 'page'; // Default to current page
}

function hasSelection(): boolean {
  return figma.currentPage.selection.length > 0;
}
```

### Dependencies

TICKET-005, TICKET-006

### Acceptance Criteria

- [ ] Traverses all layers when scope is 'document'
- [ ] Traverses only current page layers when scope is 'page'
- [ ] Traverses only selected layers and children when scope is 'selection'
- [ ] Respects `-` prefix and skips ignored layers and their children
- [ ] Skips main components unless `+` prefixed
- [ ] Handles deeply nested layer hierarchies
- [ ] Works with dynamic page loading
- [ ] Maintains correct traversal order (top-to-bottom, depth-first)

---

## TICKET-008: Index Tracking System

**Type:** Feature
**Priority:** High

### Description

Implement the index tracking system that manages which value index to use for each label during sync. Handles auto-increment, random selection, and reset behavior.

### Requirements

- Track current index per label during sync
- Implement auto-increment behavior (`.n` and default)
- Implement increment-ignoring-blanks behavior (`.i`)
- Implement random selection (`.x`) with optional blank skipping (`.r`)
- Reset to beginning when all values exhausted
- Handle random history to avoid immediate repeats

### Technical Specifications

**Index Tracker:**

```typescript
class IndexTracker {
  private incrementCounters: Map<string, number> = new Map();
  private incrementNonBlankCounters: Map<string, number> = new Map();
  private randomHistory: Map<string, Set<number>> = new Map();

  constructor(private sheetData: SheetData) {}

  getNextIndex(
    label: string,
    indexType: IndexType,
    worksheetName?: string
  ): number {
    const worksheet = worksheetName
      ? this.sheetData.worksheets.find(w => w.name === worksheetName)
      : this.sheetData.worksheets[0];

    if (!worksheet) {
      throw new Error(`Worksheet not found: ${worksheetName}`);
    }

    const values = worksheet.rows[label] || [];
    const maxIndex = values.length;

    if (maxIndex === 0) {
      return -1; // No values available
    }

    switch (indexType.type) {
      case 'specific':
        // 1-based index from layer name
        return Math.min(indexType.value - 1, maxIndex - 1);

      case 'increment':
        return this.getIncrementIndex(label, maxIndex, false);

      case 'incrementNonBlank':
        return this.getIncrementIndex(label, maxIndex, true, values);

      case 'random':
        return this.getRandomIndex(label, maxIndex, false, values);

      case 'randomNonBlank':
        return this.getRandomIndex(label, maxIndex, true, values);
    }
  }

  private getIncrementIndex(
    label: string,
    maxIndex: number,
    skipBlanks: boolean,
    values?: string[]
  ): number {
    const counterMap = skipBlanks
      ? this.incrementNonBlankCounters
      : this.incrementCounters;

    let current = counterMap.get(label) ?? 0;

    if (skipBlanks && values) {
      // Find next non-blank value
      while (current < maxIndex && !values[current]?.trim()) {
        current++;
      }
    }

    // Reset if exhausted
    if (current >= maxIndex) {
      current = 0;
      if (skipBlanks && values) {
        while (current < maxIndex && !values[current]?.trim()) {
          current++;
        }
      }
    }

    counterMap.set(label, current + 1);
    return current;
  }

  private getRandomIndex(
    label: string,
    maxIndex: number,
    skipBlanks: boolean,
    values: string[]
  ): number {
    const historyKey = `${label}-${skipBlanks}`;
    let history = this.randomHistory.get(historyKey) ?? new Set();

    // Build available indices
    let available: number[] = [];
    for (let i = 0; i < maxIndex; i++) {
      if (skipBlanks && !values[i]?.trim()) continue;
      if (!history.has(i)) available.push(i);
    }

    // Reset if exhausted
    if (available.length === 0) {
      history = new Set();
      this.randomHistory.set(historyKey, history);
      for (let i = 0; i < maxIndex; i++) {
        if (skipBlanks && !values[i]?.trim()) continue;
        available.push(i);
      }
    }

    // Pick random from available
    const randomIdx = Math.floor(Math.random() * available.length);
    const selected = available[randomIdx];
    history.add(selected);
    this.randomHistory.set(historyKey, history);

    return selected;
  }

  reset(): void {
    this.incrementCounters.clear();
    this.incrementNonBlankCounters.clear();
    this.randomHistory.clear();
  }
}
```

### Dependencies

TICKET-004

### Acceptance Criteria

- [ ] Auto-increment returns sequential indices for same label
- [ ] Specific index returns correct (1-based to 0-based conversion)
- [ ] Increment wraps to beginning when values exhausted
- [ ] Non-blank increment skips empty values
- [ ] Random selection doesn't repeat until all values used
- [ ] Random non-blank skips empty values
- [ ] Reset clears all tracking state

---

## TICKET-009: Text Layer Content Sync

**Type:** Feature
**Priority:** High

### Description

Implement the value application logic for text layers, including font loading, text content replacement, and handling of multi-label bindings.

### Requirements

- Set text content on TextNode layers from sheet values
- Load required fonts before modifying text
- Handle multi-label bindings (apply text from first label, properties from others)
- Preserve existing text styles where possible
- Handle empty values gracefully

### Technical Specifications

**Text Sync Implementation:**

```typescript
async function syncTextLayer(
  node: TextNode,
  value: string,
  additionalValues: string[] = []
): Promise<void> {
  // Load font(s) used by the text node
  await loadFontsForTextNode(node);

  // Check if value is a special data type (starts with /)
  if (value.startsWith('/')) {
    // Handle special data type for text layers
    const specialValue = value.substring(1);
    await applySpecialDataType(node, specialValue);
    return;
  }

  // Set the text content
  node.characters = value;

  // Apply any additional values (special data types from additional labels)
  for (const additionalValue of additionalValues) {
    await applySpecialDataType(node, additionalValue);
  }
}

async function loadFontsForTextNode(node: TextNode): Promise<void> {
  // Get all fonts used in the text node
  const fonts = node.getRangeAllFontNames(0, node.characters.length);

  // Load each unique font
  const uniqueFonts = new Set(fonts.map(f => `${f.family}-${f.style}`));

  for (const font of fonts) {
    try {
      await figma.loadFontAsync(font);
    } catch (error) {
      console.warn(`Could not load font: ${font.family} ${font.style}`);
      // Optionally fall back to a default font
    }
  }
}

// Handle mixed fonts in text
async function loadAllFontsInNode(node: TextNode): Promise<void> {
  if (node.fontName === figma.mixed) {
    // Node has multiple fonts, need to load all
    const len = node.characters.length;
    for (let i = 0; i < len; i++) {
      const font = node.getRangeFontName(i, i + 1) as FontName;
      await figma.loadFontAsync(font);
    }
  } else {
    await figma.loadFontAsync(node.fontName as FontName);
  }
}
```

**Edge Cases:**

```typescript
function handleEmptyValue(node: TextNode, value: string): boolean {
  if (!value || value.trim() === '') {
    // Optionally: leave existing content, or set to empty
    // Based on original plugin behavior, empty values clear the content
    return true;
  }
  return false;
}
```

### Dependencies

TICKET-007, TICKET-008

### Acceptance Criteria

- [ ] Text content updates correctly from sheet values
- [ ] Fonts are loaded before text modification
- [ ] Mixed font text nodes handled correctly
- [ ] Empty values result in empty text (or preserved based on setting)
- [ ] Multi-label binding applies text + special data types
- [ ] Special data type prefix `/` triggers property changes instead of text
- [ ] Error handling for unavailable fonts

---

## TICKET-010: Image Fill Sync from URLs

**Type:** Feature
**Priority:** High

### Description

Implement image downloading and fill application for vector layers when the sheet value is an image URL. Support both direct image URLs and Google Drive share links.

### Requirements

- Detect when a value is an image URL (http:// or https://)
- Download image from URL
- Convert to Figma image hash
- Apply as fill to vector layers
- Support Google Drive share links with automatic URL conversion
- Handle image loading errors gracefully
- Only apply to vector-type layers (not text, frames, or components)

### Technical Specifications

**URL Detection & Conversion:**

```typescript
function isImageUrl(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://');
}

function isGoogleDriveUrl(url: string): boolean {
  return url.includes('drive.google.com');
}

function convertGoogleDriveUrl(url: string): string {
  // Convert Google Drive share URL to direct download URL
  // Share URL: https://drive.google.com/file/d/{FILE_ID}/view?usp=sharing
  // Direct URL: https://drive.google.com/uc?export=download&id={FILE_ID}

  const fileIdMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (fileIdMatch) {
    const fileId = fileIdMatch[1];
    return `https://drive.google.com/uc?export=download&id=${fileId}`;
  }
  return url;
}
```

**Image Fetching & Application:**

```typescript
async function syncImageFill(node: SceneNode, imageUrl: string): Promise<void> {
  // Validate node type - images only work on certain layer types
  if (!canHaveImageFill(node)) {
    console.warn(`Cannot apply image fill to ${node.type} layer: ${node.name}`);
    return;
  }

  try {
    // Convert Google Drive URLs
    const downloadUrl = isGoogleDriveUrl(imageUrl)
      ? convertGoogleDriveUrl(imageUrl)
      : imageUrl;

    // Fetch image in UI context and send to main thread
    // This requires message passing since network access is in UI
    const imageData = await fetchImageFromUI(downloadUrl);

    // Create Figma image from bytes
    const image = figma.createImage(imageData);

    // Apply as fill
    const fills: Paint[] = [{
      type: 'IMAGE',
      scaleMode: 'FILL',
      imageHash: image.hash
    }];

    (node as GeometryMixin).fills = fills;

  } catch (error) {
    console.error(`Failed to load image from ${imageUrl}:`, error);
    figma.notify(`Failed to load image: ${node.name}`, { error: true });
  }
}

function canHaveImageFill(node: SceneNode): boolean {
  // Image fills work on shapes/vectors, not text, frames, or instances
  const validTypes: NodeType[] = [
    'RECTANGLE', 'ELLIPSE', 'POLYGON', 'STAR',
    'VECTOR', 'LINE', 'BOOLEAN_OPERATION'
  ];
  return validTypes.includes(node.type);
}
```

**UI to Main Thread Image Transfer:**

```typescript
// In UI context:
async function fetchImage(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

// Message passing:
// UI -> Main: { type: 'IMAGE_DATA', url: string, data: Uint8Array }
```

### Dependencies

TICKET-007, TICKET-008

### Acceptance Criteria

- [ ] Detects image URLs correctly (http/https)
- [ ] Downloads images from direct URLs
- [ ] Converts and downloads from Google Drive share links
- [ ] Applies image as fill with FILL scale mode
- [ ] Only applies to valid layer types
- [ ] Shows warning for invalid layer types
- [ ] Handles network errors gracefully with user notification
- [ ] Large images load without timeout (reasonable size limits)

---

## TICKET-011: Component Instance Swapping

**Type:** Feature
**Priority:** High

### Description

Implement component swapping functionality for InstanceNode layers, allowing the sheet value to specify which component to swap to by name.

### Requirements

- Detect when a layer is an InstanceNode
- Find target component by name within sync scope
- Perform component swap preserving overrides
- Support Component Variant syntax (`Property=Value, Property=Value`)
- Handle component not found errors
- Only search components within the sync scope area

### Technical Specifications

**Component Finder:**

```typescript
interface ComponentCache {
  components: Map<string, ComponentNode>;
  componentSets: Map<string, ComponentSetNode>;
}

async function buildComponentCache(scope: SceneNode[]): Promise<ComponentCache> {
  const cache: ComponentCache = {
    components: new Map(),
    componentSets: new Map()
  };

  async function findComponents(node: BaseNode): Promise<void> {
    if (node.type === 'COMPONENT') {
      const comp = node as ComponentNode;
      cache.components.set(normalizeComponentName(comp.name), comp);
    } else if (node.type === 'COMPONENT_SET') {
      const set = node as ComponentSetNode;
      cache.componentSets.set(normalizeComponentName(set.name), set);
      // Also cache individual variants
      for (const child of set.children) {
        if (child.type === 'COMPONENT') {
          cache.components.set(normalizeComponentName(child.name), child as ComponentNode);
        }
      }
    } else if (node.type === 'INSTANCE') {
      // Include instances so their main components are available
      const instance = node as InstanceNode;
      if (instance.mainComponent) {
        cache.components.set(
          normalizeComponentName(instance.mainComponent.name),
          instance.mainComponent
        );
      }
    }

    if ('children' in node) {
      for (const child of (node as ChildrenMixin).children) {
        await findComponents(child);
      }
    }
  }

  for (const node of scope) {
    await findComponents(node);
  }

  return cache;
}

function normalizeComponentName(name: string): string {
  // Case-insensitive, but preserve spaces and punctuation
  return name.toLowerCase();
}
```

**Component Swapping:**

```typescript
async function syncComponentSwap(
  node: InstanceNode,
  componentName: string,
  componentCache: ComponentCache
): Promise<void> {
  // Check if this is a variant specification
  if (isVariantSyntax(componentName)) {
    await swapToVariant(node, componentName, componentCache);
    return;
  }

  // Find component by name
  const normalizedName = normalizeComponentName(componentName);
  const targetComponent = componentCache.components.get(normalizedName);

  if (!targetComponent) {
    console.warn(`Component not found: ${componentName}`);
    figma.notify(`Component not found: ${componentName}`, { error: true });
    return;
  }

  // Swap using modern API
  node.swapComponent(targetComponent);
}

function isVariantSyntax(value: string): boolean {
  // Variant syntax: "Property=Value, Property=Value"
  return value.includes('=') && !value.startsWith('http');
}

async function swapToVariant(
  node: InstanceNode,
  variantString: string,
  componentCache: ComponentCache
): Promise<void> {
  // Parse variant properties
  // Format: "Property=Value, Property=Value"
  const normalizedVariant = normalizeComponentName(variantString);

  // Try to find exact variant match
  const targetComponent = componentCache.components.get(normalizedVariant);

  if (targetComponent) {
    node.swapComponent(targetComponent);
  } else {
    console.warn(`Variant not found: ${variantString}`);
    figma.notify(`Variant not found: ${variantString}`, { error: true });
  }
}
```

### Dependencies

TICKET-007, TICKET-008

### Acceptance Criteria

- [ ] Identifies InstanceNode layers correctly
- [ ] Finds components by name (case-insensitive)
- [ ] Swaps component preserving overrides
- [ ] Supports variant syntax `Property=Value, Property=Value`
- [ ] Shows warning when component not found
- [ ] Only searches within sync scope (prevents finding library components not in scope)
- [ ] Handles nested component instances

---

## TICKET-012: Special Data Types - Visibility & Color

**Type:** Feature
**Priority:** Medium

### Description

Implement the special data type parsers and appliers for Show/Hide visibility and fill color modifications.

### Requirements

- Parse and apply `Show`/`Hide` visibility values
- Parse and apply hex color values (`#RGB`, `#RRGGBB`, etc.)
- Support shorthand hex colors (`#A`, `#AB`, `#ABC`)
- Apply fills to groups (recursively to children)
- Handle the `/` prefix requirement for text and instance layers

### Technical Specifications

**Visibility:**

```typescript
function applyVisibility(node: SceneNode, value: string): boolean {
  const normalizedValue = value.toLowerCase().trim();

  if (normalizedValue === 'show') {
    node.visible = true;
    return true;
  } else if (normalizedValue === 'hide') {
    node.visible = false;
    return true;
  }

  return false; // Not a visibility value
}
```

**Color Parsing & Application:**

```typescript
interface RGB {
  r: number;
  g: number;
  b: number;
}

function parseHexColor(value: string): RGB | null {
  if (!value.startsWith('#')) return null;

  const hex = value.substring(1);

  let r: number, g: number, b: number;

  switch (hex.length) {
    case 1:
      // #A -> #AAAAAA
      r = g = b = parseInt(hex + hex, 16);
      break;
    case 2:
      // #AB -> #ABABAB
      r = g = b = parseInt(hex, 16);
      break;
    case 3:
      // #ABC -> #AABBCC
      r = parseInt(hex[0] + hex[0], 16);
      g = parseInt(hex[1] + hex[1], 16);
      b = parseInt(hex[2] + hex[2], 16);
      break;
    case 6:
      // #RRGGBB
      r = parseInt(hex.substring(0, 2), 16);
      g = parseInt(hex.substring(2, 4), 16);
      b = parseInt(hex.substring(4, 6), 16);
      break;
    default:
      return null;
  }

  // Normalize to 0-1 range for Figma
  return {
    r: r / 255,
    g: g / 255,
    b: b / 255
  };
}

function applyFillColor(node: SceneNode, color: RGB): void {
  if ('fills' in node) {
    const solidFill: SolidPaint = {
      type: 'SOLID',
      color: color
    };
    (node as GeometryMixin).fills = [solidFill];
  }

  // For groups, apply to all children
  if (node.type === 'GROUP') {
    for (const child of node.children) {
      applyFillColor(child, color);
    }
  }
}
```

**Special Data Type Dispatcher:**

```typescript
interface SpecialDataTypeResult {
  handled: boolean;
  appliedTypes: string[];
}

async function applySpecialDataType(
  node: SceneNode,
  value: string
): Promise<SpecialDataTypeResult> {
  const result: SpecialDataTypeResult = { handled: false, appliedTypes: [] };

  // Remove leading '/' if present (required for text/instance layers)
  const cleanValue = value.startsWith('/') ? value.substring(1) : value;

  // Try visibility
  if (applyVisibility(node, cleanValue)) {
    result.handled = true;
    result.appliedTypes.push('visibility');
    return result;
  }

  // Try color
  const color = parseHexColor(cleanValue);
  if (color) {
    applyFillColor(node, color);
    result.handled = true;
    result.appliedTypes.push('color');
    return result;
  }

  // ... additional special data types handled in subsequent tickets

  return result;
}
```

### Dependencies

TICKET-007

### Acceptance Criteria

- [ ] `Show` makes layer visible
- [ ] `Hide` makes layer hidden
- [ ] Case-insensitive visibility parsing
- [ ] Parses 6-digit hex colors (#RRGGBB)
- [ ] Parses 3-digit hex colors (#RGB → #RRGGBB)
- [ ] Parses 2-digit hex colors (#AB → #ABABAB)
- [ ] Parses 1-digit hex colors (#A → #AAAAAA)
- [ ] Applies fill color to shape layers
- [ ] Applies fill color recursively to group children
- [ ] Text/Instance layers require `/` prefix

---

## TICKET-013: Special Data Types - Opacity & Dimensions

**Type:** Feature
**Priority:** Medium

### Description

Implement special data type parsers for layer opacity and dimensional properties (size, width, height, position).

### Requirements

- Parse and apply opacity values (`50%`)
- Parse and apply size values (`100s` for both dimensions)
- Parse and apply width values (`100w`)
- Parse and apply height values (`100h`)
- Parse and apply position values (`20x`, `40y`)
- Parse and apply absolute position values (`20xx`, `40yy`)

### Technical Specifications

**Opacity:**

```typescript
function parseOpacity(value: string): number | null {
  const match = value.match(/^(\d+(?:\.\d+)?)\s*%$/);
  if (match) {
    return Math.min(100, Math.max(0, parseFloat(match[1]))) / 100;
  }
  return null;
}

function applyOpacity(node: SceneNode, opacity: number): void {
  if ('opacity' in node) {
    node.opacity = opacity;
  }
}
```

**Dimensions:**

```typescript
interface DimensionValue {
  type: 'size' | 'width' | 'height';
  value: number;
}

function parseDimension(value: string): DimensionValue | null {
  // Size (both dimensions): 100s
  let match = value.match(/^(\d+(?:\.\d+)?)\s*s$/i);
  if (match) {
    return { type: 'size', value: parseFloat(match[1]) };
  }

  // Width only: 100w
  match = value.match(/^(\d+(?:\.\d+)?)\s*w$/i);
  if (match) {
    return { type: 'width', value: parseFloat(match[1]) };
  }

  // Height only: 100h
  match = value.match(/^(\d+(?:\.\d+)?)\s*h$/i);
  if (match) {
    return { type: 'height', value: parseFloat(match[1]) };
  }

  return null;
}

function applyDimension(node: SceneNode, dim: DimensionValue): void {
  if (!('resize' in node)) return;

  const resizable = node as LayoutMixin;

  switch (dim.type) {
    case 'size':
      resizable.resize(dim.value, dim.value);
      break;
    case 'width':
      resizable.resize(dim.value, node.height);
      break;
    case 'height':
      resizable.resize(node.width, dim.value);
      break;
  }
}
```

**Position:**

```typescript
interface PositionValue {
  type: 'relative' | 'absolute';
  axis: 'x' | 'y';
  value: number;
}

function parsePosition(value: string): PositionValue | null {
  // Absolute position: 20xx, 40yy
  let match = value.match(/^(\d+(?:\.\d+)?)\s*(xx|yy)$/i);
  if (match) {
    return {
      type: 'absolute',
      axis: match[2].toLowerCase().charAt(0) as 'x' | 'y',
      value: parseFloat(match[1])
    };
  }

  // Relative position: 20x, 40y
  match = value.match(/^(\d+(?:\.\d+)?)\s*(x|y)$/i);
  if (match) {
    return {
      type: 'relative',
      axis: match[2].toLowerCase() as 'x' | 'y',
      value: parseFloat(match[1])
    };
  }

  return null;
}

function applyPosition(node: SceneNode, pos: PositionValue): void {
  if (pos.type === 'absolute') {
    // Set position relative to page
    if (pos.axis === 'x') {
      node.x = pos.value - (node.absoluteBoundingBox?.x ?? 0) + node.x;
    } else {
      node.y = pos.value - (node.absoluteBoundingBox?.y ?? 0) + node.y;
    }
  } else {
    // Set position relative to parent
    if (pos.axis === 'x') {
      node.x = pos.value;
    } else {
      node.y = pos.value;
    }
  }
}
```

### Dependencies

TICKET-012

### Acceptance Criteria

- [ ] Parses opacity percentages correctly
- [ ] Applies opacity (0-100% mapped to 0-1)
- [ ] Parses and applies uniform size (`100s`)
- [ ] Parses and applies width only (`100w`)
- [ ] Parses and applies height only (`100h`)
- [ ] Parses and applies relative x position (`20x`)
- [ ] Parses and applies relative y position (`40y`)
- [ ] Parses and applies absolute x position (`20xx`)
- [ ] Parses and applies absolute y position (`40yy`)
- [ ] Handles decimal values

---

## TICKET-014: Special Data Types - Rotation & Text Properties

**Type:** Feature
**Priority:** Medium

### Description

Implement special data type parsers for rotation and text-specific properties (alignment, font size, line height, letter spacing).

### Requirements

- Parse and apply rotation values (`30º`)
- Parse and apply text alignment (`text-align:center`)
- Parse and apply vertical text alignment (`text-align-vertical:bottom`)
- Parse and apply font size (`font-size:14`)
- Parse and apply line height (`line-height:auto`, `line-height:40`, `line-height:120%`)
- Parse and apply letter spacing (`letter-spacing:2`, `letter-spacing:10%`)

### Technical Specifications

**Rotation:**

```typescript
function parseRotation(value: string): number | null {
  // Degree symbol: º (Alt+0 on Mac)
  const match = value.match(/^(-?\d+(?:\.\d+)?)\s*º$/);
  if (match) {
    return parseFloat(match[1]);
  }
  return null;
}

function applyRotation(node: SceneNode, degrees: number): void {
  if ('rotation' in node) {
    node.rotation = degrees;
  }
}
```

**Text Alignment:**

```typescript
type HorizontalAlign = 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED';
type VerticalAlign = 'TOP' | 'CENTER' | 'BOTTOM';

function parseTextAlign(value: string): { horizontal?: HorizontalAlign; vertical?: VerticalAlign } | null {
  const result: { horizontal?: HorizontalAlign; vertical?: VerticalAlign } = {};

  // Horizontal alignment
  const hMatch = value.match(/text-align:\s*(left|center|right|justified)/i);
  if (hMatch) {
    result.horizontal = hMatch[1].toUpperCase() as HorizontalAlign;
  }

  // Vertical alignment
  const vMatch = value.match(/text-align-vertical:\s*(top|center|bottom)/i);
  if (vMatch) {
    result.vertical = vMatch[1].toUpperCase() as VerticalAlign;
  }

  return (result.horizontal || result.vertical) ? result : null;
}

async function applyTextAlign(
  node: TextNode,
  alignment: { horizontal?: HorizontalAlign; vertical?: VerticalAlign }
): Promise<void> {
  await loadAllFontsInNode(node);

  if (alignment.horizontal) {
    node.textAlignHorizontal = alignment.horizontal;
  }
  if (alignment.vertical) {
    node.textAlignVertical = alignment.vertical;
  }
}
```

**Font Size:**

```typescript
function parseFontSize(value: string): number | null {
  const match = value.match(/font-size:\s*(\d+(?:\.\d+)?)/i);
  if (match) {
    return parseFloat(match[1]);
  }
  return null;
}

async function applyFontSize(node: TextNode, size: number): Promise<void> {
  await loadAllFontsInNode(node);
  node.fontSize = size;
}
```

**Line Height:**

```typescript
interface LineHeightValue {
  type: 'AUTO' | 'PIXELS' | 'PERCENT';
  value?: number;
}

function parseLineHeight(value: string): LineHeightValue | null {
  const match = value.match(/line-height:\s*(auto|(\d+(?:\.\d+)?)\s*(%)?)/i);
  if (!match) return null;

  if (match[1].toLowerCase() === 'auto') {
    return { type: 'AUTO' };
  }

  const numValue = parseFloat(match[2]);
  if (match[3]) {
    return { type: 'PERCENT', value: numValue };
  }
  return { type: 'PIXELS', value: numValue };
}

async function applyLineHeight(node: TextNode, lh: LineHeightValue): Promise<void> {
  await loadAllFontsInNode(node);

  switch (lh.type) {
    case 'AUTO':
      node.lineHeight = { unit: 'AUTO' };
      break;
    case 'PIXELS':
      node.lineHeight = { unit: 'PIXELS', value: lh.value! };
      break;
    case 'PERCENT':
      node.lineHeight = { unit: 'PERCENT', value: lh.value! };
      break;
  }
}
```

**Letter Spacing:**

```typescript
interface LetterSpacingValue {
  type: 'PIXELS' | 'PERCENT';
  value: number;
}

function parseLetterSpacing(value: string): LetterSpacingValue | null {
  const match = value.match(/letter-spacing:\s*(-?\d+(?:\.\d+)?)\s*(%|px)?/i);
  if (!match) return null;

  const numValue = parseFloat(match[1]);
  const unit = match[2]?.toLowerCase();

  return {
    type: unit === '%' ? 'PERCENT' : 'PIXELS',
    value: numValue
  };
}

async function applyLetterSpacing(node: TextNode, ls: LetterSpacingValue): Promise<void> {
  await loadAllFontsInNode(node);

  node.letterSpacing = {
    unit: ls.type,
    value: ls.value
  };
}
```

### Dependencies

TICKET-012

### Acceptance Criteria

- [ ] Parses rotation with degree symbol
- [ ] Applies rotation correctly
- [ ] Parses horizontal text alignment (left, center, right, justified)
- [ ] Parses vertical text alignment (top, center, bottom)
- [ ] Applies text alignments to text nodes
- [ ] Parses font-size values
- [ ] Parses line-height (auto, px, %)
- [ ] Parses letter-spacing (px, %)
- [ ] All text properties load fonts before modification
- [ ] Handles case-insensitive property names

---

## TICKET-015: Chained Special Data Types

**Type:** Feature
**Priority:** Medium

### Description

Implement the ability to chain multiple special data types in a single value, separated by spaces or commas.

### Requirements

- Parse multiple special data types from a single value string
- Apply all parsed types in sequence
- Support comma separation and space separation
- Handle conflicts (e.g., multiple colors) by using last value

### Technical Specifications

**Chained Parser:**

```typescript
interface ParsedSpecialValue {
  visibility?: 'show' | 'hide';
  color?: RGB;
  opacity?: number;
  dimension?: DimensionValue;
  position?: PositionValue;
  rotation?: number;
  textAlign?: { horizontal?: HorizontalAlign; vertical?: VerticalAlign };
  fontSize?: number;
  lineHeight?: LineHeightValue;
  letterSpacing?: LetterSpacingValue;
}

function parseChainedSpecialTypes(value: string): ParsedSpecialValue {
  const result: ParsedSpecialValue = {};

  // Remove leading '/' if present
  const cleanValue = value.startsWith('/') ? value.substring(1) : value;

  // Split by comma or space (but not inside property values like "text-align:center")
  const parts = cleanValue.split(/[,\s]+/).filter(p => p.trim());

  // Rejoin property:value pairs that were split
  const tokens: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].includes(':') && !parts[i].match(/:\s*\S/)) {
      // Property name without value, next part is the value
      tokens.push(parts[i] + parts[i + 1]);
      i++;
    } else {
      tokens.push(parts[i]);
    }
  }

  for (const token of tokens) {
    // Try each parser
    if (token.toLowerCase() === 'show' || token.toLowerCase() === 'hide') {
      result.visibility = token.toLowerCase() as 'show' | 'hide';
      continue;
    }

    const color = parseHexColor(token);
    if (color) {
      result.color = color;
      continue;
    }

    const opacity = parseOpacity(token);
    if (opacity !== null) {
      result.opacity = opacity;
      continue;
    }

    const dimension = parseDimension(token);
    if (dimension) {
      result.dimension = dimension;
      continue;
    }

    const position = parsePosition(token);
    if (position) {
      result.position = position;
      continue;
    }

    const rotation = parseRotation(token);
    if (rotation !== null) {
      result.rotation = rotation;
      continue;
    }

    // Text properties
    const textAlign = parseTextAlign(token);
    if (textAlign) {
      result.textAlign = { ...result.textAlign, ...textAlign };
      continue;
    }

    const fontSize = parseFontSize(token);
    if (fontSize !== null) {
      result.fontSize = fontSize;
      continue;
    }

    const lineHeight = parseLineHeight(token);
    if (lineHeight) {
      result.lineHeight = lineHeight;
      continue;
    }

    const letterSpacing = parseLetterSpacing(token);
    if (letterSpacing) {
      result.letterSpacing = letterSpacing;
      continue;
    }
  }

  return result;
}
```

**Chained Applier:**

```typescript
async function applyChainedSpecialTypes(
  node: SceneNode,
  parsed: ParsedSpecialValue
): Promise<void> {
  if (parsed.visibility) {
    applyVisibility(node, parsed.visibility);
  }

  if (parsed.color) {
    applyFillColor(node, parsed.color);
  }

  if (parsed.opacity !== undefined) {
    applyOpacity(node, parsed.opacity);
  }

  if (parsed.dimension) {
    applyDimension(node, parsed.dimension);
  }

  if (parsed.position) {
    applyPosition(node, parsed.position);
  }

  if (parsed.rotation !== undefined) {
    applyRotation(node, parsed.rotation);
  }

  // Text-specific properties
  if (node.type === 'TEXT') {
    const textNode = node as TextNode;

    if (parsed.textAlign) {
      await applyTextAlign(textNode, parsed.textAlign);
    }

    if (parsed.fontSize !== undefined) {
      await applyFontSize(textNode, parsed.fontSize);
    }

    if (parsed.lineHeight) {
      await applyLineHeight(textNode, parsed.lineHeight);
    }

    if (parsed.letterSpacing) {
      await applyLetterSpacing(textNode, parsed.letterSpacing);
    }
  }
}
```

**Example:**

```typescript
// Input: "letter-spacing:4px, #f00, 30%, 20º, text-align:center"
// Result: {
//   letterSpacing: { type: 'PIXELS', value: 4 },
//   color: { r: 1, g: 0, b: 0 },
//   opacity: 0.3,
//   rotation: 20,
//   textAlign: { horizontal: 'CENTER' }
// }
```

### Dependencies

TICKET-012, TICKET-013, TICKET-014

### Acceptance Criteria

- [ ] Parses multiple comma-separated values
- [ ] Parses multiple space-separated values
- [ ] Applies all parsed properties to node
- [ ] Later values override earlier ones (e.g., second color wins)
- [ ] Handles mixed separators
- [ ] Text properties only apply to text nodes

---

## TICKET-016: Layer Repetition (Auto-Duplication)

**Type:** Feature
**Priority:** Medium

### Description

Implement the `@#` syntax for auto-layout frames that automatically duplicates the first child to match the number of data rows in the sheet.

### Requirements

- Detect `@#` in auto-layout frame names
- Count the number of values for the referenced label
- Duplicate or remove children to match the count
- Preserve the first child as the template
- Only works on frames with auto-layout enabled

### Technical Specifications

**Detection & Validation:**

```typescript
interface RepeatConfig {
  isRepeatFrame: boolean;
  hasAutoLayout: boolean;
}

function detectRepeatFrame(node: SceneNode): RepeatConfig {
  if (node.type !== 'FRAME') {
    return { isRepeatFrame: false, hasAutoLayout: false };
  }

  const frame = node as FrameNode;
  const hasRepeatSyntax = frame.name.includes('@#');
  const hasAutoLayout = frame.layoutMode !== 'NONE';

  return {
    isRepeatFrame: hasRepeatSyntax,
    hasAutoLayout
  };
}
```

**Repetition Logic:**

```typescript
async function processRepeatFrame(
  frame: FrameNode,
  sheetData: SheetData,
  worksheetName?: string
): Promise<void> {
  const config = detectRepeatFrame(frame);

  if (!config.isRepeatFrame) return;

  if (!config.hasAutoLayout) {
    console.warn(`Frame "${frame.name}" has @# but no auto-layout. Skipping repetition.`);
    figma.notify(`Auto-layout required for repetition: ${frame.name}`, { error: true });
    return;
  }

  if (frame.children.length === 0) {
    console.warn(`Frame "${frame.name}" has no children to duplicate.`);
    return;
  }

  // Determine target count from sheet data
  const worksheet = worksheetName
    ? sheetData.worksheets.find(w => w.name === worksheetName)
    : sheetData.worksheets[0];

  if (!worksheet) return;

  // Find the first label referenced in children to determine count
  const targetCount = getValueCountForRepeatFrame(frame, worksheet);

  if (targetCount <= 0) return;

  const currentCount = frame.children.length;
  const template = frame.children[0];

  if (currentCount < targetCount) {
    // Need to add children
    for (let i = currentCount; i < targetCount; i++) {
      const clone = template.clone();
      frame.appendChild(clone);
    }
  } else if (currentCount > targetCount) {
    // Need to remove children (from the end, preserving template)
    for (let i = currentCount - 1; i >= targetCount; i--) {
      frame.children[i].remove();
    }
  }
}

function getValueCountForRepeatFrame(
  frame: FrameNode,
  worksheet: Worksheet
): number {
  // Find the first label in any descendant
  function findFirstLabel(node: BaseNode): string | null {
    const parsed = parseLayerName(node.name);
    if (parsed.labels.length > 0) {
      return parsed.labels[0];
    }

    if ('children' in node) {
      for (const child of (node as ChildrenMixin).children) {
        const found = findFirstLabel(child);
        if (found) return found;
      }
    }

    return null;
  }

  const label = findFirstLabel(frame);
  if (!label) return 0;

  const matchedLabel = matchLabel(label, Object.keys(worksheet.rows));
  if (!matchedLabel) return 0;

  return worksheet.rows[matchedLabel].length;
}
```

**Processing Order:**

Repeat frames should be processed before their children are synced, so the children exist before attempting to apply values.

```typescript
async function syncWithRepetition(
  layers: LayerToProcess[],
  sheetData: SheetData
): Promise<void> {
  // First pass: process repeat frames
  for (const layer of layers) {
    if (layer.node.type === 'FRAME') {
      await processRepeatFrame(
        layer.node as FrameNode,
        sheetData,
        layer.resolvedBinding.worksheet
      );
    }
  }

  // Re-traverse to pick up duplicated layers
  // ... then apply values
}
```

### Dependencies

TICKET-007, TICKET-008

### Acceptance Criteria

- [ ] Detects `@#` syntax in frame names
- [ ] Validates auto-layout is enabled
- [ ] Duplicates first child to match data row count
- [ ] Removes excess children when data has fewer rows
- [ ] Preserves template (first child) properties
- [ ] Shows warning if no auto-layout
- [ ] Works with nested repeat frames
- [ ] Handles empty frames gracefully

---

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

---

## TICKET-018: Plugin UI - Data Preview Mode

**Type:** Feature
**Priority:** Medium

### Description

Implement the data preview interface that displays fetched sheet data in a table format, allows worksheet switching, and enables click-to-rename functionality for layer naming.

### Requirements

- Display sheet data in a table format
- Show labels as column/row headers
- Tab interface for multiple worksheets
- Clickable cells that rename selected Figma layers
- "Sync" button to proceed with sync after preview
- Visual indication of clickable elements

### Technical Specifications

**Preview Table Component:**

```typescript
interface PreviewTableProps {
  worksheet: Worksheet;
  onLabelClick: (label: string) => void;
  onCellClick: (label: string, index: number, value: string) => void;
  onIndexClick: (index: number) => void;
}

function PreviewTable({ worksheet, onLabelClick, onCellClick, onIndexClick }: PreviewTableProps) {
  return (
    <div className="preview-table-container">
      <table className="preview-table">
        <thead>
          <tr>
            <th>#</th>
            {worksheet.labels.map(label => (
              <th
                key={label}
                className="clickable-header"
                onClick={() => onLabelClick(label)}
                title={`Click to name selected layers #${label}`}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {getValueRows(worksheet).map((row, rowIndex) => (
            <tr key={rowIndex}>
              <td
                className="index-cell clickable"
                onClick={() => onIndexClick(rowIndex + 1)}
                title={`Click to add .${rowIndex + 1} to selected layer names`}
              >
                {rowIndex + 1}
              </td>
              {row.map((value, colIndex) => (
                <td
                  key={colIndex}
                  className="value-cell clickable"
                  onClick={() => onCellClick(
                    worksheet.labels[colIndex],
                    rowIndex + 1,
                    value
                  )}
                  title="Click to name layer with this specific value"
                >
                  {truncateValue(value, 50)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function getValueRows(worksheet: Worksheet): string[][] {
  const maxRows = Math.max(
    ...worksheet.labels.map(l => worksheet.rows[l]?.length ?? 0)
  );

  const rows: string[][] = [];
  for (let i = 0; i < maxRows; i++) {
    rows.push(worksheet.labels.map(l => worksheet.rows[l]?.[i] ?? ''));
  }
  return rows;
}
```

**Worksheet Tabs:**

```typescript
interface WorksheetTabsProps {
  worksheets: Worksheet[];
  activeWorksheet: string;
  onTabClick: (worksheetName: string) => void;
}

function WorksheetTabs({ worksheets, activeWorksheet, onTabClick }: WorksheetTabsProps) {
  return (
    <div className="worksheet-tabs">
      {worksheets.map(ws => (
        <button
          key={ws.name}
          className={`tab ${ws.name === activeWorksheet ? 'active' : ''}`}
          onClick={() => onTabClick(ws.name)}
        >
          {ws.name}
        </button>
      ))}
    </div>
  );
}
```

**Layer Renaming Messages:**

```typescript
// When user clicks a label header
function handleLabelClick(label: string): void {
  parent.postMessage({
    type: 'RENAME_SELECTION',
    payload: {
      nameSuffix: `#${label}`
    }
  }, '*');
}

// When user clicks a specific cell
function handleCellClick(label: string, index: number, value: string): void {
  parent.postMessage({
    type: 'RENAME_SELECTION',
    payload: {
      nameSuffix: `#${label}.${index}`
    }
  }, '*');
}

// When user clicks an index number
function handleIndexClick(index: number): void {
  parent.postMessage({
    type: 'RENAME_SELECTION',
    payload: {
      nameSuffix: `.${index}`
    }
  }, '*');
}
```

**Plugin-side Rename Handler:**

```typescript
function handleRenameSelection(nameSuffix: string): void {
  const selection = figma.currentPage.selection;

  for (const node of selection) {
    // Append suffix to existing name
    node.name = `${node.name} ${nameSuffix}`;
  }

  figma.notify(`Renamed ${selection.length} layer(s)`);
}
```

### Dependencies

TICKET-017

### Acceptance Criteria

- [ ] Displays sheet data in readable table format
- [ ] Shows all worksheets as clickable tabs
- [ ] Clicking label header renames selected layers with `#Label`
- [ ] Clicking cell renames selected layers with `#Label.Index`
- [ ] Clicking index adds `.Index` to selected layer names
- [ ] Sync button appears in preview mode
- [ ] Hovering shows helpful tooltips
- [ ] Long values are truncated with ellipsis
- [ ] Empty cells display appropriately

---

## TICKET-019: Sync Engine - Main Orchestration

**Type:** Feature
**Priority:** High

### Description

Implement the main sync engine that orchestrates the entire sync process: fetching data, traversing layers, matching values, and applying changes.

### Requirements

- Coordinate all sync phases in correct order
- Handle repeat frames before other layers
- Build component cache before component swapping
- Manage index trackers across sync
- Provide progress feedback
- Handle errors gracefully with partial success
- Generate sync report/summary

### Technical Specifications

**Sync Engine:**

```typescript
interface SyncOptions {
  url: string;
  scope: 'document' | 'page' | 'selection';
}

interface SyncResult {
  success: boolean;
  layersProcessed: number;
  layersUpdated: number;
  errors: SyncError[];
  warnings: string[];
}

interface SyncError {
  layerName: string;
  layerId: string;
  error: string;
}

async function runSync(options: SyncOptions): Promise<SyncResult> {
  const result: SyncResult = {
    success: true,
    layersProcessed: 0,
    layersUpdated: 0,
    errors: [],
    warnings: []
  };

  try {
    // Phase 1: Parse URL and fetch sheet data
    sendProgress('Fetching sheet data...', 0);
    const parsedUrl = parseGoogleSheetsUrl(options.url);
    if (!parsedUrl.isValid) {
      throw new Error(parsedUrl.errorMessage);
    }

    const sheetData = await fetchSheetData(parsedUrl.spreadsheetId);

    // Phase 2: Build component cache
    sendProgress('Building component cache...', 20);
    const scopeNodes = getScopeNodes(options.scope);
    const componentCache = await buildComponentCache(scopeNodes);

    // Phase 3: First traversal - process repeat frames
    sendProgress('Processing repeat frames...', 40);
    const layers = await traverseLayers({ scope: options.scope });

    for (const layer of layers) {
      if (layer.node.type === 'FRAME') {
        await processRepeatFrame(
          layer.node as FrameNode,
          sheetData,
          layer.resolvedBinding.worksheet
        );
      }
    }

    // Phase 4: Re-traverse to pick up duplicated layers
    sendProgress('Syncing layer content...', 60);
    const finalLayers = await traverseLayers({ scope: options.scope });

    // Phase 5: Initialize index tracker
    const indexTracker = new IndexTracker(sheetData);

    // Phase 6: Process each layer
    const totalLayers = finalLayers.length;
    for (let i = 0; i < finalLayers.length; i++) {
      const layer = finalLayers[i];
      result.layersProcessed++;

      try {
        const updated = await processLayer(
          layer,
          sheetData,
          indexTracker,
          componentCache
        );

        if (updated) {
          result.layersUpdated++;
        }
      } catch (error) {
        result.errors.push({
          layerName: layer.node.name,
          layerId: layer.node.id,
          error: error.message
        });
      }

      // Update progress
      const progress = 60 + (40 * (i / totalLayers));
      sendProgress(`Processing ${layer.node.name}...`, progress);
    }

    // Phase 7: Store last URL
    await figma.clientStorage.setAsync('lastUrl', options.url);

    sendProgress('Complete!', 100);

  } catch (error) {
    result.success = false;
    result.errors.push({
      layerName: '',
      layerId: '',
      error: error.message
    });
  }

  return result;
}

function getScopeNodes(scope: 'document' | 'page' | 'selection'): SceneNode[] {
  switch (scope) {
    case 'document':
      return figma.root.children.flatMap(page => page.children);
    case 'page':
      return [...figma.currentPage.children];
    case 'selection':
      return [...figma.currentPage.selection];
  }
}

function sendProgress(message: string, percent: number): void {
  figma.ui.postMessage({
    type: 'PROGRESS',
    payload: { message, progress: percent }
  });
}
```

**Layer Processing:**

```typescript
async function processLayer(
  layer: LayerToProcess,
  sheetData: SheetData,
  indexTracker: IndexTracker,
  componentCache: ComponentCache
): Promise<boolean> {
  const { node, resolvedBinding } = layer;

  if (!resolvedBinding.hasBinding || resolvedBinding.labels.length === 0) {
    return false;
  }

  // Get worksheet
  const worksheet = resolvedBinding.worksheet
    ? sheetData.worksheets.find(w =>
        normalizeLabel(w.name) === normalizeLabel(resolvedBinding.worksheet!)
      )
    : sheetData.worksheets[0];

  if (!worksheet) {
    throw new Error(`Worksheet not found: ${resolvedBinding.worksheet}`);
  }

  // Get primary value
  const primaryLabel = resolvedBinding.labels[0];
  const matchedLabel = matchLabel(primaryLabel, Object.keys(worksheet.rows));

  if (!matchedLabel) {
    return false; // No matching label in sheet
  }

  const indexType = resolvedBinding.index ?? { type: 'increment' as const };
  const index = indexTracker.getNextIndex(matchedLabel, indexType, worksheet.name);

  if (index < 0) {
    return false; // No values available
  }

  const value = worksheet.rows[matchedLabel][index];

  // Get additional values for multi-label layers
  const additionalValues: string[] = [];
  for (let i = 1; i < resolvedBinding.labels.length; i++) {
    const addLabel = resolvedBinding.labels[i];
    const addMatchedLabel = matchLabel(addLabel, Object.keys(worksheet.rows));
    if (addMatchedLabel) {
      const addValue = worksheet.rows[addMatchedLabel][index];
      if (addValue) additionalValues.push(addValue);
    }
  }

  // Apply value based on node type
  return await applyValue(node, value, additionalValues, componentCache);
}

async function applyValue(
  node: SceneNode,
  value: string,
  additionalValues: string[],
  componentCache: ComponentCache
): Promise<boolean> {
  if (!value && additionalValues.length === 0) {
    return false;
  }

  // Determine how to apply based on node type and value type

  if (node.type === 'TEXT') {
    // Check for special data type prefix
    if (value.startsWith('/')) {
      const parsed = parseChainedSpecialTypes(value);
      await applyChainedSpecialTypes(node, parsed);
    } else {
      await syncTextLayer(node as TextNode, value, additionalValues);
    }
    return true;
  }

  if (node.type === 'INSTANCE') {
    // Check for special data type prefix
    if (value.startsWith('/')) {
      const parsed = parseChainedSpecialTypes(value);
      await applyChainedSpecialTypes(node, parsed);
    } else {
      // Assume component swap
      await syncComponentSwap(node as InstanceNode, value, componentCache);
    }
    return true;
  }

  // For other layer types
  if (isImageUrl(value)) {
    await syncImageFill(node, value);
    return true;
  }

  // Try special data types
  const parsed = parseChainedSpecialTypes(value);
  if (Object.keys(parsed).length > 0) {
    await applyChainedSpecialTypes(node, parsed);
    return true;
  }

  return false;
}
```

### Dependencies

TICKET-003 through TICKET-016

### Acceptance Criteria

- [ ] Completes sync process end-to-end
- [ ] Processes repeat frames before content sync
- [ ] Builds component cache correctly
- [ ] Tracks indices per label throughout sync
- [ ] Reports progress to UI
- [ ] Continues on individual layer errors
- [ ] Returns comprehensive sync result
- [ ] Stores last URL for re-sync feature

---

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

---

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

---

## TICKET-022: Performance Optimization

**Type:** Enhancement
**Priority:** Medium

### Description

Optimize plugin performance for large documents with many layers, including batching operations, minimizing traversals, and efficient data structures.

### Requirements

- Minimize document traversals
- Batch node modifications where possible
- Use efficient data structures for lookups
- Implement progress feedback for long operations
- Consider pagination for very large sheets
- Optimize font loading (deduplicate)

### Technical Specifications

**Batched Operations:**

```typescript
// Batch font loading
async function loadFontsForDocument(layers: LayerToProcess[]): Promise<Set<string>> {
  const fontsNeeded = new Set<string>();
  const loadedFonts = new Set<string>();

  // Collect all fonts needed
  for (const layer of layers) {
    if (layer.node.type === 'TEXT') {
      const textNode = layer.node as TextNode;

      if (textNode.fontName === figma.mixed) {
        const len = textNode.characters.length;
        for (let i = 0; i < len; i++) {
          const font = textNode.getRangeFontName(i, i + 1) as FontName;
          fontsNeeded.add(`${font.family}::${font.style}`);
        }
      } else {
        const font = textNode.fontName as FontName;
        fontsNeeded.add(`${font.family}::${font.style}`);
      }
    }
  }

  // Load all fonts in parallel
  const loadPromises: Promise<void>[] = [];
  for (const fontKey of fontsNeeded) {
    const [family, style] = fontKey.split('::');
    loadPromises.push(
      figma.loadFontAsync({ family, style })
        .then(() => { loadedFonts.add(fontKey); })
        .catch(err => console.warn(`Failed to load font: ${fontKey}`, err))
    );
  }

  await Promise.all(loadPromises);
  return loadedFonts;
}
```

**Efficient Component Cache:**

```typescript
class ComponentCache {
  private byName: Map<string, ComponentNode> = new Map();
  private byKey: Map<string, ComponentNode> = new Map();

  add(component: ComponentNode): void {
    this.byName.set(normalizeComponentName(component.name), component);
    if (component.key) {
      this.byKey.set(component.key, component);
    }
  }

  findByName(name: string): ComponentNode | undefined {
    return this.byName.get(normalizeComponentName(name));
  }

  // O(1) lookups instead of traversing each time
}
```

**Single-Pass Traversal:**

```typescript
interface TraversalResult {
  layers: LayerToProcess[];
  repeatFrames: FrameNode[];
  componentCache: ComponentCache;
}

async function singlePassTraversal(scope: SceneNode[]): Promise<TraversalResult> {
  const result: TraversalResult = {
    layers: [],
    repeatFrames: [],
    componentCache: new ComponentCache()
  };

  async function traverse(node: BaseNode, depth: number): Promise<void> {
    // Collect component cache entries
    if (node.type === 'COMPONENT') {
      result.componentCache.add(node as ComponentNode);
    }
    if (node.type === 'INSTANCE') {
      const main = (node as InstanceNode).mainComponent;
      if (main) result.componentCache.add(main);
    }

    const parsed = parseLayerName(node.name);

    if (parsed.isIgnored) return;

    // Check for repeat frame
    if (node.type === 'FRAME' && node.name.includes('@#')) {
      result.repeatFrames.push(node as FrameNode);
    }

    // Collect layer if it has binding
    if (parsed.hasBinding && 'name' in node) {
      result.layers.push({
        node: node as SceneNode,
        resolvedBinding: resolveInheritance(node as SceneNode, parsed),
        depth
      });
    }

    // Traverse children
    if ('children' in node) {
      for (const child of (node as ChildrenMixin).children) {
        await traverse(child, depth + 1);
      }
    }
  }

  for (const node of scope) {
    await traverse(node, 0);
  }

  return result;
}
```

**Progress Chunking:**

```typescript
async function processLayersWithProgress(
  layers: LayerToProcess[],
  processor: (layer: LayerToProcess) => Promise<void>
): Promise<void> {
  const CHUNK_SIZE = 50;
  const total = layers.length;

  for (let i = 0; i < total; i += CHUNK_SIZE) {
    const chunk = layers.slice(i, i + CHUNK_SIZE);

    // Process chunk
    await Promise.all(chunk.map(processor));

    // Report progress
    const progress = Math.min(100, ((i + chunk.length) / total) * 100);
    sendProgress(`Processing layers... (${i + chunk.length}/${total})`, progress);

    // Yield to UI thread
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}
```

### Dependencies

TICKET-019

### Acceptance Criteria

- [ ] Single traversal collects all needed data
- [ ] Font loading is deduplicated
- [ ] Component lookups are O(1)
- [ ] Progress updates don't freeze UI
- [ ] Large documents (1000+ layers) sync in reasonable time
- [ ] Memory usage remains stable during sync

---

## TICKET-023: Unit Tests & Integration Tests

**Type:** Technical Task
**Priority:** Medium

### Description

Implement comprehensive test coverage for core plugin functionality including unit tests for parsers and integration tests for sync operations.

### Requirements

- Unit tests for URL parsing
- Unit tests for layer name parsing
- Unit tests for special data type parsing
- Unit tests for sheet data normalization
- Integration tests for sync scenarios
- Mock Figma API for testing

### Technical Specifications

**Test Setup:**

```typescript
// jest.config.js or vitest.config.ts
export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  setupFilesAfterEnv: ['./tests/setup.ts'],
  moduleNameMapper: {
    // Mock Figma globals
  }
};

// tests/setup.ts
import { mockFigmaAPI } from './mocks/figma';
globalThis.figma = mockFigmaAPI();
```

**Parser Tests:**

```typescript
// tests/parsers/layerName.test.ts
import { parseLayerName, normalizeLabel, matchLabel } from '../../src/core/parser';

describe('parseLayerName', () => {
  describe('label extraction', () => {
    it('extracts single label', () => {
      const result = parseLayerName('#Title');
      expect(result.hasBinding).toBe(true);
      expect(result.labels).toEqual(['Title']);
    });

    it('extracts multiple labels', () => {
      const result = parseLayerName('#status #colour');
      expect(result.labels).toEqual(['status', 'colour']);
    });

    it('handles no binding', () => {
      const result = parseLayerName('Regular Layer');
      expect(result.hasBinding).toBe(false);
    });
  });

  describe('worksheet extraction', () => {
    it('extracts worksheet reference', () => {
      const result = parseLayerName('Page 1 // Properties');
      expect(result.worksheet).toBe('Properties');
    });
  });

  describe('index extraction', () => {
    it('extracts specific index', () => {
      const result = parseLayerName('#Title.5');
      expect(result.index).toEqual({ type: 'specific', value: 5 });
    });

    it('extracts increment index', () => {
      const result = parseLayerName('#Title.n');
      expect(result.index).toEqual({ type: 'increment' });
    });

    // ... more index tests
  });

  describe('ignore prefix', () => {
    it('detects ignore prefix', () => {
      const result = parseLayerName('-Dashboard');
      expect(result.isIgnored).toBe(true);
    });
  });
});

describe('normalizeLabel', () => {
  it('removes spaces', () => {
    expect(normalizeLabel('First Name')).toBe('firstname');
  });

  it('removes underscores', () => {
    expect(normalizeLabel('first_name')).toBe('firstname');
  });

  it('lowercases', () => {
    expect(normalizeLabel('TITLE')).toBe('title');
  });
});

describe('matchLabel', () => {
  const sheetLabels = ['First Name', 'Email', 'Status'];

  it('matches exact case', () => {
    expect(matchLabel('First Name', sheetLabels)).toBe('First Name');
  });

  it('matches different case', () => {
    expect(matchLabel('FIRST NAME', sheetLabels)).toBe('First Name');
  });

  it('matches with underscores', () => {
    expect(matchLabel('first_name', sheetLabels)).toBe('First Name');
  });

  it('returns null for no match', () => {
    expect(matchLabel('Unknown', sheetLabels)).toBeNull();
  });
});
```

**Special Data Type Tests:**

```typescript
// tests/parsers/specialDataTypes.test.ts
import {
  parseHexColor,
  parseOpacity,
  parseDimension,
  parseChainedSpecialTypes
} from '../../src/core/specialDataTypes';

describe('parseHexColor', () => {
  it('parses 6-digit hex', () => {
    expect(parseHexColor('#FF0000')).toEqual({ r: 1, g: 0, b: 0 });
  });

  it('parses 3-digit hex', () => {
    expect(parseHexColor('#F00')).toEqual({ r: 1, g: 0, b: 0 });
  });

  it('parses 1-digit hex', () => {
    expect(parseHexColor('#A')).toEqual({ r: 0.667, g: 0.667, b: 0.667 });
  });

  it('returns null for non-hex', () => {
    expect(parseHexColor('red')).toBeNull();
  });
});

describe('parseChainedSpecialTypes', () => {
  it('parses multiple types', () => {
    const result = parseChainedSpecialTypes('#f00, 50%, 20º');
    expect(result.color).toEqual({ r: 1, g: 0, b: 0 });
    expect(result.opacity).toBe(0.5);
    expect(result.rotation).toBe(20);
  });
});
```

**Integration Tests:**

```typescript
// tests/integration/sync.test.ts
import { runSync } from '../../src/core/syncEngine';
import { createMockDocument } from '../mocks/figma';

describe('Sync Integration', () => {
  beforeEach(() => {
    // Reset mock document
    figma.root = createMockDocument();
  });

  it('syncs text content correctly', async () => {
    // Setup mock sheet data
    // Setup mock text layer
    // Run sync
    // Assert text content updated
  });

  it('handles repeat frames', async () => {
    // Setup mock with auto-layout frame
    // Run sync
    // Assert children duplicated
  });
});
```

### Dependencies

All feature tickets

### Acceptance Criteria

- [ ] 80%+ code coverage on core modules
- [ ] All parser edge cases tested
- [ ] Integration tests cover main sync scenarios
- [ ] Tests run in CI pipeline
- [ ] Mock Figma API is comprehensive enough for testing

---

## TICKET-024: Documentation & README

**Type:** Technical Task
**Priority:** Low

### Description

Create comprehensive documentation for the plugin including user guide, developer documentation, and API reference.

### Requirements

- User-facing documentation (how to use)
- Developer setup instructions
- API/architecture documentation
- Inline code documentation
- Example use cases

### Technical Specifications

**README.md Structure:**

```markdown
# Sheets Sync for Figma

Sync content from Google Sheets into your Figma designs.

## Features
- Sync text content from spreadsheets
- Load images from URLs
- Swap components based on data
- Repeat layers automatically
- Apply styling (colors, opacity, size, etc.)

## Installation
[Instructions for installing from Figma Community]

## Quick Start
1. Make sure your Google Sheet is set to "Anyone with the link can view"
2. Name your Figma layers with `#` followed by the column name
3. Run the plugin and paste your sheet URL
4. Click "Fetch & Sync"

## Layer Naming Reference

### Basic Syntax
- `#ColumnName` - Sync content from the named column
- `//WorksheetName` - Use a specific worksheet tab
- `.N` - Use a specific row (1-based)
- `.n` - Auto-increment through rows
- `.x` - Random row selection

### Examples
| Layer Name | Result |
|------------|--------|
| `#Title` | First available title value |
| `#Price.5` | 5th price value |
| `Card // Products #Name.n` | Names from Products sheet, incrementing |

## Special Data Types
[Table of all special data types with examples]

## Development

### Setup
\`\`\`bash
npm install
npm run dev
\`\`\`

### Building
\`\`\`bash
npm run build
\`\`\`

### Testing
\`\`\`bash
npm test
\`\`\`

## Architecture
[High-level architecture diagram and explanation]

## Contributing
[Contribution guidelines]

## License
MIT
```

**Inline Documentation:**

```typescript
/**
 * Parses a Figma layer name to extract data binding instructions.
 *
 * @param layerName - The name of the Figma layer
 * @returns Parsed binding information including labels, worksheet, and index
 *
 * @example
 * // Basic label
 * parseLayerName('#Title')
 * // => { hasBinding: true, labels: ['Title'], ... }
 *
 * @example
 * // With worksheet and index
 * parseLayerName('Card // Products #Name.5')
 * // => { hasBinding: true, labels: ['Name'], worksheet: 'Products', index: { type: 'specific', value: 5 } }
 */
function parseLayerName(layerName: string): ParsedLayerName {
  // ...
}
```

### Dependencies

All feature tickets

### Acceptance Criteria

- [ ] README covers all features with examples
- [ ] Developer can set up project from README
- [ ] All public functions have JSDoc comments
- [ ] Example use cases demonstrate common scenarios
- [ ] Architecture is documented for future maintenance

---

## TICKET-025: Accessibility & Keyboard Navigation

**Type:** Enhancement
**Priority:** Low

### Description

Ensure the plugin UI is accessible and supports keyboard navigation following WCAG guidelines.

### Requirements

- All interactive elements are keyboard accessible
- Focus states are visible
- Screen reader compatible labels
- Sufficient color contrast
- Error messages are announced
- Tab order is logical

### Technical Specifications

**Focus Management:**

```css
/* Visible focus states */
button:focus-visible,
input:focus-visible,
[role="tab"]:focus-visible {
  outline: 2px solid #18A0FB;
  outline-offset: 2px;
}

/* Don't show focus for mouse users */
button:focus:not(:focus-visible) {
  outline: none;
}
```

**ARIA Labels:**

```html
<section aria-labelledby="url-label">
  <label id="url-label" for="sheets-url">Google Sheets URL</label>
  <input
    type="url"
    id="sheets-url"
    aria-describedby="url-help"
    aria-invalid="false"
  />
  <p id="url-help" class="help-text">
    Make sure your sheet is set to "Anyone with the link can view"
  </p>
</section>

<div role="alert" aria-live="polite" id="error-region">
  <!-- Error messages appear here -->
</div>
```

**Keyboard Navigation:**

```typescript
function handleKeyDown(event: KeyboardEvent): void {
  const { key } = event;

  switch (key) {
    case 'Enter':
      // Submit form
      break;
    case 'Escape':
      // Close plugin or cancel operation
      parent.postMessage({ type: 'CLOSE' }, '*');
      break;
    case 'Tab':
      // Let default tab behavior work
      break;
  }
}

// For worksheet tabs
function handleTabKeyDown(event: KeyboardEvent, tabs: string[], activeIndex: number): void {
  let newIndex = activeIndex;

  switch (event.key) {
    case 'ArrowLeft':
      newIndex = Math.max(0, activeIndex - 1);
      break;
    case 'ArrowRight':
      newIndex = Math.min(tabs.length - 1, activeIndex + 1);
      break;
    case 'Home':
      newIndex = 0;
      break;
    case 'End':
      newIndex = tabs.length - 1;
      break;
  }

  if (newIndex !== activeIndex) {
    event.preventDefault();
    setActiveTab(tabs[newIndex]);
  }
}
```

**Color Contrast:**

```css
/* Ensure 4.5:1 contrast ratio for text */
.help-text {
  color: #666666; /* 5.74:1 on white */
}

.error-message {
  color: #D32F2F; /* 5.55:1 on white */
}

/* High contrast mode support */
@media (prefers-contrast: high) {
  .help-text {
    color: #333333;
  }
}
```

### Dependencies

TICKET-017, TICKET-018

### Acceptance Criteria

- [ ] All buttons/inputs reachable via Tab key
- [ ] Focus states are clearly visible
- [ ] Screen reader announces form labels and errors
- [ ] Color contrast meets WCAG AA (4.5:1)
- [ ] Worksheet tabs navigable with arrow keys
- [ ] Escape key closes plugin
- [ ] Error region uses aria-live for announcements
