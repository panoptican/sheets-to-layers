# Sheets to Layers for Figma

Sync content from Google Sheets directly into your Figma designs. Update text, swap components, load images, and apply styling - all driven by spreadsheet data.

## Features

- **Text Sync** - Update text layers with spreadsheet content
- **Image Loading** - Fill shapes with images from URLs in your sheet
- **Component Swapping** - Swap component instances based on data values
- **Layer Repetition** - Auto-duplicate layers to match your data row count
- **Special Data Types** - Apply colors, opacity, dimensions, rotation, and more
- **Multi-Worksheet Support** - Pull data from different tabs in one sheet
- **Index Control** - Specify exact rows, auto-increment, or randomize

## Installation

### From Figma Community
1. Visit the plugin page on Figma Community
2. Click "Install"
3. Access via Right-click > Plugins > Sheets to Layers

### For Development
See the [Development](#development) section below.

## Quick Start

### 1. Prepare Your Google Sheet
Make sure your sheet is publicly accessible:
- Click "Share" in Google Sheets
- Set to "Anyone with the link can view"
- Copy the share link

### 2. Name Your Layers Using Preview Mode
The easiest way to bind layers is using the interactive preview:

1. Open the plugin: Right-click > Plugins > Sheets to Layers
2. Paste your Google Sheets URL
3. Click **"Fetch"** (not "Fetch & Sync") to preview your data
4. Select a layer in Figma that you want to bind
5. In the preview, click to rename the selected layer:
   - **Column header** → Adds `#ColumnName` (binds to that column)
   - **Row number** → Adds `.N` (uses that specific row)
   - **Cell** → Adds `#ColumnName.N` (specific column and row)
   - **Worksheet name** → Adds `// WorksheetName` (uses that tab)
6. Repeat for other layers, then click **"Sync"**

### 3. Manual Layer Naming (Alternative)
You can also name layers manually by adding `#` followed by a column header:
```
#Title          → Syncs with "Title" column
#ProductName    → Syncs with "ProductName" column
#hero_image     → Syncs with "hero_image" column
```

### 4. Run the Plugin
1. Right-click > Plugins > Sheets to Layers
2. Paste your Google Sheets URL
3. Select sync scope (Document, Page, or Selection)
4. Click "Fetch & Sync"

## Layer Naming Reference

### Basic Syntax

| Syntax | Description | Example |
|--------|-------------|---------|
| `#Label` | Bind to column "Label" | `#Title` |
| `#Label.N` | Use specific row N (1-based) | `#Title.5` |
| `#Label.n` | Auto-increment through rows | `#Title.n` |
| `#Label.i` | Increment, skip blanks | `#Title.i` |
| `#Label.x` | Random row | `#Title.x` |
| `#Label.r` | Random row, skip blanks | `#Title.r` |
| `// Worksheet` | Use specific worksheet tab | `Frame // Products` |
| `-LayerName` | Ignore this layer and children | `-IgnoreMe` |
| `+Component` | Force include main component | `+MyComponent` |
| `@#` | Repeat frame children to match data | `Cards @#` |

### Examples

```
#Title                    → First title value
#Price.3                  → Third price value
#Name.n                   → Auto-incrementing names
Card // Products          → Children use "Products" worksheet
-Background               → Ignored during sync
+ButtonComponent #Label   → Main component that syncs
Items @# // Inventory     → Repeat children to match Inventory rows
```

### Multiple Labels
Apply multiple values to a single layer:
```
#FirstName #LastName      → Concatenates both values
```

### Inheritance
Worksheets and indexes inherit from parent layers:
```
ProductCard // Products .n    → Parent sets worksheet and index type
  └─ #Name                    → Inherits Products worksheet, auto-increments
  └─ #Price                   → Inherits Products worksheet, auto-increments
```

## Special Data Types

Special data types let you control layer properties beyond text content. Use them in your spreadsheet cells.

### Visibility
| Value | Effect |
|-------|--------|
| `show` | Make layer visible |
| `hide` | Hide layer |

### Colors (Hex)
Apply fill colors to shapes:
| Format | Example |
|--------|---------|
| `#RGB` | `#F00` (red) |
| `#RRGGBB` | `#FF5500` (orange) |

### Opacity
| Format | Example |
|--------|---------|
| `N%` | `50%` (half transparent) |

### Dimensions
| Format | Effect | Example |
|--------|--------|---------|
| `Nw` | Set width | `200w` |
| `Nh` | Set height | `100h` |
| `NxM` | Set both | `200x100` |

### Position
| Format | Effect | Example |
|--------|--------|---------|
| `@Nx` | Set X position | `@100x` |
| `@Ny` | Set Y position | `@50y` |
| `@NxMy` | Set both | `@100x50y` |

### Rotation
| Format | Example |
|--------|---------|
| `Ndeg` | `45deg` |
| `Nr` | `90r` |

### Text Properties (for text layers)
| Format | Effect | Example |
|--------|--------|---------|
| `Npt` | Font size | `24pt` |
| `left`, `center`, `right` | Horizontal align | `center` |
| `top`, `middle`, `bottom` | Vertical align | `middle` |
| `Nlh` or `N%lh` | Line height | `1.5lh` or `150%lh` |
| `Nls` or `N%ls` | Letter spacing | `2ls` or `5%ls` |

### Chained Values
Combine multiple special types in one cell:
```
#F00 50%           → Red at 50% opacity
200w 100h 45deg    → Size and rotation
24pt center        → Font size and alignment
```

### Special Prefix for Text/Instance Layers
Text and Instance layers interpret values as content by default. Prefix with `/` to apply special types:
```
/50%               → Apply 50% opacity (not set text to "50%")
/#FF0000           → Apply red fill color
```

## Image Loading

Any URL ending in an image extension (`.jpg`, `.png`, `.gif`, `.webp`, `.svg`) or from known image hosts will be loaded as an image fill:

**Supported URL patterns:**
- Direct image URLs: `https://example.com/image.png`
- Unsplash: `https://images.unsplash.com/...`
- Google Drive: `https://drive.google.com/file/d/.../view`
- Dropbox: `https://dropbox.com/...`

**Usage:**
1. Add image URLs to a column in your sheet
2. Name a shape layer (Frame, Rectangle, etc.) with `#ColumnName`
3. The shape's fill will be replaced with the image

## Component Swapping

Swap component instances based on spreadsheet values:

1. **Setup:** Have components in your file (e.g., `Button/Primary`, `Button/Secondary`)
2. **In your sheet:** Use the component name as the cell value
3. **Name the instance:** `#Status` where Status column contains component names

The plugin will find components by normalized name matching (case-insensitive, ignores separators).

## Layer Repetition (@#)

Automatically duplicate layers to match your data:

1. Create an Auto Layout frame
2. Add `@#` to the frame name (e.g., `ProductCards @#`)
3. Design one child as a template with bound labels
4. On sync, children are duplicated to match row count

```
ProductCards @# // Products
  └─ Card Template
       └─ #Name
       └─ #Price
       └─ #Image
```

If Products has 5 rows, you'll get 5 cards.

## Re-Sync

After your initial sync, you can quickly update:

1. **Via Plugin Menu:** Run the plugin again - it remembers your last URL
2. **Via Relaunch Button:** Click "Re-Sync Google Sheets Data" in the layer's properties panel

The plugin stores sync metadata on layers, enabling targeted updates.

## Development

### Prerequisites
- Node.js 18+
- npm
- Figma Desktop App

### Setup
```bash
# Clone the repository
git clone https://github.com/your-repo/figma-sheets.git
cd figma-sheets

# Install dependencies
npm install

# Start development mode (watches for changes)
npm run dev
```

### Import into Figma
1. Open Figma Desktop
2. Go to Plugins > Development > Import plugin from manifest
3. Select the `manifest.json` file from this project
4. Access via Right-click > Plugins > Development > Sheets to Layers

### Build
```bash
# Production build
npm run build

# Type checking
npm run typecheck
```

### Testing
```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# Unit tests only
npm run test:unit

# Integration tests only
npm run test:int

# With coverage
npm test -- --coverage
```

### Linting & Formatting
```bash
npm run lint
npm run format
```

## Architecture

```
┌─────────────────────────────────────────────────────┐
│ Main Thread (code.ts)                               │
│ - Access to Figma document/nodes                    │
│ - Sync engine orchestration                         │
│ - Layer traversal and updates                       │
└─────────────────────┬───────────────────────────────┘
                      │ postMessage / onmessage
┌─────────────────────┴───────────────────────────────┐
│ UI Thread (ui.ts)                                   │
│ - iframe with network access                        │
│ - Fetches Google Sheets data via Cloudflare Worker  │
│ - User interface and state management               │
└─────────────────────────────────────────────────────┘
```

### Key Modules

| Module | Purpose |
|--------|---------|
| `src/code.ts` | Plugin entry point, command handling |
| `src/core/sync-engine.ts` | Main sync orchestration |
| `src/core/traversal.ts` | Layer tree traversal |
| `src/core/parser.ts` | Layer name parsing |
| `src/core/special-types.ts` | Special data type parsing/application |
| `src/core/text-sync.ts` | Text layer updates |
| `src/core/image-sync.ts` | Image loading and application |
| `src/core/component-swap.ts` | Component swapping logic |
| `src/core/repeat-frame.ts` | Auto-duplication for @# frames |
| `src/core/index-tracker.ts` | Row index management |
| `src/core/worker-fetcher.ts` | Cloudflare Worker data fetching |
| `src/ui/ui.ts` | Plugin UI |

### Data Flow

1. **User enters URL** → UI parses and validates
2. **Fetch data** → Worker fetches from Google Sheets API
3. **Parse structure** → Detect orientation, normalize to rows
4. **Traverse layers** → Single-pass collection of bound layers
5. **Process repeat frames** → Duplicate children as needed
6. **Batch font loading** → Load all required fonts in parallel
7. **Process layers** → Apply values in chunks, yield to UI
8. **Queue images** → Send image URLs back to UI for fetching
9. **Apply images** → UI fetches, sends data back, main thread applies

## Project Structure

```
figma-sheets/
├── src/
│   ├── code.ts              # Main thread entry
│   ├── messages.ts          # Message type definitions
│   ├── core/                # Core sync logic
│   │   ├── types.ts         # Shared TypeScript interfaces
│   │   ├── parser.ts        # Layer name parsing
│   │   ├── sync-engine.ts   # Main orchestration
│   │   └── ...
│   ├── ui/                  # UI code
│   │   ├── ui.ts            # UI logic
│   │   └── styles.css       # Figma-themed styles
│   └── utils/               # Utility functions
├── tests/
│   ├── unit/                # Unit tests
│   ├── integration/         # Integration tests
│   └── mocks/               # Mock Figma API
├── dist/                    # Build output
├── manifest.json            # Figma plugin manifest
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## Troubleshooting

### "Sheet not publicly accessible"
- Ensure the sheet is shared with "Anyone with the link can view"
- Check that you're using a Google Sheets URL (not a different Google service)

### "No layers with bindings found"
- Verify layer names include `#` followed by the column name
- Check that the column name in Figma matches the sheet header exactly (case-insensitive)

### "Font not available"
- The required font isn't installed on your system
- Figma will use a fallback font for affected text

### Images not loading
- Verify the URL is publicly accessible
- Check that the URL points directly to an image or uses a supported host
- Some hosts block cross-origin requests

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run tests (`npm test`)
5. Commit your changes (`git commit -m 'Add amazing feature'`)
6. Push to the branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

## License

MIT License - see [LICENSE](LICENSE) for details.

## Acknowledgments

- Inspired by the original [Google Sheets Sync](https://docs.sheetssync.app/) plugin
- Built with the [Figma Plugin API](https://www.figma.com/plugin-docs/)
