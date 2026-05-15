# Changelog

All notable changes to Sheets to Layers will be documented in this file.

## [Unreleased]

### Added
- Bound text layers now auto-show when their cell has data and auto-hide when their cell is empty, matching the behavior of the original Google Sheets Sync plugin. Auto-hide is skipped when `clearOnEmpty` is disabled.

### Fixed
- Image sync now preserves the original scale mode (FIT, CROP, TILE, etc.) instead of always resetting to FILL
