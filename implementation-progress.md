# Implementation Progress

This file tracks detailed progress on completed tickets. For project overview and current status, see [CLAUDE.md](./CLAUDE.md).

---

## Completed Tickets

### TICKET-001: Plugin Infrastructure ✅
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

### TICKET-002: URL Parsing ✅
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

### TICKET-005: Layer Name Parsing - Basic Label Syntax ✅
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

### TICKET-006: Worksheet/Index Parsing ✅
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

### TICKET-003: Google Sheets Data Fetching ✅
**Completed:** 2024-12-12

Implemented comprehensive data fetching from public Google Sheets:

**Files Created:**
- `src/core/sheet-fetcher.ts` - Data fetching utilities
- `tests/unit/sheet-fetcher.test.ts` - 41 unit tests

**Files Modified:**
- `src/ui/ui.ts` - Integrated fetcher into UI

**Key Features:**
- Robust CSV parser handling all edge cases (quotes, newlines, escapes)
- Timeout support (30s) with automatic retry
- Session-based caching by spreadsheet ID
- Comprehensive error handling with user-friendly messages

**Functions Implemented:**
- `parseCSV(text)` - Parse CSV to 2D array
- `fetchSheetData(spreadsheetId, gid)` - Main fetch function returning FetchResult
- `fetchSheetDataOrThrow(spreadsheetId, gid)` - Convenience wrapper that throws
- `fetchWorksheetRaw(spreadsheetId, gid)` - Fetch single worksheet as 2D array
- `fetchGvizData(spreadsheetId, gid)` - Fetch via visualization API
- `rawDataToWorksheet(rawData, name)` - Convert 2D array to Worksheet
- `clearCache()` - Clear session cache
- `getCachedSheetData(spreadsheetId)` - Get cached data

**Error Types:**
- `NOT_PUBLIC` - Sheet not publicly accessible
- `NOT_FOUND` - Spreadsheet not found
- `TIMEOUT` - Request timed out
- `NETWORK_ERROR` - General network error
- `INVALID_FORMAT` - Invalid response format

### TICKET-004: Sheet Structure Detection ✅
**Completed:** 2024-12-12

Implemented automatic detection of sheet orientation and data bounds:

**Files Created:**
- `src/core/sheet-structure.ts` - Structure detection utilities
- `tests/unit/sheet-structure.test.ts` - 40 unit tests

**Files Modified:**
- `src/core/sheet-fetcher.ts` - Integrated structure detection

**Key Features:**
- Detect data bounds (exclude empty rows/columns around data)
- Detect orientation (column-based vs row-based) using bold formatting
- Normalize data to Label → Values format regardless of orientation
- Default to columns for ambiguous cases (most common pattern)

**Orientation Detection:**
- Primary: Check bold formatting via Google Sheets API (labels are typically bold)
- Fallback: Heuristics (uniqueness, label-likeness, data patterns)

**Functions Implemented:**
- `findDataBounds(rawData)` - Detect actual data area
- `trimToBounds(rawData, bounds)` - Trim to detected bounds
- `detectOrientation(rawData, boldInfo?)` - Detect column vs row orientation
- `detectSheetStructure(rawData, boldInfo?)` - Complete structure detection
- `normalizeSheetData(rawData, orientation)` - Convert to Label → Values
- `rawDataToWorksheetWithDetection(rawData, name, boldInfo?)` - Full worksheet creation

### TICKET-008: Index Tracking ✅
**Completed:** 2024-12-12

Implemented index tracking to manage which row's value to use for each label binding:

**Files Created:**
- `src/core/index-tracker.ts` - Index tracking utilities
- `tests/unit/index-tracker.test.ts` - 53 unit tests

**Key Features:**
- IndexTracker class maintains state per label per worksheet
- Support for all index types:
  - `specific`: Use exact 1-based row number (converted to 0-based)
  - `increment`: Auto-increment through all values, wrapping at end
  - `incrementNonBlank`: Auto-increment skipping blank values
  - `random`: Random row selection
  - `randomNonBlank`: Random row from non-blank values only
