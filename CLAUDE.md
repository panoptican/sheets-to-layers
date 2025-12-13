# CLAUDE.md - Sheets Sync Figma Plugin

## Project Overview

This is a Figma plugin that syncs content from Google Sheets into Figma designs. It's a rebuild of the deprecated "Google Sheets Sync" plugin using the modern Figma Plugin API.

**Core functionality:**
- Pull data from public Google Sheets via shareable links
- Apply values to Figma layers based on naming conventions (`#Label` syntax)
- Support text content, images from URLs, component swapping, and style properties
- Auto-duplicate layers to match data row counts

## Tech Stack

- **Language:** TypeScript (strict mode)
- **Build:** esbuild or Vite
- **UI Framework:** Preact or vanilla HTML/CSS (keep bundle small)
- **Testing:** Vitest
- **Target:** Figma Plugin API (latest stable)

## Architecture

The plugin uses Figma's dual-context architecture:

```
┌─────────────────────────────────────────────────────┐
│ Main Thread (code.ts)                               │
│ - Access to Figma document/nodes                    │
│ - No network access                                 │
│ - Runs in sandbox                                   │
└─────────────────────┬───────────────────────────────┘
                      │ postMessage / onmessage
┌─────────────────────┴───────────────────────────────┐
│ UI Thread (ui.html / ui.ts)                         │
│ - iframe with network access                        │
│ - Fetch Google Sheets data here                     │
│ - Standard DOM APIs                                 │
└─────────────────────────────────────────────────────┘
```

**Key insight:** All network requests (fetching sheet data, downloading images) must happen in the UI context and be passed to the main thread via messages.

## File Structure

```
/src
  /core
    types.ts           # Shared TypeScript interfaces
    parser.ts          # Layer name parsing logic
    sheet-parser.ts    # Google Sheets data parsing
    index-tracker.ts   # Manages value index state during sync
    sync-engine.ts     # Main orchestration logic
    special-types.ts   # Special data type parsers (color, size, etc.)
  /ui
    ui.tsx             # UI entry point
    components/        # UI components
    styles.css         # Figma-consistent styling
  /utils
    url.ts             # Google Sheets URL parsing
    fonts.ts           # Font loading utilities
    images.ts          # Image fetching utilities
  code.ts              # Plugin main entry point
  messages.ts          # Message type definitions
/tests
  /unit
  /integration
  /mocks
    figma.ts           # Mock Figma API for testing
/dist                  # Build output
manifest.json
package.json
tsconfig.json
```

## Key Concepts & Terminology

| Term | Meaning |
|------|---------|
| **Label** | Column/row header in the sheet (e.g., "Title", "Price") |
| **Binding** | The `#Label` syntax in a layer name that links it to sheet data |
| **Worksheet** | Individual tab/sheet within a Google Sheets document |
| **Index** | Which row's value to use (1-based in syntax, 0-based internally) |
| **Special Data Type** | Non-text values like colors (`#F00`), opacity (`50%`), size (`100w`) |
| **Repeat Frame** | Auto-layout frame with `@#` that duplicates children to match data |
| **Sync Scope** | What to update: entire document, current page, or selection |

## Layer Name Syntax Reference

```
#Label           → Bind to column "Label", auto-increment index
#Label.5         → Bind to column "Label", use row 5
#Label.n         → Explicit auto-increment
#Label.i         → Auto-increment, skip blank values
#Label.x         → Random index
#Label.r         → Random index, skip blanks
// Worksheet     → Use specific worksheet tab
-LayerName       → Ignore this layer and children
+ComponentName   → Force include main component (normally skipped)
@#               → On auto-layout frame: duplicate children to match row count
```

## Coding Standards

### TypeScript
- Use strict mode
- Prefer `interface` over `type` for object shapes
- Use discriminated unions for complex state
- Explicit return types on exported functions
- No `any` - use `unknown` and narrow

