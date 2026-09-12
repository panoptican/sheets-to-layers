Sheets to Layers — plugin review, September 12, 2026

The highest priorities are unsafe HTML in the preview and sync paths that can silently use the wrong source data, remove the wrong repeated children, or swap into an unrelated component family. I would address these before adding features. The existing tests pass, but they do not establish that the complete plugin flows work correctly.

This was an assessment. No plugin source, configuration, or existing tests were changed. The locked development dependencies were installed to run checks, and production builds and reproduction scripts were generated in a temporary directory. This document is the only project file added.

TypeScript checking passed, the production build passed, and all 859 tests across 16 test files passed. `npm run lint` fails because ESLint cannot find a configuration file. Additional checks exercised the actual core modules together against minimal Figma mocks, the built main-thread bundle against mocked messages/storage, the built UI in Chromium, and the Worker with mocked upstream responses. No real Figma document was modified. The deployed Worker, actual Google Sheets requests, and Figma's host-specific browser restrictions were not tested.

The findings below are ordered by consequence. P1 means prioritize before release; P2 means a concrete defect worth fixing; the later recommendations are improvements or deployment questions rather than demonstrated production failures.

1. **[P1] Spreadsheet text can inject executable event handlers into the preview.**

   `escapeHtml()` uses a temporary element's `textContent`/`innerHTML`, which escapes markup but leaves double quotes intact. Its output is then interpolated into double-quoted `data-label`, `title`, and other attributes. In the built UI, a header containing a harmless injected `onclick` handler executed when clicked and changed a test variable. Ordinary quoted headers also damage the attribute values. Injected code would run in the network-enabled UI and could invoke its plugin message protocol. Browser execution is confirmed; exploitation inside Figma's hosting environment was not tested.

   Construct elements with `textContent`, `dataset`, and DOM property setters, or use escaping appropriate to each HTML context. Do not rely on message type guards to prevent code already running in the UI. Sources: [escaping helper](/Users/jason/Projects/tools/figma-plugins/sheets-to-layers/src/ui/ui.ts:1235), [header attributes](/Users/jason/Projects/tools/figma-plugins/sheets-to-layers/src/ui/ui.ts:898), [cell attributes](/Users/jason/Projects/tools/figma-plugins/sheets-to-layers/src/ui/ui.ts:927).

