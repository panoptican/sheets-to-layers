# Cleanup Completed

**Date:** 2025-12-20
**Branch:** `claude/cleanup-unused-code-Z7Bvi`

## Summary

Successfully removed **118 lines of unused/dead code** from the codebase and documented the fallback fetching strategy.

---

## Changes Made

### ✅ Removed Dead Code

#### 1. **corsproxy.io References** (3 locations)
- `src/core/sheet-fetcher.ts:28` - Removed `CORS_PROXY_URL` constant
- `src/core/sheet-fetcher.ts:241-288` - Removed `fetchWithCorsProxy()` and `isCorsError()` helpers
- `src/ui/ui.ts:329-357` - Simplified image fetching to use worker or direct fetch

**Why:** Plugin now uses Cloudflare Worker (`sheets-proxy.spidleweb.workers.dev`) as the primary proxy. The corsproxy.io service is no longer needed.

#### 2. **Unused Exported Functions**
- `isFetchError()` - Type guard that was exported but never called
- `fetchErrorToErrorType()` - Mapping function that was exported but never called

**Why:** These functions had zero usage in the codebase. Verified with grep that no imports exist.

#### 3. **Deprecated Legacy Function**
- `rawDataToWorksheet()` - Legacy worksheet converter

**Why:** Explicitly marked as deprecated in code comments. Modern replacement is `rawDataToWorksheetWithDetection()` from `sheet-structure.ts` which handles automatic orientation detection.

#### 4. **Dead Import**
- `clearCache` import in `src/ui/ui.ts`

**Why:** Imported but never called. Only used in tests.

---

### ✅ Updated Documentation

#### CLAUDE.md - Data Fetching Strategy
Added comprehensive section explaining the two-tier fetching approach:

**Primary: Cloudflare Worker** (Recommended)
- Uses Google Sheets API v4 via worker proxy
- Handles CORS for both sheet data and images
- More reliable than undocumented endpoints
- Better support for special characters

**Fallback: JSONP/gviz**
- Uses Google's undocumented gviz endpoint with JSONP
- Activates when no worker URL configured
- Less reliable, CORS issues with images

Updated file descriptions:
- `sheet-fetcher.ts`: "Google Sheets data fetching (JSONP fallback)" ← clarified as fallback

---

## Kept as Fallback

The following code was **intentionally kept** as it serves as the fallback mechanism:

### JSONP/gviz Fetching Functions
- `fetchViaJsonp()` - JSONP script tag injection
- `fetchGvizData()` - gviz endpoint wrapper
- `fetchWorksheetViaGviz()` - Worksheet data via gviz
- `extractLabelsFromGviz()` - Extract column labels
- `gvizToRawData()` - Convert gviz format to 2D array
- `parseCSV()` - CSV parsing (used by fallback)

**Why:** These provide graceful degradation when:
- Worker URL not configured
- Worker request fails
- User hasn't deployed their own worker

### API Key Support
- `setGoogleSheetsApiKey()` - Optional API key setter
- `googleSheetsApiKey` variable - Used by `fetchBoldInfo()`

**Why:** Used by `fetchBoldInfo()` to optionally fetch formatting information for better orientation detection. If no key is set, it returns null (graceful degradation).

---

## Files Changed

```
CLAUDE.md                 |  32 +++++++++---
src/core/sheet-fetcher.ts | 127 ++--------------------------------------------
src/ui/ui.ts              |  71 ++++++++++----------------
3 files changed, 56 insertions(+), 174 deletions(-)
```

**Net Impact:** -118 lines of code removed

---

## Verification

### Imports Verified
✅ No broken imports - verified with grep
✅ Removed functions not used anywhere in `src/`
✅ `clearCache` import removed from `ui.ts`

### Build Status
⚠️ Build tools (esbuild, vitest) not installed in current environment
✅ Code changes are syntactically correct
✅ No new TypeScript errors introduced (only pre-existing Figma type errors)

---

## Commits

1. **afaccfa** - `docs: add comprehensive cleanup analysis`
   - Created CLEANUP-ANALYSIS.md with detailed breakdown

2. **bbc28b3** - `refactor: remove unused code and document fallback strategy`
   - Removed all dead code
   - Updated CLAUDE.md with fetching strategy documentation

---

## Next Steps

### Recommended Actions
1. ✅ **Review PR** - Changes are ready for review
2. ✅ **Test in Figma** - Load plugin in Figma to verify functionality
3. ✅ **Merge** - Once verified, merge to main

### Future Considerations
- Consider making worker mandatory and removing JSONP fallback entirely
- Monitor usage to see if anyone relies on JSONP fallback
- Potentially add deprecation warning for JSONP mode

---

## Related Documents
- `CLEANUP-ANALYSIS.md` - Detailed analysis of what was found
- `CLAUDE.md` - Updated with new "Data Fetching Strategy" section
