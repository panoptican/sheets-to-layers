# Sheets to Layers - Designer Guide

Connect your Figma designs to Google Sheets data. Update text, images, colors, and components automatically.

---

## Getting Started

### Step 1: Prepare Your Spreadsheet

1. Open your Google Sheet
2. Click **Share** > Set to **"Anyone with the link can view"**
3. Copy the URL

Your sheet should have column headers in the first row:

| Name | Price | Image | Status |
|------|-------|-------|--------|
| Product A | $29 | https://... | active |
| Product B | $49 | https://... | sold |

### Step 2: Name Your Layers

Add `#ColumnName` to any layer name to bind it to that column:

```
#Name       → Gets text from "Name" column
#Price      → Gets text from "Price" column
#Image      → Loads image from "Image" column URL
#Status     → Swaps component based on "Status" column
```

### Step 3: Run the Plugin

1. Select your layers (or the whole page)
2. Right-click > **Plugins** > **Sheets to Layers**
3. Paste your Google Sheets URL
4. Click **Fetch & Sync**

---

## Layer Naming Cheat Sheet

| What You Want | Layer Name | Sheet Cell |
|---------------|------------|------------|
| Set text | `#Title` | `Hello World` |
| Load image | `#Photo` | `https://example.com/image.jpg` |
| Set color | `#Color` | `#FF0000` |
| Show/hide | `#Visible` | `show` or `hide` |
| Swap component | `#Icon` | `icon=star` |
| Specific row | `#Title.3` | (uses row 3) |
| Random row | `#Title.x` | (picks randomly) |

---

## Binding Text

Name your text layer with `#` followed by the column name:

**Layer name:** `#ProductName`

| ProductName |
|-------------|
| Wireless Headphones |
| Smart Watch |
| Laptop Stand |

The text layer will display "Wireless Headphones" (first row).

### Using Specific Rows

Add `.N` to use a specific row:

| Layer Name | Result |
|------------|--------|
| `#ProductName` | Row 1 (default) |
| `#ProductName.1` | Row 1 |
| `#ProductName.2` | Row 2 |
| `#ProductName.3` | Row 3 |

### Auto-Increment

Use `.n` to automatically use the next row for each layer:

```
Card 1
  └─ #Name.n     → "Wireless Headphones"
Card 2
  └─ #Name.n     → "Smart Watch"
Card 3
  └─ #Name.n     → "Laptop Stand"
```

---

## Loading Images

Put image URLs in your spreadsheet. Name a shape layer (Frame, Rectangle, Ellipse) with `#ColumnName`:

**Layer name:** `Avatar #ProfilePic`

| ProfilePic |
|------------|
| https://example.com/user1.jpg |
| https://example.com/user2.jpg |

The shape's fill will be replaced with the image.

**Supported sources:**
- Direct image URLs (ending in .jpg, .png, .gif, .webp, .svg)
- Unsplash
- Google Drive (public)
- Dropbox (public)

---

## Styling with Special Values

Control colors, opacity, size, and more from your spreadsheet.

### Colors

| Cell Value | Result |
|------------|--------|
| `#FF0000` | Red |
| `#00FF00` | Green |
| `#0000FF` | Blue |
| `#F90` | Orange (shorthand) |

### Opacity

| Cell Value | Result |
|------------|--------|
| `100%` | Fully visible |
| `50%` | Half transparent |
| `0%` | Invisible |

### Visibility

| Cell Value | Result |
|------------|--------|
| `show` | Layer visible |
| `hide` | Layer hidden |

### Size

| Cell Value | Result |
|------------|--------|
| `200w` | Width = 200px |
| `100h` | Height = 100px |
| `50s` | Width & Height = 50px |

### Rotation

| Cell Value | Result |
|------------|--------|
| `45º` | Rotate 45 degrees |
| `90º` | Rotate 90 degrees |

*(Use the degree symbol: Option+0 on Mac, Alt+0176 on Windows)*

---

## Text Styling

For text layers, you can control typography:

| Cell Value | Result |
|------------|--------|
| `font-size:24` | 24px font |
| `text-align:center` | Center aligned |
| `text-align:right` | Right aligned |
| `text-align-vertical:bottom` | Align to bottom |
| `line-height:32` | 32px line height |
| `line-height:150%` | 150% line height |
| `letter-spacing:2` | 2px letter spacing |

