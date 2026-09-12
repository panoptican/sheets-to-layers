# Sheets to Layers for Figma

Fill your Figma designs with Google Sheets data: update text, load images, swap components, and repeat layouts.

## Get started

Find **Sheets to Layers** in Figma Community, then open it from the **Plugins** menu in your design file.

1. **Prepare your sheet.** Put column headers in the first row, such as `Name`, `Price`, and `Photo`, with one item per row below. Set sharing to **Anyone with the link → Viewer** and copy the URL.
2. **Name your Figma layers.** Add `#` followed by a column header: `#Name` on a text layer, or `#Photo` on a shape to load an image URL.
3. **Choose what to update.** Select your layers or frame, paste the sheet URL into the plugin, and choose **Update current selection only**. You can also sync the current page or entire document. A page scope follows that page; a selection or document scope saves the exact roots used for the completed run.
4. **Click Fetch & Sync.** The plugin fills the bound layers with your sheet data.

```text
#Name       → Text from the Name column
#Name.2     → The second data row, excluding the header
#Photo      → Image fill from a URL in the Photo column
```

**Prefer to bind visually?** Choose your sync scope, then click **Fetch** to preview the sheet. Select a Figma layer and click a column header to bind it, or a cell to bind a specific row. Click **Review sync** when ready. The review lists proposed repeat-frame changes and data or layer issues; blocking issues must be excluded explicitly before **Apply approved changes** is enabled.

**Updating later?** Edit your sheet, reopen the plugin, and click **Fetch & Sync** again. The plugin remembers the last URL for convenience. After a completed successful or partial run, Figma's **Re-Sync Google Sheets Data** relaunch command uses the saved source, scope, worksheet, and interpretation settings. A failed or cancelled run does not replace that saved configuration. If saved roots no longer exist, review the warning and choose a new explicit scope; the plugin does not widen the sync to the current page automatically.

**Limits and networking.** A fetch can include up to 200 worksheet tabs, 100,000 cells per worksheet, and 500,000 cells across the imported spreadsheet. The preview shows up to 2,000 cells at a time and paginates larger tables. The default Worker accepts spreadsheet IDs from 20 to 200 characters, limits sheet responses to 5 MiB and images to 20 MiB, and accepts PNG, JPEG, or GIF image data over HTTPS. The plugin keeps at most three worksheet tasks, four image requests, and six upstream requests in flight at once. Image requests for the same URL within one run share a fetch; each bound layer still receives its own result. When Worker mode is disabled, JSONP applies the same estimated 5 MiB UTF-8 payload and 100,000-cell checks after the script executes; worksheet discovery is a bounded `gid` probe and may omit tabs with other IDs. Use Worker/API-key mode for complete discovery.

Cancelling stops work at the next safe boundary, so layers already changed can remain changed. The result is marked cancelled and the saved completed-sync configuration is left untouched. There is no plugin rollback action; use Figma's normal **Undo** command when you need to undo mutations that already occurred.

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
