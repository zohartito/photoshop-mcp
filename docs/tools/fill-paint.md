# Fill / Gradient / Pattern / Paint Tools

Tier-2 atomic **drawing primitives** — the fill and paint operations that back backgrounds, graphic borders, and color blocking. This set adds the first **real gradient fill tool** to the fork (`photoshop_add_gradient_overlay` is only a layer *effect*), plus pattern fills, a non-destructive solid color fill layer, selection strokes, and named-source selection fills.

← Back to [Available Tools](../available-tools.md)

## Behavior contract (read once)

- **One undo each.** Every tool is wrapped in a single `suspendHistory` step, so one undo reverts the whole operation. `details.undo_history_states_consumed` is always `1`.
- **RGB only.** All tools require an RGB document. On CMYK/Grayscale/etc. they throw a clear error ("This tool requires an RGB document…"). Convert with Image > Mode > RGB Color first.
- **Destructive vs. non-destructive.**
  - *Paint pixels* (into the active **normal/raster** layer): `photoshop_apply_gradient` (default), `photoshop_apply_pattern_fill` when `asFillLayer:false`, `photoshop_stroke_selection`, `photoshop_fill_selection_with`. These need a pixel active layer (clear error on a group / text / smart-object / adjustment layer).
  - *Non-destructive content layers*: `photoshop_add_solid_fill_layer`, and `photoshop_apply_gradient` / `photoshop_apply_pattern_fill` when `asFillLayer:true`.
- **Selection semantics.**
  - `photoshop_stroke_selection` and `photoshop_fill_selection_with` **require** an active selection (clear error otherwise) and act only inside it.
  - `photoshop_apply_gradient` (draw mode) confines the gradient to the selection when one is present, otherwise spans the whole canvas.
  - `photoshop_add_solid_fill_layer` **clips** the new fill layer to the active selection (via its layer mask) when one is present — `details.clipped_to_selection` reports this.
  - The `asFillLayer:true` modes of gradient/pattern **deselect first** so the fill layer covers the whole layer (a live selection would otherwise mask it). Use `photoshop_add_solid_fill_layer` when you *want* a selection-masked fill.
- **Return envelope:** `{ ok, summary, undo_history_states_consumed, next_suggested_tool, details }`. On failure: `{ ok: false, code, message }`.
- **Units:** `angle` is degrees (-180..180, 0 = left→right, positive = counter-clockwise), `scale`/`opacity` are percent, stroke `width` is pixels, colors are 0-255 RGB.
- **Blend modes:** friendly names — `NORMAL`, `MULTIPLY`, `SCREEN`, `OVERLAY`, `SOFTLIGHT`, `COLORDODGE`, `LINEARDODGE`, `DARKEN`, `LIGHTEN`, `DIFFERENCE`, `HUE`, `SATURATION`, `COLOR`, `LUMINOSITY`, and the rest of Photoshop's set (same vocabulary as `photoshop_set_layer_blend_mode`).

---

## `photoshop_apply_gradient`

Draw a gradient across the active layer, or create a non-destructive Gradient fill layer. **The** real gradient fill tool.

**Parameters:**
- `type` (string): `"linear"` | `"radial"` | `"angle"` | `"reflected"` | `"diamond"` (default `"linear"`)
- Two-color mode: `startRed/startGreen/startBlue` (default `0,0,0`) and `endRed/endGreen/endBlue` (default `255,255,255`)
- `stops` (array, optional): multi-stop gradient, overrides start/end. Each `{ red, green, blue, location }` with `location` 0-100. First stop is forced to 0, last to 100. Minimum 2 stops.
- `angle` (number, -180..180): default `90`
- `scale` (number, 10-150): percent, default `100`
- `reverse` (boolean): default `false`
- `dither` (boolean): reduce banding, default `true`
- `opacity` (number, 0-100): default `100`
- `blendMode` (string): default `NORMAL`
- `asFillLayer` (boolean): `true` = non-destructive Gradient fill layer instead of painting pixels (default `false`)

```javascript
// Sunset background: orange -> purple, painted across the canvas
photoshop_apply_gradient({
  startRed: 255, startGreen: 140, startBlue: 40,
  endRed: 90, endGreen: 30, endBlue: 120,
  type: "linear", angle: 90
})

// Non-destructive multi-stop radial gradient fill layer
photoshop_apply_gradient({
  type: "radial",
  stops: [
    { red: 255, green: 255, blue: 255, location: 0 },
    { red: 120, green: 180, blue: 255, location: 50 },
    { red: 10, green: 30, blue: 80, location: 100 }
  ],
  asFillLayer: true
})
```

`details`: `{ mode: "draw" | "fill_layer", type, stops, angle, scale, reverse, opacity, blend_mode, layer_name }`.

## `photoshop_apply_pattern_fill`

Fill with a pattern — as a non-destructive Pattern fill layer (default) or drawn onto the active pixel layer.

**Parameters:**
- `patternName` (string, optional): case-insensitive substring match against the loaded pattern presets. Omit to use the first available preset.
- `scale` (number, 1-1000): percent, default `100`
- `opacity` (number, 0-100): default `100`
- `blendMode` (string): default `NORMAL`
- `asFillLayer` (boolean): default `true` (non-destructive). `false` draws onto the active pixel layer (honors the active selection).