- Normalized label matching (case/whitespace insensitive)
- Seeded random for testing reproducibility

**Functions Implemented:**
- `resolveIndex(label, worksheet, indexType)` - Resolve to actual row index
- `getValue(label, worksheet, indexType)` - Get value directly
- `hasLabel(label, worksheet)` - Check if label exists
- `getValueCount(label, worksheet)` - Count total values
- `getNonBlankValueCount(label, worksheet)` - Count non-blank values
- `reset()` / `resetLabel(label)` - Reset counters

### TICKET-007: Layer Traversal Engine ✅
**Completed:** 2024-12-12

Implemented layer traversal system to walk through Figma document tree:

**Files Created:**
- `src/core/traversal.ts` - Layer traversal engine
- `tests/mocks/figma.ts` - Mock Figma API for testing
- `tests/unit/traversal.test.ts` - 27 unit tests

**Key Features:**
- Support three sync scopes: `document`, `page`, `selection`
- Respects `-` prefix for ignoring layers and their entire subtrees
- Skips main COMPONENT nodes by default (unless `+` prefixed)
- Handles dynamic page loading (`page.loadAsync()`) for document-wide syncs
- Tracks parent context for worksheet/index inheritance
- Builds ordered list (depth-first) of layers with bindings

**Functions Implemented:**
- `traverseLayers(options)` - Main traversal entry point
- `hasSelection()` / `getSelectionCount()` - Selection state helpers
- `suggestSyncScope()` - Suggest appropriate scope based on selection
- `getReferencedLabels(scope)` - Collect all unique labels in scope
- `getReferencedWorksheets(scope)` - Collect all unique worksheets in scope
- `findRepeatFrames(scope)` - Find all repeat frame nodes
- `countBoundLayers(scope)` - Quick count of layers with bindings

**TraversalResult Structure:**
```typescript
interface TraversalResult {
  layers: LayerToProcess[];    // Layers with bindings to process
  layersExamined: number;      // Total layers examined
  layersIgnored: number;       // Layers skipped (- prefix)
  componentsSkipped: number;   // Main components skipped
}
```

**Mock Figma API:**
Created comprehensive mock utilities for testing:
- `createMockFrame()`, `createMockText()`, `createMockComponent()`, etc.
- `createMockPage()`, `createMockDocument()`
- `setupMockFigma()` / `cleanupMockFigma()` for test lifecycle

### TICKET-009: Text Layer Content Sync ✅
**Completed:** 2024-12-12

Implemented text layer synchronization with font loading:

**Files Created:**
- `src/core/text-sync.ts` - Text sync implementation
- `tests/unit/text-sync.test.ts` - 28 unit tests

**Files Modified:**
- `tests/mocks/figma.ts` - Extended mock to support text nodes and font loading

**Key Features:**
- Font loading before text modification (Figma requirement)
- Mixed font handling (text nodes with multiple fonts)
- Empty value handling (clear text or preserve based on option)
- Special data type prefix (`/`) detection (properties, not text content)
- Multi-label binding support (additional values for future property changes)
- Batch text sync for multiple layers

**Functions Implemented:**
- `loadFontsForTextNode(node)` - Load all fonts in a text node
- `getFontsInTextNode(node)` - Get unique fonts used in text node
- `syncTextLayer(node, value, options)` - Main text sync entry point
- `batchSyncTextLayers(entries, options)` - Sync multiple text layers
- `isEmptyValue(value)` - Check if value is empty/blank
- `tryLoadFont(font)` - Safe font loading with fallback

**TextSyncResult Structure:**
```typescript
interface TextSyncResult {
  success: boolean;
  contentChanged: boolean;
  error?: SyncError;
  warnings: string[];
}
```

