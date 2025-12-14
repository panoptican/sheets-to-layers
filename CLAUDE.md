# Sheets Sync Figma Plugin

Figma plugin that syncs content from Google Sheets into Figma designs. Rebuild of the deprecated "Google Sheets Sync" plugin.

## Architecture

**Dual-context architecture** - this is critical:

```
Main Thread (code.ts)          UI Thread (ui.ts)
├─ Figma document access       ├─ Network access (fetch sheets)
├─ No network access           ├─ Standard DOM APIs
└─ Runs in sandbox             └─ iframe context
         ↕ postMessage
```

**All network requests must happen in the UI context** and pass data to main thread via messages.

## Layer Name Syntax

```
#Label           → Bind to column "Label", auto-increment index
#Label.5         → Use row 5 specifically
#Label.n         → Explicit auto-increment
#Label.i         → Auto-increment, skip blanks
#Label.x         → Random index
#Label.r         → Random, skip blanks
// Worksheet     → Use specific worksheet tab
-LayerName       → Ignore this layer and children
+ComponentName   → Force include main component
@#               → Auto-layout frame: duplicate children to match row count
```

## Key Files

| File | Purpose |
|------|---------|
| `src/code.ts` | Main thread entry point |
| `src/ui/ui.ts` | UI logic, data fetching |
| `src/core/types.ts` | Shared TypeScript interfaces |
| `src/core/parser.ts` | Layer name parsing |
| `src/core/sheet-fetcher.ts` | Google Sheets data fetching (JSONP) |
| `src/core/worker-fetcher.ts` | Cloudflare Worker-based fetching |
| `src/core/sheet-structure.ts` | Orientation detection (bold-based) |
| `src/core/sync-engine.ts` | Main sync orchestration |
| `src/core/special-types.ts` | Color, opacity, dimensions, etc. |
| `src/messages.ts` | UI↔Plugin message protocol |
| `worker/sheets-proxy.js` | Cloudflare Worker proxy code |
| `tests/mocks/figma.ts` | Mock Figma API for testing |

## Figma API Gotchas

```typescript
// 1. Font loading required before text changes
await figma.loadFontAsync(node.fontName as FontName);
node.characters = "New text";

// 2. Fills are readonly - clone to modify
node.fills = [{ type: 'SOLID', color: newColor }];  // ✓
node.fills[0].color = newColor;  // ✗

// 3. Dynamic page loading (manifest has "documentAccess": "dynamic-page")
await page.loadAsync();  // Required before accessing page.children
await figma.getNodeByIdAsync(id);  // Use async version

// 4. Images from Uint8Array
const image = figma.createImage(uint8Array);
node.fills = [{ type: 'IMAGE', imageHash: image.hash, scaleMode: 'FILL' }];

// 5. Component swapping preserves overrides
instanceNode.swapComponent(targetComponent);
```

## Commands

```bash
npm run dev       # Watch mode
npm run build     # Production build
npm run typecheck # TypeScript check
npm test          # Run tests
```

## Tickets

Tickets are in `/tickets/` as markdown files. **Always read the relevant ticket before implementing a feature.**

**Status:** TICKET-001 through TICKET-022 complete. See `implementation-progress.md` for details.

**Next:** TICKET-023 (Tests), TICKET-024 (Documentation)

## Cloudflare Worker

The plugin uses a Cloudflare Worker proxy (`sheets-proxy.spidleweb.workers.dev`) for:
- Google Sheets API v4 access (more reliable than JSONP/gviz)
- Image proxying with CORS headers

Worker code is in `worker/sheets-proxy.js`. Deployment instructions in `worker/README.md`.
