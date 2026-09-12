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
npm run test:worker  # Execute the Worker with injected upstream responses
npm run test:browser # Build the UI and run bundled Chromium browser tests
npm run benchmark    # Five-run core and built-UI performance benchmark
npm test -- --coverage
npm run lint
npm run format       # Rewrite source formatting
```

The development watchers rebuild the files loaded by Figma. After changing code, rerun the plugin to load the new build. When Figma development hot reload is enabled, writing build output restarts an open plugin and discards its transient preview or retry snapshot. Finish builds before live lifecycle checks. Browser validation uses the bundled Playwright Chromium executable; it does not require an installed Chrome application.

## Architecture

The plugin has two contexts connected by messages:

- **Main thread** (`src/code.ts`): accesses the Figma document, traverses layers, and applies updates. It has no network access.
- **UI** (`src/ui/ui.ts`): renders the interface and fetches spreadsheet and image data. All network requests belong here, including calls through the fetcher modules.
- **Message protocol** (`src/messages.ts`): defines communication between the UI and main thread.

The main thread captures the selected roots before fetching, performs a preflight against those roots, and saves document sync metadata only after a successful or partial completed run. Re-sync resolves those saved roots by ID; missing roots remain reviewable and never widen the operation to the current page. Retry reuses the completed plan for failed bindings, while refresh starts a new fetch. Cancellation is cooperative and can leave earlier layer mutations in place.

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

The default fetcher uses the Cloudflare Worker configured in `src/core/worker-fetcher.ts`. It proxies Google Sheets API requests and image downloads. The fetcher factory selects JSONP when no Worker URL is configured. JSONP callback scripts cannot be stream-byte-capped before execution; the adapter checks an estimated UTF-8 serialized callback payload against 5 MiB and validates 100,000 cells before gviz conversion. JSONP worksheet discovery is a bounded `gid` probe rather than complete enumeration and returns a warning when arbitrary tabs may be missing. Use Worker/API-key mode for complete discovery. The UI Settings screen also exposes an opt-in `corsproxy.io` fallback for image requests; enabling it sends the complete image URL to that provider, including query parameters. Keep it disabled when direct Worker image fetching is sufficient.

To host your own proxy, follow [Worker setup and API reference](worker/README.md). Keep the Google API key in the Worker's secret configuration.

## Contributing

Keep changes focused and follow the existing TypeScript conventions. Add or update tests for parser, sync, and fetcher behavior changes. Before opening a pull request, run:

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

The Worker setup and API reference is in [worker/README.md](worker/README.md). The root [README](README.md#development), designer guide, development guide, and Worker guide use relative links in this checkout; deployment URLs and API keys remain environment-specific.

For UI changes, also build and check the plugin in Figma. Include a brief problem/solution description, verification results, and screenshots for visual changes. Call out any manifest, Worker, or configuration updates.