**Mock Figma API Extensions:**
- `MockTextNode.fontName` - Font or `figma.mixed` symbol
- `MockTextNode.getRangeFontName()` - Get font at character position
- `figma.loadFontAsync()` - Font loading mock
- `getLoadedFonts()` / `setFailingFonts()` - Test utilities

### TICKET-010: Image Fill Sync from URLs ✅
**Completed:** 2024-12-12

Implemented image fill synchronization for vector layers:

**Files Created:**
- `src/core/image-sync.ts` - Image sync implementation
- `tests/unit/image-sync.test.ts` - 50 unit tests

**Files Modified:**
- `tests/mocks/figma.ts` - Extended with image creation and shape node mocks

**Key Features:**
- URL detection (http/https)
- Google Drive share link conversion to direct download URL
- Dropbox share link conversion
- Layer type validation (rectangles, ellipses, vectors, frames, etc.)
- Image fill application with configurable scale mode
- Batch image sync for multiple layers

**Functions Implemented:**
- `isImageUrl(value)` - Check if value is an image URL
- `isGoogleDriveUrl(url)` / `isDropboxUrl(url)` - Cloud storage detection
- `convertGoogleDriveUrl(url)` - Convert to direct download URL
- `convertDropboxUrl(url)` - Convert to direct download URL
- `convertToDirectUrl(url)` - Universal URL converter
- `canHaveImageFill(node)` - Check if node supports image fills
- `applyImageFill(node, imageData, options)` - Apply image as fill
- `prepareImageSync(node, url)` - Validate and prepare image sync
- `batchApplyImageFills(entries, options)` - Batch processing

**ImageSyncResult Structure:**
```typescript
interface ImageSyncResult {
  success: boolean;
  fillChanged: boolean;
  error?: SyncError;
  warnings: string[];
}
```

**Mock Figma API Extensions:**
- `MockRectangleNode`, `MockEllipseNode`, `MockVectorNode` with `fills` property
- `figma.createImage(data)` - Image creation mock
- `getCreatedImages()` / `clearCreatedImages()` - Test utilities

### TICKET-011: Component Instance Swapping ✅
**Completed:** 2024-12-12

Implemented component instance swapping based on sheet values:

**Files Created:**
- `src/core/component-swap.ts` - Component swap implementation
- `tests/unit/component-swap.test.ts` - 43 unit tests

**Files Modified:**
- `tests/mocks/figma.ts` - Extended with component set and swap support

**Key Features:**
- Case-insensitive component name matching
- Variant syntax support (`Property=Value, Property=Value`)
- Component cache building within sync scope
- Override preservation via `swapComponent()` API
- Batch component swapping

**Functions Implemented:**
- `normalizeComponentName(name)` - Case-insensitive normalization
- `isVariantSyntax(value)` - Detect variant property format
- `parseVariantProperties(value)` - Parse variant string to map
- `buildComponentCache(scopeNodes)` - Build cache of components in scope
- `buildComponentCacheForScope(scope)` - Build cache for sync scope
- `findComponentByName(name, cache)` - Find component by name
- `findVariantComponent(properties, cache)` - Find variant by properties
- `canSwapComponent(node)` - Check if node is instance
- `swapComponent(node, name, cache)` - Main swap function
- `batchSwapComponents(entries, cache)` - Batch processing

**ComponentSwapResult Structure:**
```typescript
interface ComponentSwapResult {
  success: boolean;
  componentChanged: boolean;
  error?: SyncError;
  warnings: string[];
}
```

**Mock Figma API Extensions:**
- `MockComponentSetNode` - Component set (variant container)
- `MockInstanceNode.swapComponent()` - Component swap method
- `createMockComponentSet()` - Factory for component sets

### TICKET-012: Special Data Types - Visibility & Color ✅
**Completed:** 2024-12-12

Implemented special data type parsing and application for visibility and color:

**Files Created:**
- `src/core/special-types.ts` - Special data type handling
- `tests/unit/special-types.test.ts` - 58 unit tests

