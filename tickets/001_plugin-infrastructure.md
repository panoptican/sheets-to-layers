## TICKET-001: Plugin Infrastructure & Project Setup

**Type:** Technical Task  
**Priority:** High  

### Description

Establish the foundational plugin architecture including project structure, build configuration, manifest setup, and core TypeScript types. This creates the scaffolding upon which all other features will be built.

### Requirements

- Initialize a TypeScript Figma plugin project with modern tooling
- Configure manifest.json with appropriate permissions and UI settings
- Establish the plugin's dual-context architecture (main thread + UI iframe)
- Define core TypeScript interfaces for data structures
- Set up message passing between UI and plugin contexts
- Configure build system (esbuild/webpack) for development and production

### Technical Specifications

**manifest.json:**

```json
{
  "name": "Sheets Sync",
  "id": "YOUR_PLUGIN_ID",
  "api": "1.0.0",
  "main": "dist/code.js",
  "ui": "dist/ui.html",
  "editorType": ["figma"],
  "documentAccess": "dynamic-page",
  "networkAccess": {
    "allowedDomains": [
      "docs.google.com",
      "sheets.googleapis.com", 
      "drive.google.com",
      "*.googleusercontent.com"
    ]
  },
  "relaunchButtons": [
    {"command": "open", "name": "Open Sheets Sync"},
    {"command": "resync", "name": "Re-Sync Google Sheets Data"}
  ]
}
```

**Core Type Definitions:**

```typescript
interface SheetData {
  worksheets: Worksheet[];
  activeWorksheet: string;
}

interface Worksheet {
  name: string;
  labels: string[];
  rows: Record<string, string[]>;
  orientation: 'columns' | 'rows';
}

interface LayerBinding {
  label: string;
  worksheet?: string;
  index: IndexType;
}

type IndexType = 
  | { type: 'specific'; value: number }
  | { type: 'increment' }
  | { type: 'incrementNonBlank' }
  | { type: 'random' }
  | { type: 'randomNonBlank' };

interface SyncContext {
  sheetData: SheetData;
  indexTrackers: Map<string, number>;
  randomHistory: Map<string, Set<number>>;
  scope: 'document' | 'page' | 'selection';
}

interface PluginMessage {
  type: string;
  payload?: any;
}
```

**File Structure:**

```
/src
  /core
    types.ts
    parser.ts
    sync-engine.ts
  /ui
    ui.tsx (or ui.html + ui.ts)
    styles.css
  code.ts (main plugin entry)
/dist
manifest.json
package.json
tsconfig.json
```

### Dependencies

None (foundational ticket)

### Acceptance Criteria

- [ ] Plugin loads in Figma without errors
- [ ] UI window displays when plugin is launched
- [ ] Message passing works bidirectionally between contexts
- [ ] TypeScript compiles without errors
- [ ] Development hot-reload works correctly
- [ ] Production build generates optimized bundle
- [ ] Relaunch buttons appear on nodes after initial run