### Naming Conventions
```typescript
// Functions: camelCase, verb-first
function parseLayerName(name: string): ParsedLayerName
function fetchSheetData(id: string): Promise<SheetData>
async function syncTextLayer(node: TextNode, value: string): Promise<void>

// Interfaces: PascalCase, noun
interface SheetData { }
interface ParsedLayerName { }
interface SyncResult { }

// Constants: SCREAMING_SNAKE_CASE
const DEFAULT_TIMEOUT = 30000;
const MAX_RETRIES = 3;

// Private class members: prefix with underscore
private _incrementCounters: Map<string, number>
```

### Error Handling
- Use custom error types with `ErrorType` enum
- Always provide user-friendly messages
- Log technical details to console
- Recoverable errors shouldn't stop the sync

```typescript
// Good
throw createAppError(ErrorType.SHEET_NOT_PUBLIC, `Sheet ID: ${sheetId}`);

// Bad
throw new Error('403');
```

### Async Patterns
```typescript
// Always await in sequence when order matters
await loadFontsForTextNode(node);
node.characters = value;

// Use Promise.all for independent operations
await Promise.all(fonts.map(f => figma.loadFontAsync(f)));
```

## Figma Plugin API Notes

### Dynamic Page Loading
The manifest uses `"documentAccess": "dynamic-page"`. This means:
- Pages are loaded on demand
- Must call `page.loadAsync()` before accessing `page.children`
- Use async methods: `figma.getNodeByIdAsync()`, not `figma.getNodeById()`

### Common Gotchas

1. **Font loading is required before text changes:**
```typescript
// Always load fonts first
await figma.loadFontAsync(node.fontName as FontName);
node.characters = "New text";
```

2. **Mixed fonts in text nodes:**
```typescript
if (node.fontName === figma.mixed) {
  // Must load each font segment individually
}
```

3. **Fills are readonly arrays - clone to modify:**
```typescript
// Wrong
node.fills[0].color = newColor;

// Right
node.fills = [{ type: 'SOLID', color: newColor }];
```

4. **Component swapping:**
```typescript
// Use swapComponent for override preservation
instanceNode.swapComponent(targetComponent);

// Don't set mainComponent directly on nested instances
```

5. **Image handling:**
```typescript
// Images must be created from Uint8Array
const image = figma.createImage(uint8Array);
node.fills = [{ type: 'IMAGE', imageHash: image.hash, scaleMode: 'FILL' }];
```

### Node Type Checking
```typescript
// Use type narrowing
if (node.type === 'TEXT') {
  // node is now TextNode
}

// Or check for mixins
if ('fills' in node) {
  // node has GeometryMixin
}
```

## Message Protocol

All communication between UI and main thread uses typed messages:

```typescript
// UI → Main
interface UIMessage {
  type: 'FETCH' | 'FETCH_AND_SYNC' | 'SYNC' | 'RENAME_SELECTION';
  payload?: unknown;
}

// Main → UI
interface PluginMessage {
  type: 'INIT' | 'PROGRESS' | 'FETCH_SUCCESS' | 'SYNC_COMPLETE' | 'ERROR';
  payload?: unknown;
}
```

**Always validate message payloads** - the types don't enforce runtime safety.

## Testing Strategy

### Unit Tests
Test pure functions in isolation:
- `parseLayerName()` - all syntax variations
- `parseHexColor()` - all formats
- `normalizeLabel()` - case/whitespace handling
- `parseGoogleSheetsUrl()` - URL formats

### Integration Tests
Use mocked Figma API:
- Full sync flow with mock document
- Repeat frame duplication
- Component swapping
- Error recovery

### Mock Figma API
The `/tests/mocks/figma.ts` file provides a mock `figma` global. Key methods to mock:
- `figma.root`, `figma.currentPage`
- `figma.loadFontAsync()`
- `figma.createImage()`
- `figma.notify()`
- `figma.clientStorage`

## Common Development Tasks

### Adding a new special data type

1. Add parser in `src/core/special-types.ts`:
```typescript
function parseNewType(value: string): NewTypeValue | null {
  const match = value.match(/pattern/);
  if (!match) return null;
  return { /* parsed value */ };
}
```

2. Add to `ParsedSpecialValue` interface
3. Add application logic in `applyChainedSpecialTypes()`
4. Add unit tests
5. Update documentation

### Adding a new layer type handler