**Files Modified:**
- `tests/mocks/figma.ts` - Added `visible` property to all mock nodes, `fills` to frames

**Key Features:**
- Visibility control via `show` / `hide` values
- Hex color parsing (multiple formats: `#A`, `#AB`, `#ABC`, `#RRGGBB`)
- `/` prefix requirement for text/instance layers (distinguishes from content)
- Recursive color application for groups
- Batch processing for multiple special types

**Visibility Syntax:**
- `show` - Make layer visible
- `hide` - Hide layer
- `/show` or `/hide` - Required prefix for text/instance layers

**Color Syntax:**
- `#F` - Single char grayscale (expands to `#FFFFFF`)
- `#80` - Two char grayscale (expands to `#808080`)
- `#F00` - 3-char shorthand (expands to `#FF0000`)
- `#FF0000` - Standard 6-char hex

**Functions Implemented:**
- `parseVisibility(value)` - Parse show/hide values
- `isVisibilityValue(value)` - Check if value is visibility
- `applyVisibility(node, visibility)` - Apply visibility to node
- `parseHexColor(value)` - Parse hex color to RGB (0-1 range)
- `isHexColor(value)` - Check if value is valid hex color
- `rgbToHex(color)` - Convert RGB to hex string
- `canHaveFills(node)` - Check if node supports fills
- `applyFillColor(node, color)` - Apply solid fill (recursive for groups)
- `stripPrefix(value)` / `hasSpecialPrefix(value)` - Prefix handling
- `isSpecialDataType(value)` - Check if value is a special data type
- `applySpecialDataType(node, value, options)` - Main dispatcher
- `batchApplySpecialTypes(entries)` - Batch processing
- `requiresSpecialPrefix(nodeType)` - Check if node type needs `/` prefix

**SpecialTypeResult Structure:**
```typescript
interface SpecialTypeResult {
  handled: boolean;
  appliedTypes: string[];
  error?: SyncError;
  warnings: string[];
}
```

**Mock Figma API Extensions:**
- `MockBaseNode.visible` - Visibility property on all nodes
- `MockFrameNode.fills` - Fill support for frames

### TICKET-013: Special Data Types - Opacity & Dimensions ✅
**Completed:** 2024-12-12

Extended special data types to include opacity, dimensions, and position:

**Files Modified:**
- `src/core/special-types.ts` - Added opacity, dimension, position parsing/application
- `tests/unit/special-types.test.ts` - Extended to 102 unit tests
- `tests/mocks/figma.ts` - Added geometry properties (`x`, `y`, `width`, `height`, `opacity`, `resize()`)

**Key Features:**
- Opacity control via percentage values
- Dimension control (size, width, height)
- Position control (relative and absolute)
- `/` prefix requirement for text/instance layers

**Opacity Syntax:**
- `50%` - Set opacity to 50%
- `100%` - Fully opaque
- `0%` - Fully transparent
- `/75%` - Required prefix for text/instance layers

**Dimension Syntax:**
- `100s` - Set both width and height to 100 (square)
- `200w` - Set width only to 200
- `150h` - Set height only to 150
- `/100w` - Required prefix for text/instance layers

**Position Syntax (Relative):**
- `20x` - Move 20 pixels in X direction
- `-10y` - Move -10 pixels in Y direction

**Position Syntax (Absolute):**
- `100xx` - Set X position to 100 (absolute)
- `50yy` - Set Y position to 50 (absolute)
- `/100xx` - Required prefix for text/instance layers

**Functions Implemented:**
- `parseOpacity(value)` - Parse percentage to 0-1 opacity
- `isOpacity(value)` - Check if value is opacity
- `applyOpacity(node, opacity)` - Apply opacity to node
- `parseDimension(value)` - Parse size/width/height syntax
- `isDimension(value)` - Check if value is dimension
- `applyDimension(node, dimension)` - Apply dimension to node
- `parsePosition(value)` - Parse position syntax
- `isPosition(value)` - Check if value is position
- `applyPosition(node, position)` - Apply position to node

