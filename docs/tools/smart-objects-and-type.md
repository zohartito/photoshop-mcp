# Smart Objects & Precise Type Tools

Two Tier-1 dedicated tool groups from the capability-gap roadmap:

- **Smart Objects** — convert a layer to a Smart Object, replace its contents from a file (the template/mockup workflow), and export its embedded source.
- **Precise Type** — character- and paragraph-level type controls (tracking, leading, kerning, case, faux styles) plus text warp, on the active text layer.

← Back to [Available Tools](../available-tools.md)

---

## Smart Objects

Dedicated wrappers over the Action Manager Smart Object events, behind the existing ExtendScript transport. The headline is **replace contents**: drop a new image into a Smart Object and every transform (scale/warp/perspective) and layer style baked around it re-renders — this is what makes branded mockups repeatable.

### Behavior contract (read once)

- **Target:** every tool operates on the **active layer**. Select it first (`photoshop_select_layer_by_name`) if needed.
- **Guard:** `photoshop_replace_smart_object_contents` and `photoshop_export_smart_object_contents` require the active layer to **already be a Smart Object** (`kind === LayerKind.SMARTOBJECT`) — a clear error is thrown otherwise, telling you to convert first. `photoshop_convert_to_smart_object` fails on a layer group and returns an error if the layer is already a Smart Object.
- **One undo:** convert and replace mutate the document and are wrapped in a single `suspendHistory` step (`undo_history_states_consumed: 1`). **Export is a read-only disk write** and consumes **0** history states.
- **Return envelope:** `{ ok, summary, undo_history_states_consumed, details }` on success; `{ ok: false, code, message }` on failure.

### `photoshop_convert_to_smart_object`

Convert the active layer (or currently selected layers) to a single Smart Object. Runs the `newPlacedLayer` event — multiple selected layers are packaged into one Smart Object, exactly like Layer > Smart Objects > Convert to Smart Object.

**Parameters:** none.

```javascript
// Wrap the active layer so it can be scaled non-destructively / used as a mockup slot
photoshop_convert_to_smart_object({})
```

Returns `details: { layer_name, kind }`.

### `photoshop_replace_smart_object_contents`

Replace the active Smart Object's contents with an image file on disk (`placedLayerReplaceContents`). Transforms and layer styles on the Smart Object are preserved and re-render around the new source.

**Parameters:**
- `filePath` (string, **required**): absolute path to the replacement image (PNG, JPEG, PSD, TIFF, …). Must exist on disk.

```javascript
// Swap the artwork inside a mockup's Smart Object
photoshop_replace_smart_object_contents({ filePath: "/Users/me/exports/poster-v2.png" })
```

Returns `details: { layer_name, file_path }`. Errors: `file_not_found` if the path does not exist; the SO guard error if the active layer is not a Smart Object.

### `photoshop_export_smart_object_contents`

Export the active Smart Object's embedded source to a file on disk, unmodified (`placedLayerExportContents`). Writes the exact bytes stored inside the Smart Object (the original placed PSB/PNG/etc.) — useful for recovering or re-using the source art. Read-only: does not modify the document.

**Parameters:**
- `outputPath` (string, **required**): absolute path to write to. Use an extension matching the stored source (e.g. `.psb`, `.png`) when known.

```javascript
photoshop_export_smart_object_contents({ outputPath: "/Users/me/exports/embedded-source.psb" })
```

Returns `details: { layer_name, output_path }` and `output_paths: [outputPath]`. `undo_history_states_consumed` is `0`.

**Support note:** `placedLayerExportContents` is available for embedded Smart Objects. If a particular Smart Object cannot be exported (e.g. certain linked or generated sources), Photoshop raises an error, which is surfaced verbatim in the failure envelope.

### Rasterizing back

