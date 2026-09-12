# Sheets to Layers — Designer Guide

Start with the [quick start](README.md#get-started) for your first sync. This guide covers:

- [Preview and click to bind](#preview-and-click-to-bind)
- [Layer names and row selection](#layer-names-and-row-selection)
- [Loading images](#loading-images)
- [Swapping components](#swapping-components)
- [Styling with special values](#styling-with-special-values)
- [Repeating layouts](#repeating-layouts)
- [Using multiple worksheets](#using-multiple-worksheets)
- [Re-syncing](#re-syncing)
- [Troubleshooting](#troubleshooting)

## Preview and click to bind

Paste your Google Sheets URL, choose a sync scope, and click **Fetch** to preview the data. Select a layer in Figma, then click a preview control to rename it:

| Click | Binding applied | Example |
|-------|-----------------|---------|
| Column header | Column | `#Name` |
| Row number | Specific data row | `.2` |
| Cell | Column and data row | `#Name.2` |
| Worksheet name above the table | Worksheet | `// Products` |

Use the worksheet tabs to browse other tabs in your sheet. Click the worksheet name above the table to apply it to your selected layer or frame.

When your bindings are ready, select everything you want to update if using selection scope, then click **Sync**. Use **Back** to change the scope.

## Layer names and row selection

Add `#ColumnName` to a layer name, such as `Title #ProductName`. Use short, descriptive sheet headers. Bindings cannot contain spaces; `#FirstName` or `#first_name` matches a header named `First Name`. Matching ignores capitalization, spaces, underscores, and hyphens.

| Syntax | Meaning |
|--------|---------|
| `#Name` | Use successive values from the Name column |
| `#Name.2` | Always use the second data row |
| `#Name.n` | Explicitly use successive rows |
| `#Name.i` | Use successive rows, skipping blank values |
| `#Name.x` | Pick a random row |
| `#Name.r` | Pick a random row, skipping blank values |
| `// Products` | Use the Products worksheet |
| `-Background` | Skip this layer and its children |
| `+MainComponent` | Include a main component, which is normally skipped |
| `Cards @#` | Repeat an Auto Layout frame's children to match the data |

**Row numbers start at 1 after the header.** With headers in sheet row 1, `.1` reads sheet row 2. Put the row suffix at the end of the layer name: `Card // Products #Name.2`.

Without a row suffix, layers bound to the same column use successive values and wrap back to the start when they run out. Use `.1` when every layer should show the first value.

Worksheets and row settings inherit from parent layers unless a child supplies its own:

```text
ProductCard // Products .2
  ├─ #Name     → Second Name value in Products
  └─ #Price    → Second Price value in Products
```

## Loading images

Put a publicly accessible image URL in a sheet column, then bind a shape or frame to it. For example, name a rectangle `Avatar #ProfilePic` and put `https://example.com/user.jpg` in the `ProfilePic` column.

Use direct image URLs, Unsplash image URLs, or public Google Drive and Dropbox image links. The URL must return image data the plugin can load; a link to a general web page will not work as an image fill.

## Swapping components

Bind a **component instance** to a column containing component names. For example, an instance named `#ButtonType` can read `Button/Primary` or `Button/Secondary` from the sheet. Matching ignores capitalization and normalizes spaces and separators.

For variants, use property/value pairs in the cell:

```text
team=LAA
size=Large, style=Filled
```

Keep the target components in the sync scope. If a component cannot be found while syncing a selection, try the current page; use the entire document for components on other pages.

## Styling with special values

Put these values in spreadsheet cells to change the bound layer's properties:

| Property | Cell values |
|----------|-------------|
| Visibility | `show`, `hide` |
| Fill color | `#FF5500`, `#F90`, `#80` (gray) |
| Opacity | `50%` |
| Width, height, square size | `200w`, `100h`, `100s` |
| Position relative to parent | `100x`, `50y` |
| Position on the page | `100xx`, `50yy` |
| Rotation | `45º` |
| Font size | `font-size:24` |
| Horizontal text alignment | `text-align:left`, `text-align:center`, `text-align:right`, `text-align:justified` |
| Vertical text alignment | `text-align-vertical:top`, `text-align-vertical:center`, `text-align-vertical:bottom` |
| Line height | `line-height:32`, `line-height:150%`, `line-height:auto` |
| Letter spacing | `letter-spacing:2`, `letter-spacing:5%` |

Typography values apply to text layers only. Line height and letter spacing without `%` use pixels.

### Styles on text and instances

Text layers treat the first binding as text content, and instances treat it as a component name. Start the **cell value** with `/` to apply styling instead:

```text
/hide             → Hide the layer
/#FF0000          → Apply a red fill
/50%, #FF0000     → Apply opacity and color
```

Bound text layers hide when their cell is empty and show when it has a value. You can design a layer hidden by default so it appears only on cards with data.

### Text and style from separate columns

Give a text layer multiple bindings. The first sets its content; additional bindings apply styles:

**Layer name:** `#Price #PriceStyle`

| Price | PriceStyle |
|-------|------------|
| $29.99 | #008000, font-size:18 |
| $99.99 | #FF0000, font-size:24 |

Combine special values in one cell with commas or spaces, such as `#F00, 50%` or `font-size:24, text-align:center`.

## Repeating layouts

1. Create an **Auto Layout** frame and add `@#` to its name.
2. Design its first child as a template, with bound layers inside.
3. Sync the frame to create one child per data row.

```text
ProductCards @# // Products
  └─ Card Template
       ├─ #Name
       ├─ #Price
       └─ #Photo
```

With five Name values in Products, the frame gets five cards. The first bound column determines the count. Syncing adds copies of the first child or removes excess children to match that count.

## Using multiple worksheets

Add `// WorksheetName` to a layer or frame name. Children inherit that worksheet:

```text
Page Frame
  ├─ Header // Settings
  │    └─ #SiteName
  └─ ProductCards @# // Inventory
       └─ Card Template
            ├─ #Name
            └─ #Price
```

You can also apply a worksheet through the [preview](#preview-and-click-to-bind).

## Re-syncing

After editing your sheet, reopen the plugin and click **Fetch & Sync**. The plugin remembers your last URL. Synced layers also offer **Re-Sync Google Sheets Data** in Figma's layer properties panel for targeted updates.

## Troubleshooting

- **Sheet not accessible:** Set Google Sheets sharing to **Anyone with the link → Viewer** and check that you pasted a Google Sheets URL.
- **No layers found or text unchanged:** Check the `#ColumnName` binding, worksheet, and sync scope. A `-` prefix on the layer or a parent skips it.
- **Wrong row:** Row numbers exclude the header. Use `.N` for a fixed row, `.n` to advance, or `.i` to skip blanks.
- **Wrong headers in preview:** Keep headers in the first row and try making that row bold to help the plugin recognize them.
- **Font not available:** Install the missing font or change the layer to an available font, then sync again. Text with missing fonts is skipped.
- **Images not loading:** Check that the URL is public and returns image data. Some hosts block image requests.
- **Component not swapping:** Check the component name or variant properties, then expand the scope to include the target component.
- **Frame not repeating:** Enable Auto Layout, add `@#`, and include a child template with at least one matching binding.

For build and proxy issues, see the [development guide](DEVELOPMENT.md) and [Worker setup](worker/README.md).