**Updated Dispatcher Functions:**
- `isSpecialDataType(value)` - Extended to detect opacity, dimension, position
- `applySpecialDataType(node, value)` - Extended to handle new types

**Mock Figma API Extensions:**
- `MockBaseNode.opacity` - Opacity property (0-1 range)
- `MockBaseNode.x`, `MockBaseNode.y` - Position properties
- `MockBaseNode.width`, `MockBaseNode.height` - Dimension properties
- `MockBaseNode.absoluteBoundingBox` - Bounding box for absolute positioning
- `MockBaseNode.resize(width, height)` - Resize method for dimension changes

### TICKET-014: Special Data Types - Rotation & Text Properties ✅
**Completed:** 2024-12-13

Extended special data types to include rotation and text-specific properties:

**Files Modified:**
- `src/core/special-types.ts` - Added rotation, text alignment, font size, line height, letter spacing
- `tests/unit/special-types.test.ts` - Extended to 164 unit tests
- `tests/mocks/figma.ts` - Added `rotation` to all nodes, text properties to text nodes

**Key Features:**
- Rotation control via degree values
- Text alignment (horizontal and vertical)
- Font size control
- Line height control (auto, pixels, percent)
- Letter spacing control (pixels, percent)
- Async font loading for text property changes
- `/` prefix requirement for text/instance layers

**Rotation Syntax:**
- `30º` - Rotate 30 degrees
- `-45º` - Rotate -45 degrees
- `/90º` - Required prefix for text/instance layers

**Text Alignment Syntax:**
- `text-align:left` - Left align text
- `text-align:center` - Center align text
- `text-align:right` - Right align text
- `text-align:justified` - Justify text
- `text-align-vertical:top` - Top vertical alignment
- `text-align-vertical:center` - Center vertical alignment
- `text-align-vertical:bottom` - Bottom vertical alignment

**Font Size Syntax:**
- `font-size:14` - Set font size to 14px
- `font-size:24.5` - Decimal values supported

**Line Height Syntax:**
- `line-height:auto` - Auto line height
- `line-height:40` - Fixed 40px line height
- `line-height:150%` - 150% of font size

**Letter Spacing Syntax:**
- `letter-spacing:2` - 2px letter spacing
- `letter-spacing:-0.5` - Negative values supported
- `letter-spacing:10%` - Percentage of font size

**Functions Implemented:**
- `parseRotation(value)` - Parse degree value
- `isRotation(value)` - Check if value is rotation
- `applyRotation(node, degrees)` - Apply rotation to node
- `parseTextAlign(value)` - Parse text alignment
- `isTextAlign(value)` - Check if value is text alignment
- `applyTextAlign(node, alignment)` - Apply text alignment (async for font loading)
- `parseFontSize(value)` - Parse font size
- `isFontSize(value)` - Check if value is font size
- `applyFontSize(node, size)` - Apply font size (async for font loading)
- `parseLineHeight(value)` - Parse line height
- `isLineHeight(value)` - Check if value is line height
- `applyLineHeight(node, lineHeight)` - Apply line height (async for font loading)
- `parseLetterSpacing(value)` - Parse letter spacing
- `isLetterSpacing(value)` - Check if value is letter spacing
- `applyLetterSpacing(node, spacing)` - Apply letter spacing (async for font loading)

**Updated Dispatcher Functions:**
- `isSpecialDataType(value)` - Extended to detect rotation and text properties
- `applySpecialDataType(node, value)` - Now async, extended to handle new types

**Mock Figma API Extensions:**
- `MockBaseNode.rotation` - Rotation property (degrees)
- `MockTextNode.textAlignHorizontal` - Horizontal text alignment
- `MockTextNode.textAlignVertical` - Vertical text alignment
- `MockTextNode.fontSize` - Font size in pixels
- `MockTextNode.lineHeight` - Line height (unit and value)
- `MockTextNode.letterSpacing` - Letter spacing (unit and value)

