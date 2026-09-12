# Sheets to Layers — Designer Guide

Start with the [quick start](README.md#get-started) for your first sync. This guide covers:

- [Preview and click to bind](#preview-and-click-to-bind)
- [Layer names and row selection](#layer-names-and-row-selection)
- [Reviewing a sync](#reviewing-a-sync)
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

When your bindings are ready, select everything you want to update if using selection scope, then click **Review sync**. Use **Back** to change the scope. The review is a preflight: it reports matched bindings, repeat additions and removals, missing labels or worksheets, unavailable fonts, component targets, and other issues before mutation. Blocking issues have an **Exclude** checkbox. Apply is enabled only after every blocking issue is resolved or explicitly excluded.

The preview is paginated for large sheets and renders at most 2,000 cells at a time: 100 rows and as many columns as fit under that cell budget. A spreadsheet may contain up to 200 worksheet tabs, each worksheet may contain up to 100,000 cells, and one import may contain up to 500,000 cells. The transport also rejects a worksheet response over 5 MiB. If a source exceeds a limit, the plugin reports the limit in the fetch result instead of importing the oversized response.

The **worksheet** tabs control which data you are browsing. The **Default worksheet for sync** control separately chooses the worksheet used when a binding has no `// Worksheet` instruction. Changing tabs does not silently change that sync default. The orientation control changes one worksheet between **Headers in first row** (`columns`) and **Headers in first column** (`rows`) using the raw cells retained in the snapshot; it does not refetch the sheet. Blank text policy is also part of the pending sync: **Clear and hide blank text** is the default, while **Leave blank text unchanged** preserves an existing text value and visibility.

The default Worker/API-key path discovers all worksheet tabs. If Worker mode is disabled, the JSONP fallback must receive a script before it can inspect the payload, so it cannot stream-cap the response beforehand. It estimates the callback's UTF-8 serialized payload against the 5 MiB limit and validates the 100,000-cell worksheet limit before converting it. Its worksheet discovery is a bounded probe of likely `gid` values, so tabs with arbitrary IDs may be absent; the result shows a warning and recommends Worker/API-key mode for complete discovery.

## Reviewing a sync

The review screen is the last step before applying a sync. It can show:

- the number of matched bindings and the selected scope;
- repeat-frame additions and removals, including the child IDs that would be removed;
- blocking errors such as missing roots, labels, worksheets, fonts, image targets, or component targets; and
- warnings that can be excluded when you accept the affected operation being skipped.

Select **Exclude** only for an issue you have reviewed. Exclusion skips its affected operation; it does not repair the source or layer. Repeat-frame removals always require this review. An empty worksheet never removes the only reusable repeat template: the repeat is skipped with a warning so you can decide what to do.

After **Apply approved changes**, image fills are fetched and applied before the final result is emitted. The result reports changed, unchanged, skipped, and failed layers. If you cancel, earlier mutations can remain in the document; use Figma's normal **Undo** command if you need to reverse them. The plugin does not provide an automatic rollback.

## Layer names and row selection

Add `#ColumnName` to a layer name, such as `Title #ProductName`. Unquoted labels use letters, numbers, `_`, and `-` without spaces. For a header containing spaces or parser punctuation, quote the label: `#"First Name"`. A quote or backslash inside a quoted label is escaped with `\`, for example `#"Size \"Large\""`. `#FirstName` and `#first_name` both match a header named `First Name`; matching ignores capitalization, spaces, underscores, and hyphens.

| Syntax | Meaning |
|--------|---------|
| `#Name` | Use successive values from the Name column |
| `#Name.2` | Always use the second data row |
| `#Name.n` | Explicitly use successive rows |
| `#Name.i` | Use successive rows, skipping blank values |
| `#Name.x` | Pick a random row |
| `#Name.r` | Pick a random row, skipping blank values |
| `// Products` | Use the Products worksheet |
| `// "Q1 / East"` | Use a worksheet name containing spaces or `/` |
| `-Background` | Skip this layer and its children |
| `+MainComponent` | Include a main component, which is normally skipped |
| `Cards @#` | Repeat an Auto Layout frame's children to match the data |

**Row numbers start at 1 after the header.** With headers in sheet row 1, `.1` reads sheet row 2. Put the row suffix at the end of the layer name: `Card // Products #Name.2`.

Without a row suffix, layers bound to the same column use successive values and wrap back to the start when they run out. Use `.1` when every layer should show the first value.

Worksheets and row settings inherit from parent layers unless a child supplies its own. Quoted worksheet names use the same backslash escaping as quoted labels:

```text
ProductCard // Products .2
  ├─ #Name     → Second Name value in Products
  └─ #Price    → Second Price value in Products
```

## Loading images

Put a publicly accessible image URL in a sheet column, then bind a shape or frame to it. For example, name a rectangle `Avatar #ProfilePic` and put `https://example.com/user.jpg` in the `ProfilePic` column.

Use direct HTTPS image URLs, Unsplash image URLs, or public Google Drive and Dropbox image links. The URL must return PNG, JPEG, or GIF image data; a link to a general web page will not work as an image fill. Images are limited to 20 MiB and may follow up to three HTTPS redirects. URLs with credentials or private, local, or proxy hosts are rejected by the Worker. During one sync, duplicate image URLs share one network request while each bound layer receives its own image result. If the configured Worker cannot fetch an image and the optional `corsproxy.io` fallback is enabled in Settings, the complete image URL, including query parameters, is sent to that third-party provider.

## Swapping components

Bind a **component instance** to a column containing component names. For example, an instance named `#ButtonType` can read `Button/Primary` or `Button/Secondary` from the sheet. Matching ignores capitalization and normalizes spaces and separators.

For variants, use property/value pairs in the cell:

```text
team=LAA
size=Large, style=Filled
```

The preflight component cache scans all pages in the document, so a target does not need to be inside the layer roots being updated. An unqualified component name must resolve to exactly one cached component; duplicate names produce an ambiguity issue. Property-only values such as `size=Large` resolve within the component set of the current instance. To target a different family, qualify the value with its component set, for example `Button/size=Large`; that family must be discoverable in the document and the qualified match must be unique. Components are normally skipped as traversal roots; prefix a component name with `+` when you intentionally want to include its main component in the sync.

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

With five Name values in Products, the frame gets five cards. The first bound column determines the count. Syncing adds copies of the first child or removes excess children to match that count. If the source column has no values, the plugin preserves the only template child and reports that repetition was skipped. Any non-empty removal is shown in preflight and requires review before it can be applied.

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

You can also apply a worksheet through the [preview](#preview-and-click-to-bind). The worksheet tab you are browsing and the default worksheet used by unqualified bindings are separate controls; select the default explicitly when the two should differ.

## Re-syncing

After editing your sheet, reopen the plugin and click **Fetch & Sync**. The plugin remembers your last URL as a convenience, but that recent URL is not the authority for document re-sync. After a successful or partial completed run, the document stores the source URL, spreadsheet identity, scope, exact roots, page identity when applicable, default worksheet, orientation choices, and blank-text policy. Synced layers also offer **Re-Sync Google Sheets Data** through Figma's relaunch action for a targeted repeat of that saved scope. The saved configuration is updated only after the operation completes, including image settlement; cancelled or incomplete runs leave the previous configuration intact.

Re-sync uses the saved roots even if another page is currently active. If a saved page or layer root was removed, the review reports the missing root and retains the intended scope. If all saved roots are gone, the operation stops until you choose a new explicit scope; it never widens to the current page. **Refresh** starts a new fetch from the current URL and snapshot. **Retry failed** reuses the original completed plan and row choices for only failed bindings, without rerunning repeat-frame structure changes. If a target changed since review, retry skips it and asks you to refresh.

## Troubleshooting

- **Sheet not accessible:** Set Google Sheets sharing to **Anyone with the link → Viewer** and check that you pasted a Google Sheets URL.
- **No layers found or text unchanged:** Check the `#ColumnName` binding, worksheet, and sync scope. A `-` prefix on the layer or a parent skips it.
- **Wrong row:** Row numbers exclude the header. Use `.N` for a fixed row, `.n` to advance, or `.i` to skip blanks.
- **Wrong headers in preview:** Keep headers in the first row and try making that row bold to help the plugin recognize them.
- **Wrong orientation or worksheet:** Use the worksheet tabs to browse, choose the intended **Default worksheet for sync**, and switch the orientation control. Orientation changes use the fetched raw cells locally and do not require another request.
- **Font not available:** Install the missing font or change the layer to an available font, then sync again. Text with missing fonts is skipped.
- **Images not loading:** Check that the URL is public and returns image data. Some hosts block image requests.
- **Component not swapping:** Check the component name or variant properties. Property-only variants apply to the current instance's component set; use a qualified `Family/Property=Value` value for another family. Resolve duplicate names or component sets reported by preflight.
- **Frame not repeating:** Enable Auto Layout, add `@#`, and include a child template with at least one matching binding.
- **Unexpected repeat removal:** Review the preflight removal list. Empty source data preserves the template and skips repetition; non-empty removals require explicit review.
- **Cancelled sync changed some layers:** Cancellation does not roll back mutations already completed. Use Figma's **Undo** command, then start a fresh sync if needed.
- **Image fallback privacy:** The optional `corsproxy.io` setting sends the complete image URL to that provider. Leave it disabled when the Worker can fetch the source directly.

For build and proxy issues, see the [development guide](DEVELOPMENT.md) and [Worker setup](worker/README.md).