1. Add detection in `applyValue()` in sync-engine.ts
2. Create dedicated sync function (e.g., `syncNewLayerType()`)
3. Handle the Figma API specifics for that node type
4. Add tests with mocked nodes

## Performance Considerations

- **Batch font loading** - collect all needed fonts, load in parallel
- **Single traversal** - collect all data (layers, components, repeat frames) in one pass
- **Chunk processing** - process 50 layers, yield to UI, repeat
- **Cache components** - O(1) lookup by normalized name
- **Minimize reflows** - batch node property changes where possible

## External Documentation

- [Figma Plugin API Reference](https://www.figma.com/plugin-docs/)
- [Figma Plugin API Typings](https://github.com/figma/plugin-typings)
- [Google Sheets URL Formats](https://developers.google.com/sheets/api/guides/concepts)
- [Original Plugin Docs](https://docs.sheetssync.app/) (for feature parity reference)

## Tickets Reference

Individual tickets are stored in `/tickets/` as markdown files (e.g., `TICKET-001.md`, `TICKET-002.md`). **Always read the relevant ticket file before starting work on a feature or task.** Each ticket contains:

- Detailed requirements and acceptance criteria
- Technical specifications with code samples
- Dependencies on other tickets
- Edge cases to handle

When asked to implement a feature, first check `/tickets/` for the corresponding ticket and follow its specifications. If a task spans multiple tickets, read all relevant ones to understand the full scope.

### Ticket Dependency Graph

```
TICKET-001 (Infrastructure)
    ├── TICKET-002 (URL Parsing)
    │   └── TICKET-003 (Data Fetching)
    │       └── TICKET-004 (Structure Detection)
    │           └── TICKET-008 (Index Tracking)
    ├── TICKET-005 (Label Parsing)
    │   └── TICKET-006 (Worksheet/Index Parsing)
    │       └── TICKET-007 (Layer Traversal)
    └── TICKET-017 (Main UI)
        └── TICKET-018 (Preview UI)

TICKET-007 + TICKET-008 →
    ├── TICKET-009 (Text Sync)
    ├── TICKET-010 (Image Sync)
    ├── TICKET-011 (Component Swap)
    └── TICKET-012 (Visibility/Color)
        └── TICKET-013 (Opacity/Dimensions)
            └── TICKET-014 (Rotation/Text Props)
                └── TICKET-015 (Chained Types)
                    └── TICKET-016 (Layer Repetition)

All Features → TICKET-019 (Sync Engine)
    ├── TICKET-020 (Re-sync)
    ├── TICKET-021 (Error Handling)
    └── TICKET-022 (Performance)

All → TICKET-023 (Tests)
All → TICKET-024 (Documentation)
TICKET-017 + TICKET-018 → TICKET-025 (Accessibility)
```

### Implementation Order (Suggested)

#### Phase 1: Foundation
1. TICKET-001: Infrastructure
2. TICKET-002: URL Parsing
3. TICKET-005: Label Parsing
4. TICKET-006: Worksheet/Index Parsing

#### Phase 2: Data Layer
5. TICKET-003: Data Fetching
6. TICKET-004: Structure Detection
7. TICKET-008: Index Tracking

#### Phase 3: Core Sync
8. TICKET-007: Layer Traversal
9. TICKET-009: Text Sync
10. TICKET-010: Image Sync
11. TICKET-011: Component Swap

#### Phase 4: Special Features
12. TICKET-012: Visibility/Color
13. TICKET-013: Opacity/Dimensions
14. TICKET-014: Rotation/Text Props
15. TICKET-015: Chained Types
16. TICKET-016: Layer Repetition

#### Phase 5: UI & Integration
17. TICKET-017: Main UI
18. TICKET-018: Preview UI
19. TICKET-019: Sync Engine
20. TICKET-020: Re-sync

#### Phase 6: Polish
21. TICKET-021: Error Handling
22. TICKET-022: Performance
23. TICKET-023: Tests
24. TICKET-024: Documentation
25. TICKET-025: Accessibility

## Quick Commands

```bash
# Development
npm run dev          # Watch mode with hot reload
npm run build        # Production build
npm run typecheck    # TypeScript check without emit

# Testing
npm test             # Run all tests
npm test -- --watch  # Watch mode
npm run test:unit    # Unit tests only
npm run test:int     # Integration tests only

# Utilities
npm run lint         # ESLint
npm run format       # Prettier
```

## Environment Setup

1. Install dependencies: `npm install`
2. Install Figma desktop app
3. In Figma: Plugins → Development → Import plugin from manifest
4. Select the `manifest.json` in this project
5. Run `npm run dev` to start watching
6. In Figma: Right-click → Plugins → Development → Sheets Sync

## Debugging

- **Console logs** appear in Figma's DevTools (Plugins → Development → Open console)
- **UI logs** appear in the plugin UI's DevTools (right-click UI → Inspect)
- Use `figma.notify()` for user-visible debug output
- Set `DEBUG=true` in environment for verbose logging

## Git Workflow

- `main` - stable, released code
- `develop` - integration branch
- `feature/TICKET-XXX-description` - feature branches
- Squash merge to develop, merge to main for releases

---

## Implementation Progress

### Completed Tickets

#### TICKET-001: Plugin Infrastructure ✅
**Completed:** 2024-12-12

Established the foundational plugin architecture:

**Files Created:**
- `package.json` - Dependencies: esbuild, TypeScript, Vitest, @figma/plugin-typings
- `tsconfig.json` - Strict TypeScript configuration
- `manifest.json` - Figma plugin manifest with dynamic-page access and relaunch buttons
- `src/core/types.ts` - Comprehensive type definitions (SheetData, ParsedLayerName, SyncResult, etc.)
- `src/messages.ts` - Full message protocol with type guards and helpers
- `src/code.ts` - Main plugin entry with command handling, message dispatch, selection tracking
- `src/ui/ui.ts` - UI with input mode, preview mode placeholder, syncing mode
- `src/ui/styles.css` - Figma-consistent theming with CSS variables
- `scripts/build-ui.js` - Build script that inlines CSS/JS into single HTML file
- `.gitignore` - Standard ignores for node_modules, dist, IDE files

**Build System:**
- `npm run dev` - Watch mode for development
- `npm run build` - Production build (minified)
- `npm run typecheck` - TypeScript validation

**Key Implementation Notes:**
- UI uses vanilla TypeScript (no framework) to keep bundle small
- CSS uses Figma's CSS variables for theming (--figma-color-*)
- Message protocol is fully typed with discriminated unions
- Placeholder implementations exist for sync engine (TICKET-019) and data fetching (TICKET-003)

#### TICKET-002: URL Parsing ✅
**Completed:** 2024-12-12

Implemented Google Sheets URL parsing and validation:

**Files Created:**
- `src/utils/url.ts` - URL parsing utilities
- `tests/unit/url.test.ts` - 38 unit tests
- `vitest.config.ts` - Test configuration

**Functions Implemented:**
- `parseGoogleSheetsUrl(url)` - Extract spreadsheet ID and gid, validate format
- `buildCsvExportUrl(id, gid?)` - Build CSV export URL for data fetching
- `buildJsonExportUrl(id, gid?)` - Build JSON visualization API URL
- `buildEditUrl(id)` - Build edit page URL
- `looksLikeGoogleSheetsUrl(url)` - Quick validation check
- `normalizeGoogleSheetsUrl(url)` - Canonicalize URLs

**Supported URL Formats:**
- `https://docs.google.com/spreadsheets/d/{ID}/edit`
- `https://docs.google.com/spreadsheets/d/{ID}/edit#gid={GID}`
- `https://docs.google.com/spreadsheets/d/{ID}/edit?usp=sharing`
- `https://docs.google.com/spreadsheets/d/{ID}`

**Validation:**
- Rejects empty/whitespace input
- Requires http/https protocol
- Validates Google Docs domain
- Rejects Google Forms/Docs/Slides/Drawings URLs
- Validates spreadsheet ID format (alphanumeric, hyphens, underscores)

#### TICKET-005: Layer Name Parsing - Basic Label Syntax ✅
**Completed:** 2024-12-12

Implemented layer name parsing for extracting data binding instructions:

**Files Created:**
- `src/core/parser.ts` - Layer name parsing utilities
- `tests/unit/parser.test.ts` - 70 unit tests

**Functions Implemented:**
- `parseLayerName(name)` - Main parser returning ParsedLayerName
- `normalizeLabel(label)` - Normalize for case-insensitive comparison
- `matchLabel(layerLabel, sheetLabels)` - Find matching sheet label
- `hasMatchingLabel(label, sheetLabels)` - Check if label exists
- `extractLabels(name)` - Quick label extraction
- `hasBinding(name)` - Check for any data bindings
- `isIgnoredLayer(name)` - Check for `-` prefix
- `isRepeatFrame(name)` - Check for `@#` marker

**Syntax Supported:**
- `#Label` - Bind to column "Label"
- `#Label #Other` - Multiple labels on one layer
- `-LayerName` - Ignore layer and children
- `+ComponentName` - Force include main component
- `@#` - Repeat frame marker

**Important Notes:**
- Labels must start with a letter
- Labels can contain letters, numbers, underscores, hyphens
- Labels do NOT contain spaces (use `#first_name` to match "First Name")
- Normalization handles case/separator matching

#### TICKET-006: Worksheet/Index Parsing ✅
**Completed:** 2024-12-12

Extended the layer name parser to support worksheet and index syntax:

**Files Modified:**
- `src/core/parser.ts` - Added worksheet and index parsing
- `tests/unit/parser.test.ts` - Added 57 new tests (127 total parser tests)

**New Syntax Supported:**
- `// WorksheetName` - Specify source worksheet (e.g., `Frame // Products`)
- `.N` - Specific row index, 1-based (e.g., `#Title.5`)
- `.n` - Auto-increment index (e.g., `#Title.n`)
- `.i` - Increment ignoring blank values (e.g., `#Title.i`)
- `.x` - Random index (e.g., `#Title.x`)
- `.r` - Random index excluding blanks (e.g., `#Title.r`)

**New Functions:**
- `extractWorksheet(layerName)` - Extract worksheet from layer name
- `extractIndex(layerName)` - Extract index specification
- `hasWorksheet(layerName)` - Check if layer specifies worksheet
- `hasIndex(layerName)` - Check if layer specifies index
- `resolveInheritedParsedName(parsed, ancestors)` - Resolve inherited values
- `DEFAULT_INDEX` - Constant for default auto-increment behavior

**Inheritance Rules:**
- Worksheet inherits from parent Frame/Group/Page (nearest ancestor wins)
- Index inherits from parent Frame/Group (nearest ancestor wins)
- Explicit values on layer override inherited values

### Next Steps

Follow the suggested implementation order - Phase 2 (Data Layer):

1. **TICKET-003: Data Fetching** - Fetch sheet data using the URL utilities
2. **TICKET-004: Structure Detection** - Detect sheet orientation and normalize data
3. **TICKET-008: Index Tracking** - Track index state during sync operations

### Code Locations Reference

| Component | File | Purpose |
|-----------|------|---------|
| Core Types | `src/core/types.ts` | All shared TypeScript interfaces |
| Messages | `src/messages.ts` | UI↔Plugin communication protocol |
| URL Parsing | `src/utils/url.ts` | Google Sheets URL parsing/validation |
| Layer Parsing | `src/core/parser.ts` | Layer name parsing (#Label, //Worksheet, .N index) |
| Plugin Entry | `src/code.ts` | Main thread code, command handling |
| UI Entry | `src/ui/ui.ts` | UI logic, state management |
| UI Styles | `src/ui/styles.css` | Figma-consistent CSS |
| Build Script | `scripts/build-ui.js` | HTML generation with inlined assets |

### Testing the Plugin

1. Run `npm install` (already done)
2. Run `npm run build`
3. In Figma: Plugins → Development → Import plugin from manifest
4. Select `manifest.json`
5. Right-click → Plugins → Development → Sheets Sync

The plugin will show the input UI. Fetch/sync functionality is placeholder until TICKET-003/019 are implemented.

---

*This file helps Claude Code understand the project. Update it as the codebase evolves.*