### TICKET-015: Chained Special Data Types ✅
**Completed:** 2024-12-13

Implemented the ability to chain multiple special data types in a single value:

**Files Modified:**
- `src/core/special-types.ts` - Added chained parsing and application
- `tests/unit/special-types.test.ts` - Extended to 208 unit tests (44 new)

**Key Features:**
- Parse multiple special types from a single value string
- Support comma separation (e.g., `50%, #F00, 30º`)
- Support space separation (e.g., `50% #F00 30º`)
- Support mixed separators (e.g., `50%, #F00 30º`)
- Later values override earlier for same type (e.g., second color wins)
- Text properties only apply to TEXT nodes (with warning for others)
- Smart tokenization keeps property:value pairs together

**Chained Syntax Examples:**
- `50%, #F00, 30º` - Apply opacity, color, and rotation
- `show, 100w, 50%` - Apply visibility, width, and opacity
- `text-align:center, font-size:14` - Apply text alignment and font size
- `#F00, #0F0` - Later color wins (green)

**Functions Implemented:**
- `tokenizeChainedValue(value)` - Split value into tokens, keeping property:value pairs
- `isChainedSpecialType(value)` - Check if value has multiple special types
- `parseChainedSpecialTypes(value)` - Parse all types into ParsedChainedValue
- `hasAnyParsedType(parsed)` - Check if any type was parsed
- `countParsedTypes(parsed)` - Count number of parsed types
- `applyChainedSpecialTypes(node, parsed)` - Apply all parsed types to node

**ParsedChainedValue Interface:**
```typescript
interface ParsedChainedValue {
  visibility?: 'show' | 'hide';
  color?: RGB;
  opacity?: number;
  dimension?: DimensionValue;
  position?: PositionValue;
  rotation?: number;
  textAlign?: TextAlignValue;
  fontSize?: number;
  lineHeight?: LineHeightValue;
  letterSpacing?: LetterSpacingValue;
}
```

**Updated Dispatcher:**
- `applySpecialDataType()` automatically detects chained values (2+ types)
- Falls back to single-type handling for better error messages
- `isSpecialDataType()` also detects chained values

### TICKET-016: Layer Repetition (Auto-Duplication) ✅
**Completed:** 2024-12-13

Implemented the `@#` syntax for auto-layout frames that automatically duplicates children to match data row counts:

**Files Created:**
- `src/core/repeat-frame.ts` - Detection, processing, and batch operations

**Files Modified:**
- `tests/mocks/figma.ts` - Added `layoutMode`, `clone()`, `appendChild()`, `remove()` to mock nodes
- `tests/unit/repeat-frame.test.ts` - 34 unit tests

**Key Features:**
- Detect `@#` marker in frame names
- Validate auto-layout is enabled (required for repetition)
- Find first label in descendants to determine target count
- Duplicate first child (template) to match data row count
- Remove excess children when data has fewer rows
- Preserve template properties through cloning
- Handle nested structures (clones children recursively)

**Syntax:**
- `Products @#` - Auto-layout frame that duplicates children

**Requirements:**
- Frame must have auto-layout enabled (`layoutMode !== 'NONE'`)
- Frame must have at least one child (the template)
- Children must reference at least one label to determine count

**Functions Implemented:**
- `detectRepeatFrame(node)` - Get repeat frame configuration
- `isValidRepeatFrame(node)` - Check if valid repeat frame
- `findFirstLabel(node)` - Find first label in descendants
- `getValueCountForRepeatFrame(frame, worksheet)` - Get target child count
- `processRepeatFrame(frame, worksheet)` - Process single repeat frame
- `batchProcessRepeatFrames(frames, worksheet)` - Process multiple frames
- `filterRepeatFrames(nodes)` - Filter to repeat frames
- `validateRepeatFrames(frames)` - Get warnings for invalid frames
- `getRepeatFrameStats(nodes)` - Get statistics about repeat frames

