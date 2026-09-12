# Development

See the [README](README.md#development) for installation and importing the plugin into Figma Desktop. Run commands from the project root.

## Commands

```sh
npm run dev          # Watch plugin code and UI
npm run build        # Build dist/code.js and dist/ui.html
npm run typecheck    # Check TypeScript
npm test             # Run all tests once
npm run test:watch   # Run tests as files change
npm run test:unit    # Unit tests only
npm run test:int     # Integration tests only
npm test -- --coverage
npm run lint
npm run format       # Rewrite source formatting
```

The development watchers rebuild the files loaded by Figma. After changing code, rerun the plugin to load the new build.

## Architecture

The plugin has two contexts connected by messages:

- **Main thread** (`src/code.ts`): accesses the Figma document, traverses layers, and applies updates. It has no network access.
- **UI** (`src/ui/ui.ts`): renders the interface and fetches spreadsheet and image data. All network requests belong here, including calls through the fetcher modules.
- **Message protocol** (`src/messages.ts`): defines communication between the UI and main thread.

The UI fetches and normalizes sheet data, then sends it to the main thread. The sync engine collects bound layers, adjusts repeating frames, loads fonts, and applies values. Image URLs go back to the UI for fetching; image bytes return to the main thread to update fills.

### Where to make changes

- **Sync and traversal:** `src/core/sync-engine.ts`, `sync-orchestrator.ts`, and `traversal.ts`.
- **Bindings and data structure:** `src/core/parser.ts`, `index-tracker.ts`, `sheet-structure.ts`, and `types.ts`.
- **Layer updates:** `src/core/text-sync.ts`, `image-sync.ts`, `component-swap.ts`, `repeat-frame.ts`, and `special-types.ts`.
- **Fetching:** `src/core/fetcher-factory.ts`, `worker-fetcher.ts`, and `sheet-fetcher.ts`.
- **Interface:** `src/ui/ui.ts` and `src/ui/styles.css`; `scripts/build-ui.js` bundles them into `dist/ui.html`.
- **Tests:** `tests/unit/`, `tests/integration/`, and the Figma API mock at `tests/mocks/figma.ts`.

### Figma API constraints

Load fonts before editing text. Replace fill arrays instead of mutating them in place. With dynamic page access, load pages before reading their children and use `getNodeByIdAsync` for node lookup. Follow the existing core modules for these patterns.

## Worker proxy

The default fetcher uses the Cloudflare Worker configured in `src/core/worker-fetcher.ts`. It proxies Google Sheets API requests and image downloads. The fetcher factory selects JSONP when no Worker URL is configured.

To host your own proxy, follow [Worker setup and API reference](worker/README.md). Keep the Google API key in the Worker's secret configuration.

## Contributing

Keep changes focused and follow the existing TypeScript conventions. Add or update tests for parser, sync, and fetcher behavior changes. Before opening a pull request, run:

```sh
npm run typecheck
npm test
```

For UI changes, also build and check the plugin in Figma. Include a brief problem/solution description, verification results, and screenshots for visual changes. Call out any manifest, Worker, or configuration updates.