2. **[P1] Re-sync settings belong to the last-used plugin session, rather than the current Figma file.**

   `lastUrl` and `lastLayerIds` use fixed `clientStorage` keys with no file identity. A two-file reproduction synced A to sheet A, then B to sheet B; reopening A in re-sync mode requested sheet B. The saved IDs also came from B. This can produce no updates or target unrelated nodes where IDs coincide. Relaunch text on the document does not fix the source lookup. Figma documents that client storage is local and specific to the plugin ID, while document data uses a different API. [Figma storage documentation](https://developers.figma.com/docs/plugins/api/figma-clientStorage/).

   Store the source and sync targets on the document or appropriate root frames, with a deliberate fallback for missing metadata. Keep a global recent URL only as an input convenience. Sources: [re-sync lookup](/Users/jason/Projects/tools/figma-plugins/sheets-to-layers/src/code.ts:119), [storage writes](/Users/jason/Projects/tools/figma-plugins/sheets-to-layers/src/code.ts:387), [relaunch metadata](/Users/jason/Projects/tools/figma-plugins/sheets-to-layers/src/code.ts:575).

3. **[P1] Saving only changed layers makes re-sync omit layers and shift their row assignments.**

   `processedLayerIds` receives a node only when its value actually changed. That list becomes the entire next re-sync scope, with a fresh index counter. Reproduction: two `#Title` layers start as `A` and `old`; syncing rows `A, B` saves only the second layer. Re-syncing changed rows `A2, B2` produces `A, A2`, rather than `A2, B2`. Unchanged text and instances are valid bindings and must remain in the sync set. Partial failures can similarly disappear from later retries.

   Persist the complete intended binding set and stable ordering, or persist sync roots and traverse them again. Track changed counts independently. Sources: [changed-only tracking](/Users/jason/Projects/tools/figma-plugins/sheets-to-layers/src/core/sync-engine.ts:231), [targeted counters](/Users/jason/Projects/tools/figma-plugins/sheets-to-layers/src/core/sync-engine.ts:368), [saved targets](/Users/jason/Projects/tools/figma-plugins/sheets-to-layers/src/code.ts:390).

4. **[P1] Re-sync and selection sync lose binding context from ancestors.**

   Targeted re-sync calls `resolveInheritedParsedName(parsed, [])`; selection traversal also starts with an empty ancestor list. A `#Title` layer inside `Card // Products .2` correctly receives `P2` during page sync, but both targeted re-sync and syncing the selected child replace it with `D1` from the default worksheet. Targeted processing also does not consult an ignored ancestor before updating a saved child.

   Resolve the real ancestor context for selected/saved roots and use the same eligibility and inheritance rules in every sync mode. Sources: [targeted binding reconstruction](/Users/jason/Projects/tools/figma-plugins/sheets-to-layers/src/core/sync-engine.ts:391), [selection traversal](/Users/jason/Projects/tools/figma-plugins/sheets-to-layers/src/core/traversal.ts:381).

5. **[P1] Repeat frames can delete children using the wrong worksheet's row count.**

   Repeat sizing uses a separate helper that checks only the frame's own name and otherwise chooses the first worksheet. It ignores inherited worksheets, and its regular expression reads only the first word of a worksheet name. In a reproduction, a three-child repeat frame inside `Section // Products` shrank to one child because the default worksheet had one row, even though Products had three. Its remaining text then correctly synced from Products, making the inconsistent sizing especially hard to explain.

   Pass the traversal's resolved worksheet into repeat processing and use the shared parser. Resolve and validate the source before removing children. Source: [repeat worksheet lookup](/Users/jason/Projects/tools/figma-plugins/sheets-to-layers/src/core/sync-engine.ts:662).

6. **[P1] Variant lookup can swap an instance into an unrelated component set.**

   Variants are cached globally under names such as `Size=Large`, with the first match winning. Lookup has no relationship to the instance's current component set. With Badge and Button sets both containing `Size=Large`, syncing a Button instance to that value selected the Badge variant when Badge appeared first in traversal. This is a structural design change, not just an incorrect label.

   Resolve property-only variant requests within the current component set; use a separate explicit syntax when changing component families. Scope cache keys to set identity. Sources: [variant cache keys](/Users/jason/Projects/tools/figma-plugins/sheets-to-layers/src/core/traversal.ts:429), [global variant search](/Users/jason/Projects/tools/figma-plugins/sheets-to-layers/src/core/component-swap.ts:315), [swap lookup](/Users/jason/Projects/tools/figma-plugins/sheets-to-layers/src/core/component-swap.ts:409).

7. **[P2] Preview → Sync does not save the sheet URL used for that sync.**

   `FETCH_AND_SYNC` sets `lastSyncUrl`, but `FETCH` does not. A fresh Fetch → Sync reproduction updated text while leaving storage empty, so re-sync metadata was never saved. After syncing sheet A, fetching sheet B through preview and syncing it left the saved re-sync URL pointing at A. The README recommends the preview workflow, so this affects a primary path.

   Associate the fetched data with its source URL in both flows and persist that source on successful sync. Source: [different fetch handlers](/Users/jason/Projects/tools/figma-plugins/sheets-to-layers/src/code.ts:186).

8. **[P2] Cancel during fetching does not stop the subsequent document update.**

   Fetch & Sync immediately shows Cancel, but the main thread creates its cancellation controller only after sheet data arrives. Clicking Cancel before then does nothing and leaves `pendingSyncScope` intact. The built main-thread reproduction sent Cancel during fetch, then delivered sheet data: the document still changed and reported success. Worker sheet requests also lack a timeout, so a stalled fetch can leave this screen indefinitely.

   Give the whole fetch-and-sync operation an identity and cancellation state. Clear pending work, abort requests where possible, and reject late responses from cancelled operations. Sources: [cancel handler](/Users/jason/Projects/tools/figma-plugins/sheets-to-layers/src/code.ts:433), [automatic sync after fetch](/Users/jason/Projects/tools/figma-plugins/sheets-to-layers/src/code.ts:204), [Worker request](/Users/jason/Projects/tools/figma-plugins/sheets-to-layers/src/core/worker-fetcher.ts:172).

9. **[P2] Late images from an earlier sync can overwrite newer images.**

   Sync completion is reported before image work completes, allowing another sync to start. `IMAGE_DATA` contains a URL, but the main handler discards it and applies bytes by node ID alone. A reproduction delivered the new image first and an older request second; the older image won. Failed image requests are also only logged, rather than incorporated into the completed result.

   Match image responses to the current run and expected URL for each node, deduplicate identical requests, and include image completion/failure in the user-visible result. Sources: [image message handling](/Users/jason/Projects/tools/figma-plugins/sheets-to-layers/src/code.ts:248), [early completion](/Users/jason/Projects/tools/figma-plugins/sheets-to-layers/src/code.ts:360), [image errors](/Users/jason/Projects/tools/figma-plugins/sheets-to-layers/src/code.ts:470).

10. **[P2] Failures are hidden or leave the UI unable to recover.**

    A fetch error sets `state.error` but leaves `state.mode` as `syncing`; that view does not render the error or a retry/input action. Chromium confirmed a failed fetch left “Starting…” and Cancel, with no visible error. Separately, the sync engine discards structured failures returned by text sync, component swapping, and special-property application. A nonexistent component produced `success: true`, no errors, and zero updates. Even when errors reach the result, partial success follows the success branch in the UI, warnings go only to the console, and the success message is erased by the subsequent render.

    Preserve structured results through orchestration and render a persistent terminal result state with changed, unchanged, skipped, and failed counts, layer names, and retry/back actions. Sources: [error UI transition](/Users/jason/Projects/tools/figma-plugins/sheets-to-layers/src/ui/ui.ts:165), [discarded component result](/Users/jason/Projects/tools/figma-plugins/sheets-to-layers/src/core/sync-engine.ts:629), [discarded text result](/Users/jason/Projects/tools/figma-plugins/sheets-to-layers/src/core/sync-engine.ts:608), [completion rendering](/Users/jason/Projects/tools/figma-plugins/sheets-to-layers/src/ui/ui.ts:136).

11. **[P2] Click-to-bind generates names that the parser cannot reliably interpret.**

    Clicking a `First Name` header emits `#First Name`, but the parser reads only `First`; normalization cannot recover the missing word. Clicking a row-2 cell and then a worksheet produces `#Title.2 // Products`, but indexes are recognized only at the end of the name, so the chosen row disappears. Both cases were reproduced using actual UI/main handlers and the parser. These can silently bind the wrong column or row.

    Use one parser/serializer for manual names and UI edits. Convert displayed headers into valid binding tokens and keep the index in the canonical position. Sources: [header/cell binding generation](/Users/jason/Projects/tools/figma-plugins/sheets-to-layers/src/ui/ui.ts:571), [worksheet suffix editing](/Users/jason/Projects/tools/figma-plugins/sheets-to-layers/src/code.ts:514), [label grammar](/Users/jason/Projects/tools/figma-plugins/sheets-to-layers/src/core/parser.ts:46), [index grammar](/Users/jason/Projects/tools/figma-plugins/sheets-to-layers/src/core/parser.ts:65).

12. **[P2] The worksheet selected by the pasted URL is ignored by preview and normal sync.**

    The fetcher populates `activeWorksheet` from the URL's `gid`, but both the UI and sync engine choose `worksheets[0]` instead. Providing Products as the active worksheet still updated an unqualified `#Title` from the first/default worksheet in the reproduction. Merely browsing another preview tab also does not change the main thread's default source.

    Honor `SheetData.activeWorksheet` consistently. Make browsing a preview tab versus applying a worksheet binding clear in the interface. Sources: [fetcher selection](/Users/jason/Projects/tools/figma-plugins/sheets-to-layers/src/core/worker-fetcher.ts:323), [preview default](/Users/jason/Projects/tools/figma-plugins/sheets-to-layers/src/ui/ui.ts:113), [engine default](/Users/jason/Projects/tools/figma-plugins/sheets-to-layers/src/core/sync-engine.ts:525).

13. **[P2] Chained width/height and X/Y instructions overwrite each other.**

    The parsed result has one `dimension` and one `position` slot. Each token overwrites the prior value in its category. `200w, 100h, 20x, 30y` therefore sets only height and Y; the reproduction left width at 50 and X at 0. The README explicitly documents combined width/height instructions.

    Preserve independent axes, or retain an ordered sequence of operations with explicit last-write behavior for the same axis. Source: [chained parsing](/Users/jason/Projects/tools/figma-plugins/sheets-to-layers/src/core/special-types.ts:1147).

14. **[P2] A normal one-column spreadsheet loses all its values during orientation detection.**

    Any input with one column is classified as row-oriented before bold formatting is considered. `Title / A / B`, arranged vertically in one column, becomes three labels with empty value arrays. `#Title` then has nothing to sync. A one-row sheet has the mirrored ambiguity.

    Default conventional one-column input to a header followed by values and provide an explicit orientation override for ambiguous layouts. Source: [single-column special case](/Users/jason/Projects/tools/figma-plugins/sheets-to-layers/src/core/sheet-structure.ts:254).

15. **[P2] Re-sync does not update the number of repeated children.**

    Targeted re-sync processes saved bound nodes only; it does not run the repeat-frame phase. Starting with two data rows and two children, then re-syncing three rows, leaves two children. Shrinking data likewise leaves extras. Parent repeat frames usually are not in the saved list because they do not themselves have a column binding.

    Persist repeat roots and process their structure before resolving current child bindings. Reuse the normal sync phases rather than maintaining a reduced path with different semantics. Source: [targeted sync flow](/Users/jason/Projects/tools/figma-plugins/sheets-to-layers/src/core/sync-engine.ts:349).

16. **[P2] Image updates discard crop transforms, filters, opacity, and additional fills.**

    The application path preserves only the previous image's `scaleMode`, then replaces the entire fills array with a new paint. A mock image with CROP mode, a transform, contrast, and opacity lost every property except its scale mode. Keeping the word CROP does not preserve the user's actual crop.

    Update the intended image paint's hash while retaining its supported properties and other paints, or make a deliberate reset an explicit option. Source: [replacement image paint](/Users/jason/Projects/tools/figma-plugins/sheets-to-layers/src/core/sync-engine.ts:705).

17. **[P2] The Worker treats worksheet names as unquoted A1 ranges.**

    URL encoding alone does not make a sheet title an unambiguous range. The mocked upstream request for a tab named `A1` used `/values/A1`, which denotes a cell range; bold requests for `Product List` used unquoted `Product List!1:1`. Google documents quoting for names with spaces/special characters and for disambiguating sheet names from cell or named ranges. [Google A1 notation documentation](https://developers.google.com/workspace/sheets/api/guides/concepts).

    Build a quoted A1 sheet reference before URL encoding and test spaces, apostrophes, range-like names, and named-range collisions. The generated requests were verified locally; their responses from Google were not tested live. Source: [Worker range construction](/Users/jason/Projects/tools/figma-plugins/sheets-to-layers/worker/sheets-proxy.js:67).

The following improvements are also worth planning, after the correctness fixes:

- **Add tests across module boundaries.** The sync-engine suite mocks traversal, fonts, repeat processing, text sync, swapping, image detection, and special types. That is useful for orchestration branches, but it excludes the interactions responsible for several findings above. There are no existing tests for `code.ts`, the UI, or the Worker implementation; `test:int` points to a directory with no integration tests. A small set covering preview → sync → re-sync, inherited repeat frames, two-file storage, errors/cancellation, and reversed image responses would be more valuable than more isolated happy-path cases. Restore a working TypeScript-aware lint configuration as well. Sources: [engine mocks](/Users/jason/Projects/tools/figma-plugins/sheets-to-layers/tests/unit/sync-engine.test.ts:9), [test configuration](/Users/jason/Projects/tools/figma-plugins/sheets-to-layers/vitest.config.ts:3).

- **Add a preflight summary before consequential syncs.** Report unmatched labels, unavailable worksheets, duplicate/normalized header collisions, ambiguous component variants, missing fonts, and repeat additions/removals. Currently a missing primary label simply returns false. A selectable row/orientation preview and clear empty-cell policy would reduce surprises. Duplicate exact headers overwrite earlier data during normalization, so flag them explicitly. Sources: [unmatched labels](/Users/jason/Projects/tools/figma-plugins/sheets-to-layers/src/core/sync-engine.ts:553), [header normalization](/Users/jason/Projects/tools/figma-plugins/sheets-to-layers/src/core/sheet-structure.ts:581).

- **Bound large operations and make progress cover the whole job.** The preview renders every cell and attaches individual listeners. Worksheet fetching fans out across all tabs; image requests also launch without a concurrency limit. Repeated images should share a fetch, and large previews should paginate or virtualize. Batch font loading is followed by per-layer `loadFontAsync` calls that do not consult the batch cache, so the claimed deduplication does not span the full operation. These are observed implementation patterns; no large-file benchmark was run. Sources: [preview rendering](/Users/jason/Projects/tools/figma-plugins/sheets-to-layers/src/ui/ui.ts:910), [worksheet fan-out](/Users/jason/Projects/tools/figma-plugins/sheets-to-layers/src/core/worker-fetcher.ts:287), [per-layer font loading](/Users/jason/Projects/tools/figma-plugins/sheets-to-layers/src/core/text-sync.ts:113).

- **Review the deployed proxy's abuse controls and fallback disclosure.** Locally, the Worker accepted POST despite documenting GET-only behavior, fetched an arbitrary non-image URL without an API key, and returned HTML as HTML. There are no request/body size limits, image content checks, explicit timeouts, or rate controls in this source. Deployment-level controls may exist and were not inspected. Also, the UI automatically falls back to `corsproxy.io`, sending it the complete image URL, including any query token. Restrict protocols/methods, validate image responses, bound work, verify deployment controls, and make the third-party fallback an explicit documented choice. Sources: [Worker dispatch](/Users/jason/Projects/tools/figma-plugins/sheets-to-layers/worker/sheets-proxy.js:39), [image proxy](/Users/jason/Projects/tools/figma-plugins/sheets-to-layers/worker/sheets-proxy.js:170), [external fallback](/Users/jason/Projects/tools/figma-plugins/sheets-to-layers/src/ui/ui.ts:411).

- **Either finish settings or remove the unreachable interface and stale guidance.** The UI registers a listener for `settings-btn` but never renders that button. Saving settings only updates module state, so the custom Worker URL would reset after closing the plugin. The setup link points to an unrelated-looking `anthropics/sheets-sync` path, and the README includes a placeholder clone URL. Validate the intended links and document the actual supported setup. Sources: [settings listener](/Users/jason/Projects/tools/figma-plugins/sheets-to-layers/src/ui/ui.ts:1091), [settings save](/Users/jason/Projects/tools/figma-plugins/sheets-to-layers/src/ui/ui.ts:619), [setup link](/Users/jason/Projects/tools/figma-plugins/sheets-to-layers/src/ui/ui.ts:1038).

Suggested repair order: fix preview HTML handling first; then unify source metadata, binding identity, ancestor resolution, repeat processing, and variant selection; then repair operation cancellation, image response ownership, and result presentation. The parsing/data-shape fixes can follow in focused changes. No fixes were applied as part of this review.

Temporary verification artifacts are in [the review directory](/private/tmp/sheets-to-layers-review-20260912). The directly inspectable results are [core reproductions](/private/tmp/sheets-to-layers-review-20260912/core-results.json), [main-thread reproductions](/private/tmp/sheets-to-layers-review-20260912/main-results.json), [browser reproductions](/private/tmp/sheets-to-layers-review-20260912/browser-results.json), and [Worker reproductions](/private/tmp/sheets-to-layers-review-20260912/worker-results.json). These files are temporary; the reproduction descriptions and verification limits above are the durable record.