**RepeatConfig Interface:**
```typescript
interface RepeatConfig {
  isRepeatFrame: boolean;
  hasAutoLayout: boolean;
  currentChildCount: number;
}
```

**RepeatFrameResult Interface:**
```typescript
interface RepeatFrameResult {
  success: boolean;
  childrenAdded: number;
  childrenRemoved: number;
  targetCount: number;
  error?: SyncError;
  warnings: string[];
}
```

**Mock Figma API Extensions:**
- `MockFrameNode.layoutMode` - Auto-layout mode ('NONE', 'HORIZONTAL', 'VERTICAL')
- `MockFrameNode.appendChild(child)` - Add child to frame
- `MockBaseNode.clone()` - Clone node (recursive for containers)
- `MockBaseNode.remove()` - Remove node from parent

### TICKET-017: Plugin UI - Main Interface ✅
**Completed:** 2024-12-13

Implemented the main plugin user interface with URL input, sync scope selection, and action buttons:

**Files Modified:**
- `src/ui/ui.ts` - Added `pendingSync` state for proper Fetch & Sync flow
- `src/core/sheet-fetcher.ts` - Fixed TypeScript cast issue with window object
- `src/core/special-types.ts` - Fixed `canHaveFills` type check for GROUP nodes

**Key Features (Most implemented in TICKET-001):**
- URL input field for Google Sheets link with validation
- Scope selection: document, page, selection
- "Fetch" button for preview mode
- "Fetch & Sync" button for immediate sync
- Progress indicator during operations
- Error message display
- Remember last URL per document via `figma.clientStorage`
- Figma-consistent styling with CSS variables

**UI State Management:**
```typescript
interface UIState {
  url: string;
  scope: SyncScope;
  hasSelection: boolean;
  isLoading: boolean;
  error: string | null;
  sheetData: SheetData | null;
  mode: 'input' | 'preview' | 'syncing' | 'resync';
  progress: number;
  progressMessage: string;
  pendingSync: boolean;  // Added in TICKET-017
}
```

**UI Modes:**
- `input` - Initial mode with URL input and buttons
- `preview` - Data preview after fetch (placeholder until TICKET-018)
- `syncing` - Progress display during sync operation
- `resync` - Re-sync mode from relaunch button

**Fixed Issues:**
- Fetch & Sync now properly triggers sync after fetch completes (via `pendingSync` flag)
- `pendingSync` is reset on error and when using Fetch-only button

**Message Flow (Fetch & Sync):**
1. UI sets `pendingSync = true` and sends `FETCH_AND_SYNC`
2. Plugin sends `REQUEST_SHEET_FETCH` to UI
3. UI fetches data and sends `SHEET_DATA` to plugin
4. Plugin caches data and sends `FETCH_SUCCESS` to UI
5. UI sees `pendingSync = true` and calls `handleSync()`
6. Plugin processes sync and sends `SYNC_COMPLETE`

**Acceptance Criteria Met:**
- ✅ URL input accepts and validates Google Sheets URLs
- ✅ Scope radio buttons work correctly
- ✅ "Selection" option only appears when layers are selected
- ✅ "Fetch" button triggers data preview mode
- ✅ "Fetch & Sync" button triggers immediate sync
- ✅ Progress indicator shows during operations
- ✅ Error messages display clearly
- ✅ Last URL is remembered per document
- ✅ UI is responsive and follows Figma design patterns

### TICKET-018: Plugin UI - Data Preview Mode ✅
**Completed:** 2024-12-13

Implemented the data preview interface that displays fetched sheet data in a table format with click-to-rename functionality:

**Files Modified:**
- `src/ui/ui.ts` - Added preview table rendering, worksheet tabs, and click handlers
- `src/ui/styles.css` - Added comprehensive styles for preview table and tabs

