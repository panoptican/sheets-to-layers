# Codebase Cleanup Analysis

This document identifies all extraneous, unused, and deprecated code that can be removed from the Sheets to Layers codebase.

Generated: 2025-12-20

---

## 🔴 CRITICAL - Remove Immediately

### 1. corsproxy.io References
**Status:** CONFIRMED UNUSED - Plugin now uses Cloudflare Worker

**Locations:**
- `src/core/sheet-fetcher.ts:28` - `CORS_PROXY_URL` constant
- `src/core/sheet-fetcher.ts:249` - Used in `fetchWithTimeout()` function
- `src/ui/ui.ts:332` - Image fallback URL

**Reason:** The plugin now uses a Cloudflare Worker (`sheets-proxy.spidleweb.workers.dev`) as the primary proxy. The corsproxy.io service is no longer needed and these references are dead code.

**Impact:** Safe to remove - the worker handles both sheet data and image proxying.

---

## 🟡 DEPRECATED - Legacy Code with Replacements

### 2. `rawDataToWorksheet()` Function
**Status:** DEPRECATED - Explicitly marked as legacy in comments

**Location:** `src/core/sheet-fetcher.ts:1129-1169`

**Replacement:** `rawDataToWorksheetWithDetection()` from `sheet-structure.ts`

**Comment in code:**
```typescript
/**
 * This is the legacy version that assumes column-based structure (labels in first row).
 * For automatic structure detection, use rawDataToWorksheetWithDetection() from sheet-structure.ts.
 */
```

**Usage:** Only used in tests (`tests/unit/sheet-fetcher.test.ts`)

**Recommendation:**
- Remove function from production code
- Keep tests or migrate them to use the new function
- Remove export statement

---

## 🟠 POTENTIALLY UNUSED - Exported but Never Called

### 3. `clearCache()` Function
**Status:** EXPORTED but only used in tests

**Location:** `src/core/sheet-fetcher.ts:110-115`

**Imports:**
- Imported in `src/ui/ui.ts:12` but NEVER CALLED in the file
- Only actually used in `tests/unit/sheet-fetcher.test.ts`

**Recommendation:**
- Remove unused import from `ui.ts`
- Consider making function internal (not exported) if only needed for tests
- OR remove entirely if tests don't require it

### 4. `isFetchError()` Type Guard
**Status:** EXPORTED but NEVER CALLED anywhere

**Location:** `src/core/sheet-fetcher.ts:1194-1196`

**Usage:** Defined and exported, but no imports or calls found

**Recommendation:** Remove unless there's a planned use case

### 5. `fetchErrorToErrorType()` Function
**Status:** EXPORTED but NEVER CALLED anywhere

**Location:** `src/core/sheet-fetcher.ts:1201-1211`

**Usage:** Defined and exported, but no imports or calls found

**Recommendation:** Remove unless there's a planned use case

### 6. `setGoogleSheetsApiKey()` Function
**Status:** EXPORTED but NEVER CALLED anywhere

**Location:** `src/core/sheet-fetcher.ts:846-848`

**Context:** Used for Google Sheets API v4 authentication, but the plugin appears to work without it (relying on public sheet access or worker proxy).

**Recommendation:**
- Remove if not needed for future features
- Document if this is planned functionality
- The related `googleSheetsApiKey` variable and `fetchBoldInfo()` function would also need review

---

## 🔵 LEGACY FETCHING CODE - May Be Fallback

### 7. JSONP/gviz Fetching Functions

These functions implement the old JSONP-based fetching strategy, which may serve as fallback when the Cloudflare Worker is unavailable:

**Functions:**
- `fetchViaJsonp()` - `src/core/sheet-fetcher.ts:385-454`
- `fetchGvizData()` - `src/core/sheet-fetcher.ts:471-493`
- `fetchWorksheetViaGviz()` - `src/core/sheet-fetcher.ts:568-589`
- `extractLabelsFromGviz()` - `src/core/sheet-fetcher.ts:498-506`
- `gvizToRawData()` - `src/core/sheet-fetcher.ts:518-558`

**Related URL builders:**
- `buildJsonpUrl()` - `src/utils/url.ts:209-215`
- `buildJsonExportUrl()` - `src/utils/url.ts:188-194`

**Usage:** Currently used in `fetchSheetData()` as the fallback when worker is not configured (line 263 in ui.ts: "Using default JSONP fetcher")

**Recommendation:**
- **KEEP FOR NOW** - These serve as fallback when worker isn't configured
- Consider adding a deprecation warning to encourage worker usage
- Could be removed in a future version if worker becomes mandatory

### 8. CSV Export Fetching

**Functions:**
- `fetchWorksheetRaw()` - `src/core/sheet-fetcher.ts:301-364`
- `parseCSV()` - `src/core/sheet-fetcher.ts:148-215`
- `buildCsvExportUrl()` - `src/utils/url.ts:171-174`

**Usage:**
- `fetchWorksheetRaw()` uses CSV export endpoint
- Called by `parseCSV()` which is well-tested
- Part of the JSONP fallback strategy

**Recommendation:**
- **KEEP FOR NOW** - Part of fallback mechanism
- CSV parsing is solid and well-tested

---

## 🟣 DOCUMENTATION REFERENCES

### 9. CLAUDE.md References to Old Methods

**Location:** `CLAUDE.md:42`

**Current text:**
```
| `src/core/sheet-fetcher.ts` | Google Sheets data fetching (JSONP) |
```

**Recommendation:** Update to clarify this is fallback:
```
| `src/core/sheet-fetcher.ts` | Google Sheets data fetching (JSONP fallback) |
```

---

## 🟢 CONSOLE LOGGING - Debug vs. Production

### 10. Console Statements

**Locations with console.log/warn/error:**
Multiple files have console statements for debugging. Most are useful for troubleshooting, but some could be removed:

**Keep (useful for users/debugging):**
- Worker fetch status messages
- JSONP fallback notices
- Error warnings
- Sheet discovery logs

**Consider removing:**
- None identified as unnecessary - logging seems appropriate for a plugin

---

## Summary of Recommendations

### Remove Immediately:
1. ✅ corsproxy.io references (3 locations)
2. ✅ `rawDataToWorksheet()` legacy function
3. ✅ `clearCache` import from ui.ts (not used)
4. ✅ `isFetchError()` function (never used)
5. ✅ `fetchErrorToErrorType()` function (never used)
6. ✅ `setGoogleSheetsApiKey()` function (never used) - unless planned for future

### Keep (for now):
- JSONP/gviz functions - serve as fallback
- CSV parsing - part of fallback strategy
- Console logging - useful for debugging

### Update:
- CLAUDE.md documentation to clarify fallback strategy

---

## Implementation Priority

### High Priority (Safe to remove now):
1. corsproxy.io references
2. Unused exported functions (isFetchError, fetchErrorToErrorType)
3. Unused import (clearCache in ui.ts)

### Medium Priority (Review and decide):
1. setGoogleSheetsApiKey - is this planned functionality?
2. rawDataToWorksheet - migrate tests or remove entirely

### Low Priority (Future consideration):
1. JSONP/gviz fallback code - could deprecate if worker becomes mandatory
2. Consider making worker mandatory and removing all fallback code

---

## Files Requiring Changes

1. `src/core/sheet-fetcher.ts` - Remove corsproxy constant, unused functions
2. `src/ui/ui.ts` - Remove corsproxy fallback, remove unused clearCache import
3. `src/utils/url.ts` - Potentially remove buildJsonpUrl if JSONP is removed
4. `CLAUDE.md` - Update documentation
5. Tests - Update or remove tests for deprecated functions
