# Changelog

All notable changes to Sheets to Layers will be documented in this file.

## [Unreleased]

### Added
- Bound text layers now auto-show when their cell has data and auto-hide when their cell is empty, matching the behavior of the original Google Sheets Sync plugin. **Leave blank text unchanged** preserves the existing text and visibility instead.
- Layer bindings now support quoted and escaped labels and worksheet names. Existing row selectors, inherited worksheet context, repeats, component targets, and chained styles share the same preflight and application pipeline.
- The preview now supports worksheet browsing, independent sync-default selection, raw-data row/column orientation, bounded pagination, visual binding, blank-text policy, and preflight review with explicit issue exclusion.
- Document sync metadata now preserves the source, scope, page roots, and worksheet preferences for re-sync and relaunch actions.
- The development harness now covers the Worker boundary, bundled Chromium UI behavior, and five-run performance measurements.

### Fixed
- Preflight reads only properties supported by each Figma node type while still detecting edits made after review.
- Image sync now preserves the original scale mode (FIT, CROP, TILE, etc.) instead of always resetting to FILL

### Changed
- Worker and UI transport paths now enforce documented worksheet, response-size, image-type, redirect, timeout, and concurrency limits.
- Sync lifecycle now captures scope roots before fetching, applies only the reviewed plan, settles image requests before completion, preserves completed metadata across failed or cancelled runs, and supports immutable failed-binding retry with stale-target checks.
- Worker image validation rejects credentials and obvious private, local, self, and proxy hosts; JSONP fallback validates bounded callback payloads and warns when bounded worksheet discovery may be incomplete.
- Designer and Worker documentation now describe preview orientation and worksheet defaults, preflight exclusions, saved-root re-sync, component-family qualification, cancellation and retry behavior, image fallback disclosure, and the current Cloudflare secret/rate-limit setup.