**Key Features:**
- Data table showing all columns and rows from the sheet
- Worksheet tabs for switching between multiple worksheets
- Click-to-rename functionality:
  - Click label header → adds `#Label` to selected layer names
  - Click cell → adds `#Label.Index` to selected layer names
  - Click row index → adds `.Index` to selected layer names
- Tooltips explaining click actions
- Long values truncated with ellipsis
- Empty cells displayed with "—" placeholder
- Row and column counts displayed

**New State:**
```typescript
interface UIState {
  // ... existing fields
  activeWorksheet: string;  // Currently selected worksheet in preview
}
```

**New Helper Functions:**
- `handleWorksheetTabClick(worksheetName)` - Switch active worksheet
- `handleLabelClick(label)` - Rename layers with `#Label`
- `handleCellClick(label, index)` - Rename layers with `#Label.Index`
- `handleIndexClick(index)` - Rename layers with `.Index`
- `truncateValue(value, maxLength)` - Truncate long values for display
- `getActiveWorksheet()` - Get current worksheet from state
- `getValueRows(worksheet)` - Convert worksheet data to row format
- `renderWorksheetTabs()` - Render worksheet tab buttons
- `renderPreviewTable()` - Render the data table

**CSS Classes Added:**
- `.preview-mode` - Preview container
- `.preview-info` - Row/column count display
- `.preview-help` - Help text
- `.worksheet-tabs`, `.tab`, `.tab.active` - Worksheet navigation
- `.preview-table-container`, `.preview-table` - Table layout
- `.clickable-header`, `.index-cell`, `.value-cell` - Clickable elements
- `.empty-value` - Empty cell indicator

**Acceptance Criteria Met:**
- ✅ Displays sheet data in readable table format
- ✅ Shows all worksheets as clickable tabs
- ✅ Clicking label header renames selected layers with `#Label`
- ✅ Clicking cell renames selected layers with `#Label.Index`
- ✅ Clicking index adds `.Index` to selected layer names
- ✅ Sync button appears in preview mode
- ✅ Hovering shows helpful tooltips
- ✅ Long values are truncated with ellipsis
- ✅ Empty cells display appropriately

### TICKET-019: Sync Engine - Main Orchestration ✅
**Completed:** 2024-12-13

Implemented the main sync engine that coordinates all sync phases:

**Files Created:**
- `src/core/sync-engine.ts` - Main sync orchestration module

**Files Modified:**
- `src/code.ts` - Integrated sync engine with message handlers
- `src/ui/ui.ts` - Added image fetching capability
- `src/messages.ts` - Added nodeId to IMAGE_DATA payload

**Key Features:**
- Phase-based sync orchestration:
  1. Build component cache for efficient swapping
  2. Find and process repeat frames (@# syntax)
  3. Re-traverse to pick up duplicated layers
  4. Initialize index tracker for row management
  5. Process each layer (text, component swap, special types)
  6. Collect image URLs for UI to fetch
- Progress reporting via callback
- Error aggregation with partial success support
- Image fetching flow: main thread → UI (fetch) → main thread (apply)

**Functions Implemented:**
- `runSync(options)` - Main sync entry point
- `processAllRepeatFrames(frames, sheetData, result)` - Process @# frames
- `processLayer(layer, sheetData, indexTracker, componentCache, pendingImages)` - Process single layer
- `applyValue(node, value, additionalValues, componentCache, pendingImages)` - Apply value based on type
- `applyFetchedImage(nodeId, imageData)` - Apply image after UI fetches it
- `getWorksheetForNode(node, sheetData)` - Resolve worksheet for node
- `truncateName(name, maxLength)` - Truncate for progress display

**SyncEngineResult Structure:**
```typescript
interface SyncEngineResult extends SyncResult {
  pendingImages: PendingImageRequest[];
}
```

**Integration with code.ts:**
- `handleSync()` calls `runSync()` and handles pending images
- `handleImageData()` applies fetched images via `applyFetchedImage()`
- `completeSyncWithResult()` finalizes sync and sets relaunch data