There is **no** dedicated `photoshop_rasterize_smart_object` tool — rasterizing a Smart Object back to pixels is already covered by **`photoshop_rasterize_layer`**, whose snippet has a `SMARTOBJECT` branch that runs the `rasterizePlaced` event. Use that when you need to flatten a Smart Object to a normal layer.

---

## Precise Type

Character/paragraph controls and warp on the **active text layer**, extending the base type tools (`photoshop_set_text_font`, `photoshop_set_text_color`, `photoshop_set_text_alignment`, `photoshop_update_text_content`, `photoshop_list_fonts`). These are the professional-titling polish layer for social cards.

### Behavior contract (read once)

- **Target:** the **active layer**, which **must be a text layer** — every tool throws a clear "Active layer is not a text layer" error otherwise.
- **Implementation:** these set `TextItem` DOM properties directly (fast, one operation each). They apply to the **whole** text layer, not a character range.
- **Return envelope:** `{ ok, summary, details }`; the `details` object echoes the resulting `TextItem` values read back from Photoshop.

### `photoshop_set_text_tracking`

Set character tracking (letter-spacing). Tracking is in **1/1000 em** (Photoshop's unit): `0` = default, positive = looser, negative = tighter.

**Parameters:**
- `tracking` (number, **required**): `-1000..10000`.

```javascript
photoshop_set_text_tracking({ tracking: 120 })   // track a headline out
```

### `photoshop_set_text_leading`

Set leading (line spacing) in **points**, or enable auto-leading. Only meaningful on multi-line text.

**Parameters:**
- `leading` (number): leading in points (ignored when `auto` is true).
- `auto` (boolean): enable auto-leading instead of a fixed value (default `false`).

One of `leading` or `auto: true` must be provided (else `missing_leading`).

```javascript
photoshop_set_text_leading({ leading: 72 })   // tight 72pt leading
photoshop_set_text_leading({ auto: true })     // back to auto
```

### `photoshop_set_text_kerning`

Set the kerning mode via `TextItem.autoKerning` (`AutoKernType`).

**Parameters:**
- `mode` (string, **required**): `"metrics"` (font's built-in pairs) | `"optical"` (Photoshop kerns by glyph shape) | `"manual"` (auto-kerning off).

```javascript
photoshop_set_text_kerning({ mode: "optical" })
```

### `photoshop_set_text_case`

Set letter case display and/or toggle faux bold / faux italic. Every field is optional; only the fields you pass change. Case does **not** alter the underlying characters, only their display.

**Parameters:**
- `case` (string): `"allCaps"` | `"smallCaps"` | `"normal"`.
- `fauxBold` (boolean): synthetic bold (no bold font variant needed).
- `fauxItalic` (boolean): synthetic slant (no italic font variant needed).

At least one field must be provided (else `no_case_change`).

```javascript
photoshop_set_text_case({ case: "allCaps", fauxBold: true })
```

### `photoshop_warp_text`

Warp the text layer with a preset style, or remove the warp. Sets `TextItem.warpStyle` + `warpBend` + `warpHorizontalDistortion` + `warpVerticalDistortion`.

**Parameters:**
- `style` (string, **required**): `none` | `arc` | `arcLower` | `arcUpper` | `arch` | `bulge` | `flag` | `wave` | `fish` | `rise` | `fisheye` | `inflate` | `squeeze` | `twist`. `"none"` removes any existing warp.
- `bend` (number): `-100..100` (percent, matching the Warp Text dialog). Default `50`. Ignored when `style` is `"none"`.
- `horizontalDistortion` (number): `-100..100`. Default `0`.
- `verticalDistortion` (number): `-100..100`. Default `0`.

> The `-100..100` percent values you pass map to Photoshop's internal `-1..1` warp range — you use the same numbers shown in the Warp Text dialog.

```javascript
photoshop_warp_text({ style: "arc", bend: 40 })          // gentle arc
photoshop_warp_text({ style: "flag", bend: 60, horizontalDistortion: -20 })
photoshop_warp_text({ style: "none" })                    // remove warp
```
