# Development Notes

Supplementary information for the Sheets Sync Figma plugin. See `CLAUDE.md` for essential context.

## Tech Stack

- **Language:** TypeScript (strict mode)
- **Build:** esbuild
- **UI:** Vanilla TypeScript (no framework, keeps bundle small)
- **Testing:** Vitest
- **Target:** Figma Plugin API (latest stable)

## Terminology

| Term | Meaning |
|------|---------|
| **Label** | Column/row header in the sheet (e.g., "Title", "Price") |
| **Binding** | The `#Label` syntax in a layer name that links it to sheet data |
| **Worksheet** | Individual tab/sheet within a Google Sheets document |
| **Index** | Which row's value to use (1-based in syntax, 0-based internally) |
| **Special Data Type** | Non-text values like colors (`#F00`), opacity (`50%`), size (`100w`) |
| **Repeat Frame** | Auto-layout frame with `@#` that duplicates children to match data |
| **Sync Scope** | What to update: entire document, current page, or selection |

## Coding Standards

### Naming Conventions
- Functions: camelCase, verb-first (`parseLayerName`, `fetchSheetData`)
- Interfaces: PascalCase, noun (`SheetData`, `ParsedLayerName`)
- Constants: SCREAMING_SNAKE_CASE (`DEFAULT_TIMEOUT`)
- Private members: underscore prefix (`_incrementCounters`)

### Error Handling
- Use `ErrorType` enum for categories
- Always provide user-friendly messages
- Recoverable errors shouldn't stop the sync

## Testing

### Unit Tests
Test pure functions: `parseLayerName()`, `parseHexColor()`, `normalizeLabel()`, `parseGoogleSheetsUrl()`

### Mock Figma API
`/tests/mocks/figma.ts` provides mock `figma` global with:
- `figma.root`, `figma.currentPage`
- `figma.loadFontAsync()`
- `figma.createImage()`
- `figma.notify()`
- `figma.clientStorage`

## Adding Features

### New Special Data Type
1. Add parser in `src/core/special-types.ts`
2. Add to `ParsedSpecialValue` interface
3. Add application logic in `applyChainedSpecialTypes()`
4. Add unit tests

### New Layer Type Handler
1. Add detection in `applyValue()` in sync-engine.ts
2. Create dedicated sync function
3. Handle Figma API specifics
4. Add tests with mocked nodes

## Performance Tips

- Batch font loading (collect all, load in parallel)
- Single traversal (collect layers, components, repeat frames together)
- Chunk processing (50 layers, yield to UI, repeat)
- Cache components (O(1) lookup by normalized name)

## Environment Setup

1. `npm install`
2. Install Figma desktop app
3. Figma: Plugins → Development → Import plugin from manifest
4. Select `manifest.json`
5. `npm run dev` to start watching
6. In Figma: Right-click → Plugins → Development → Sheets Sync

## Debugging

- Main thread logs: Figma DevTools (Plugins → Development → Open console)
- UI logs: Right-click plugin UI → Inspect
- User notifications: `figma.notify()`

## External Resources

- [Figma Plugin API Reference](https://www.figma.com/plugin-docs/)
- [Figma Plugin API Typings](https://github.com/figma/plugin-typings)
- [Original Plugin Docs](https://docs.sheetssync.app/) (feature parity reference)

## Ticket Dependency Graph

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

All Features → TICKET-019 (Sync Engine) → TICKET-020 through TICKET-025
```
