# Changelog

All notable changes to Sheets to Layers will be documented in this file.

## [4] - 2026-09-18

This update makes Sheets to Layers safer and more predictable, especially when working across multiple worksheets, pages, or Figma files. It adds a true review step before consequential changes, makes re-sync document-aware, and substantially improves error recovery, image handling, and large-sheet performance.

### Preview and data settings

- Browse every worksheet in a spreadsheet without changing which worksheet a sync uses by default.
- Open **Settings** after fetching or while reviewing a sync to choose the default worksheet, set each worksheet's row or column orientation, and decide how blank text cells should behave. Saving from the review automatically rebuilds it.
- Data settings now live in a focused modal on the preview screen. Connection and proxy configuration is no longer exposed in the plugin interface.
- Standard controls now use create-figma-plugin's UI3 components and icons, including buttons, dropdowns, the settings dialog, sync-scope choices, navigation, and pagination.
- Preview large sheets with compact row and column range controls integrated into the table footer. Pagination stays hidden when the entire worksheet already fits.
- Click a column, row, or cell to create a binding. When layers are selected and a non-default worksheet is being browsed, **Use [worksheet] for selected layers** appears beside the worksheet tabs as an occasional explicit override. Simply browsing a worksheet does not rename layers.
- One-column sheets now default to a conventional header followed by values, with an orientation override available for ambiguous layouts.

### Review, sync, and re-sync

- Review proposed changes before they are applied. The review reports meaningful repeat additions or removals, missing labels and worksheets, unavailable fonts, and ambiguous component targets without exposing internal binding counts or unchanged repeat operations.
- Exclude an understood issue without discarding the rest of the sync. Blocking issues must be resolved or explicitly excluded before applying changes.
- See persistent changed, unchanged, skipped, and failed counts after each run. Results are grouped by layer name with per-status counts; groups with failed or skipped layers open automatically, and any layer can be expanded and selected on the canvas.
- Identical repeat changes are folded into one review line, such as "Cards will add 237 repeated items in each of 18 frames." Same-named frames that differ are told apart by their parent frame.
- Retry failed bindings against the same reviewed data and row choices. If a target layer itself was edited after review, the retry safely skips it and asks for a fresh review. Auto Layout reflow or edits to neighbouring layers caused by the first run do not block a retry.
- The review stays current as long as the layers being synced are unchanged. Edits elsewhere in the file, including on other pages, no longer require a fresh review before applying.
- Cancel sheet fetching, application, or image loading. The result now distinguishes cancellation from success and accurately reports any changes already made.
- Re-sync now remembers the source, scope, exact roots, page, default worksheet, orientation choices, and blank-text policy in the Figma document rather than relying on the last plugin session.
- Saved page and selection scopes remain attached to their original targets, even when re-sync is started from another page. Missing roots are reported instead of silently widening the sync.

### Bindings and layer behavior

- Use quoted bindings for labels and worksheet names containing spaces or punctuation, such as `#"First Name"` and `// "Q1 / East"`.
- Row selection, inherited worksheet context, repeated layouts, component targets, and chained styles now use the same parsing and application rules in preview, initial sync, and re-sync.
- Bound text automatically shows when its cell contains data and clears and hides when the cell is blank. Choose **Leave blank text unchanged** when existing content and visibility should be preserved instead.
- Combined width, height, X, and Y instructions now apply independently rather than overwriting one another.
- Duplicate or ambiguous normalized headers are reported instead of silently choosing one.

### Repeats, components, and images

- Repeated Auto Layout frames now use the resolved worksheet and resize correctly during both sync and re-sync. Empty data preserves the reusable template instead of deleting it.
- Property-only component variants stay within the current component family. Changing families requires an explicit, unambiguous component target.
- Image updates preserve the existing crop, scale mode, filters, opacity, and other fills.
- Images still apply to frames whose bound child text changed while the image was loading.
- Component targets written as `Family / Component` resolve the same way as `Family/Component`.
- Re-syncing reuses recently downloaded images for the same URL instead of downloading each one again.
- Duplicate image URLs share one request, and a late response from an older sync can no longer overwrite a newer image.
- Sync completion waits for image work to settle so image failures appear in the final result.

### Reliability and security

- UI3 component styles now use create-figma-plugin's build and render pipeline, preventing controls from losing their labels, spacing, typography, or theme colors in production builds.
- Spreadsheet content is rendered safely in the preview, including quoted or markup-like headers and worksheet names.
- Sheet and image requests now have cancellation, deadlines, concurrency limits, response-size limits, and clearer errors.
- The hosted Worker validates image protocols, redirects, response types, signatures, and sizes; rejects credentials and obvious private, local, self, or proxy destinations; and quotes worksheet names correctly in Google Sheets ranges.
- The optional third-party image proxy fallback and its settings have been removed. The plugin now uses its hosted Worker automatically.
- Added integration coverage for the Figma host boundary, the built plugin UI in Chromium, the Worker, cancellation, and document isolation.