---

## Combining Text + Styling

Use multiple bindings to set text AND style from different columns:

**Layer name:** `#Price #PriceColor`

| Price | PriceColor |
|-------|------------|
| $29.99 | #008000 |
| $99.99 | #FF0000 |

- First binding (`#Price`) → sets the text
- Second binding (`#PriceColor`) → sets the color

You can chain multiple styles in one column:

| PriceStyle |
|------------|
| #008000, font-size:18 |
| #FF0000, font-size:24 |

---

## Swapping Components

Swap component instances based on data values.

### By Component Name

**Layer name:** `#ButtonType`

| ButtonType |
|------------|
| Button/Primary |
| Button/Secondary |
| Button/Outline |

### By Variant Properties

If your component has variants, use `property=value` syntax:

**Layer name:** `#TeamBadge`

| TeamBadge |
|-----------|
| team=LAA |
| team=LAD |
| team=NYY |

For multiple properties:
```
size=Large, style=Filled
```

---

## Repeating Layouts

Automatically duplicate items to match your data rows.

1. Create an **Auto Layout** frame
2. Add `@#` to the frame name
3. Design one child as a template

**Before sync:**
```
ProductList @#
  └─ Card Template
       └─ #Name
       └─ #Price
```

**After sync (if sheet has 4 rows):**
```
ProductList @#
  └─ Card Template (Name: Product A, Price: $29)
  └─ Card Template (Name: Product B, Price: $49)
  └─ Card Template (Name: Product C, Price: $79)
  └─ Card Template (Name: Product D, Price: $99)
```

---

## Using Multiple Worksheets

Reference different tabs in your spreadsheet with `// WorksheetName`:

**Layer name:** `Header // Settings`

```
Page Frame
  └─ Header // Settings      → Uses "Settings" tab
       └─ #SiteName
  └─ Products // Inventory   → Uses "Inventory" tab
       └─ #ProductName
```

Children inherit the worksheet from their parent.

---

## Ignoring Layers

Prefix with `-` to skip a layer and its children:

```
-Background       → Ignored during sync
-Reference Image  → Ignored during sync
```

---

## Quick Reference

### Layer Name Syntax

| Syntax | Meaning |
|--------|---------|
| `#Label` | Bind to "Label" column |
| `#Label.N` | Use row N specifically |
| `#Label.n` | Auto-increment rows |
| `#Label.x` | Random row |
| `// Tab` | Use worksheet tab |
| `@#` | Repeat children to match rows |
| `-Name` | Ignore this layer |

### Special Values

| Type | Examples |
|------|----------|
| Color | `#FF0000`, `#F00`, `#80` |
| Opacity | `50%`, `100%` |
| Visibility | `show`, `hide` |
| Size | `200w`, `100h`, `50s` |
| Position | `100x`, `50y` |
| Rotation | `45º` |
| Font size | `font-size:24` |
| Alignment | `text-align:center` |
| Line height | `line-height:150%` |
| Letter spacing | `letter-spacing:2` |

### For Text Layers

Use `/` prefix when the first binding should apply styles instead of setting text:

| Cell | Result |
|------|--------|
| `Hello` | Text = "Hello" |
| `/#FF0000` | Color = red (text unchanged) |
| `/hide` | Layer hidden (text unchanged) |

---

## Troubleshooting

**"Sheet not publicly accessible"**
→ Make sure sharing is set to "Anyone with the link can view"

**Text not updating**
→ Check that layer name has `#` followed by exact column name

**Images not loading**
→ Verify the URL is public and points directly to an image

**Component not swapping**
→ Make sure the component is on the same page or use "Document" sync scope

**Wrong row showing**
→ Use `.N` suffix for specific rows, or `.n` for auto-increment

---

## Tips

1. **Use Preview Mode** - Click "Fetch" (not "Fetch & Sync") to preview data before syncing

2. **Click to Bind** - In preview mode, click column headers to quickly add bindings to selected layers

3. **Organize Your Sheet** - Keep column headers short and descriptive

4. **Test with Selection** - Sync just selected layers first to verify your bindings work

5. **Re-Sync Quickly** - The plugin remembers your last URL, just click "Fetch & Sync" again