```javascript
// Non-destructive pattern fill layer at 50% scale
photoshop_apply_pattern_fill({ patternName: "Bubbles", scale: 50 })
```

`details`: `{ mode, pattern_name, scale, opacity, blend_mode, layer_name }`. Throws a clear error when no pattern presets are loaded, or none matches `patternName`.

## `photoshop_add_solid_fill_layer`

Add a non-destructive Solid Color fill layer (editable, maskable) — unlike `photoshop_fill_layer` which paints pixels.

**Parameters:**
- `red`, `green`, `blue` (number, 0-255): **required**
- `opacity` (number, 0-100): default `100`
- `blendMode` (string): default `NORMAL`
- `name` (string, optional): default `"Color Fill"`

```javascript
// Flat brand-color background layer
photoshop_add_solid_fill_layer({ red: 18, green: 24, blue: 38, name: "BG" })

// Color-block only the current selection (fill layer masked to it)
photoshop_select_rectangle({ /* ... */ })
photoshop_add_solid_fill_layer({ red: 240, green: 60, blue: 90 })
```

`details`: `{ layer_name, color, opacity, blend_mode, clipped_to_selection }`.

## `photoshop_stroke_selection`

Stroke (outline) the current selection on the active pixel layer — the atomic behind graphic borders.

**Parameters:**
- `width` (number, px, 1-1000): default `3`
- `location` (string): `"inside"` | `"center"` | `"outside"` relative to the selection edge (default `"center"`)
- `red`, `green`, `blue` (number, 0-255): default `0,0,0`
- `opacity` (number, 0-100): default `100`
- `blendMode` (string): default `NORMAL`

```javascript
// 4px white border just inside a rectangular selection
photoshop_select_rectangle({ /* ... */ })
photoshop_stroke_selection({ width: 4, location: "inside", red: 255, green: 255, blue: 255 })
```

**Requires an active selection** and a pixel active layer. `details`: `{ layer_name, width, location, color, opacity, blend_mode }`.

## `photoshop_fill_selection_with`

Fill the current selection on the active pixel layer from a named source.

**Parameters:**
- `source` (string): `"foreground"` | `"background"` | `"color"` | `"black"` | `"white"` | `"50gray"` (alias `"gray"`) — default `"foreground"`
- `red`, `green`, `blue` (number, 0-255): only used when `source` is `"color"`
- `opacity` (number, 0-100): default `100`
- `blendMode` (string): default `NORMAL`

```javascript
// Fill the selection with 50% gray (e.g. a dodge/burn base region)
photoshop_fill_selection_with({ source: "50gray" })

// Fill with an explicit color at reduced opacity
photoshop_fill_selection_with({ source: "color", red: 255, green: 0, blue: 0, opacity: 60 })
```

**Requires an active selection** and a pixel active layer. `details`: `{ layer_name, source, color, opacity, blend_mode }`.

**How this differs from the other fill tools:**
- `photoshop_fill_layer` — floods the **whole active layer** with a flat color (no selection, opacity, or blend mode).
- `photoshop_add_solid_fill_layer` — a **non-destructive** color fill layer.
- `photoshop_fill_selection_with` — **destructive**, honors the **selection**, `opacity`, `blendMode`, and named sources (foreground/background/black/white/gray).

---

## Implementation notes

- Tools live in `src/tools/fill-paint-tools.ts`; ExtendScript descriptor helpers in `src/api/extendscript.ts` (`MCP_FILL_PAINT_HELPERS`); registered via `createFillPaintTools` in `src/core/server.ts`.
- Descriptor shapes are cribbed from the layer-style gradient-overlay descriptor (`__mcp_buildGradientOverlay`), the mask gradient-draw helper (`__mcp_gradientFillLayerMask`), and the adb-mcp UXP `fillSelection` / `stroke` batchPlay reference. batchPlay JSON maps 1:1 onto these `ActionDescriptor` + `executeAction` calls.
- **Gradient draw** uses the `gradientClassEvent` event with `from`/`to` `Pnt ` point objects (`Hrzn`/`Vrtc` in pixels); the from→to line is projected onto the gradient direction (`span = halfW·|dx| + halfH·|dy|`) so it spans the full region at any angle. Gradient stop positions map 0-100 → 0-4096 (the Action Manager location scale).
- **Fill / gradient / pattern LAYERS** are `make contentLayer` with `type` → `solidColorLayer` / `gradientLayer` / `patternLayer`; blend mode + opacity are applied afterward via a shared `__mcp_fpApplyLayerLook`.
- **Stroke** uses the `stroke` event (`strokeLength` = inside/center/outside, integer `width`); **fill selection** uses the `fill` event (`fillContents` = foregroundColor/backgroundColor/black/white/gray/color).
- **RGBColor `grain`=green quirk:** every color descriptor writes the GREEN channel under the key `grain` (Action Manager quirk), matching the layer-style / adjustment-layer helpers.
