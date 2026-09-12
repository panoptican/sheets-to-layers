# Sheets to Layers for Figma

Fill your Figma designs with Google Sheets data: update text, load images, swap components, and repeat layouts.

## Get started

Find **Sheets to Layers** in Figma Community, then open it from the **Plugins** menu in your design file.

1. **Prepare your sheet.** Put column headers in the first row, such as `Name`, `Price`, and `Photo`, with one item per row below. Set sharing to **Anyone with the link → Viewer** and copy the URL.
2. **Name your Figma layers.** Add `#` followed by a column header: `#Name` on a text layer, or `#Photo` on a shape to load an image URL.
3. **Choose what to update.** Select your layers or frame, paste the sheet URL into the plugin, and choose **Update current selection only**. You can also sync the current page or entire document.
4. **Click Fetch & Sync.** The plugin fills the bound layers with your sheet data.

```text
#Name       → Text from the Name column
#Name.2     → The second data row, excluding the header
#Photo      → Image fill from a URL in the Photo column
```

**Prefer to bind visually?** Choose your sync scope, then click **Fetch** to preview the sheet. Select a Figma layer and click a column header to bind it, or a cell to bind a specific row. Click **Sync** when ready.

**Updating later?** Edit your sheet, reopen the plugin, and click **Fetch & Sync** again. It remembers your last URL.

## Go further

- [Designer guide](DESIGNER_GUIDE.md): preview controls, layer naming, and row selection.
- [Images and components](DESIGNER_GUIDE.md#loading-images): image fills, component names, and variants.
- [Styling](DESIGNER_GUIDE.md#styling-with-special-values): colors, visibility, dimensions, and typography.
- [Repeating layouts and worksheets](DESIGNER_GUIDE.md#repeating-layouts): generate cards from rows and use multiple tabs.
- [Troubleshooting](DESIGNER_GUIDE.md#troubleshooting): sheets, bindings, fonts, and images.

## Development

With Node.js, npm, and Figma Desktop installed, run these commands from the project folder:

```sh
npm install
npm run dev
```

In Figma, choose **Plugins → Development → Import plugin from manifest** and select this project's `manifest.json`. Run **Sheets to Layers** from the **Development** menu.

See the [development guide](DEVELOPMENT.md) for build commands, tests, and architecture, or [Worker setup](worker/README.md) to host your own proxy.

## License

[MIT](LICENSE). Inspired by [Google Sheets Sync](https://docs.sheetssync.app/).
