# Adjustment-Layer Tools (non-destructive)

Dedicated, parameterized tools that add **non-destructive adjustment layers** — Curves, Levels, Gradient Map, Selective Color, Photo Filter, Color Balance, Vibrance, and Black & White — **above the active layer**. These are the "creator color control" unlock: real tone curves, cinematic duotones, warming/cooling filters, and targeted color shifts without hand-authoring batchPlay and without baking pixels.

These are the **richer, non-destructive** counterparts to the destructive `photoshop_adjust_*` tools in [adjustment-tools](../available-tools.md) (brightness/contrast, hue/sat, auto-levels, desaturate, invert), which modify the active layer's pixels in place.

← Back to [Available Tools](../available-tools.md)

## Behavior contract (read once)

- **Adds a NEW layer.** Every tool creates one adjustment layer **directly above the active layer** via the Action Manager "Make adjustmentLayer" pattern. The underlying pixels are never modified — hide, re-order, mask, lower the opacity, or delete the adjustment layer at any time to change or undo the look.
- **Target:** the new adjustment layer is inserted above whatever layer is active when you call the tool. Select the target layer first (`photoshop_select_layer_by_name`) if needed. (Adjustment layers affect all layers below them in the stack unless clipped — clip them manually afterward if you want the effect limited to one layer.)
- **One undo each.** Every call is wrapped in a single `suspendHistory` step, so a single undo removes the whole adjustment layer. `details.undo_history_states_consumed` is always `1`.
- **RGB only.** These adjustments assume RGB channels. If the active document is CMYK/Grayscale/etc., the tool throws a clear error ("This adjustment layer requires an RGB document…"). Convert with Image > Mode > RGB Color first.
- **Return envelope:** `{ ok, summary, undo_history_states_consumed, next_suggested_tool, details }`. On failure: `{ ok: false, code, message }`.
- **Stacking:** call several tools in sequence to build a grade (e.g. Curves for contrast, then Selective Color to cool the shadows, then a Photo Filter to warm the highlights). Each is its own layer and its own undo.

---

## `photoshop_apply_curves`

Add a **Curves** adjustment layer with **arbitrary points** on one channel. (Unlike the preset-only `photoshop_adjust_curves`, this takes real point arrays.)

**Parameters:**
- `channel` (string): `"composite"` | `"red"` | `"green"` | `"blue"` (default `"composite"`)
- `points` (array of `{ input: 0-255, output: 0-255 }`): the curve. Auto-sorted by `input`, duplicate inputs collapsed. If omitted or fewer than 2 usable points, endpoints `(0,0)`/`(255,255)` are used (identity).

```javascript
// Classic S-curve for punchier contrast on the composite channel
photoshop_apply_curves({ channel: "composite", points: [
  { input: 0, output: 0 }, { input: 64, output: 48 },
  { input: 192, output: 208 }, { input: 255, output: 255 }
]})

// Faded-film look: lift the blacks
photoshop_apply_curves({ points: [{ input: 0, output: 24 }, { input: 255, output: 235 }] })

// Cool the shadows by lifting the blue channel's low end
photoshop_apply_curves({ channel: "blue", points: [{ input: 0, output: 20 }, { input: 255, output: 255 }] })
```

## `photoshop_apply_levels`

Add a **Levels** adjustment layer (input black/white clipping, midtone gamma, output range).

**Parameters:**
- `channel` (string): `"composite"` | `"red"` | `"green"` | `"blue"` (default `"composite"`)
- `inputBlack` (number, 0-253): shadow clip point (default `0`)
- `inputWhite` (number, 2-255): highlight clip point (default `255`; forced above `inputBlack`)
- `gamma` (number, 0.1-9.99): midtone gamma, `1.0` = neutral, `>1` brightens midtones (default `1.0`)
- `outputBlack` (number, 0-255): output black point (default `0`)
- `outputWhite` (number, 0-255): output white point (default `255`)

```javascript
// Expand a flat/washed-out image: set black & white points, brighten midtones
photoshop_apply_levels({ inputBlack: 12, inputWhite: 240, gamma: 1.15 })

// Fade to milky blacks (raise output black point)
photoshop_apply_levels({ outputBlack: 30 })
```

## `photoshop_add_gradient_map`

Add a **Gradient Map** adjustment layer mapping luminance from a start (shadow) color to an end (highlight) color. Defaults to black → white.

**Parameters:**
- `startRed`, `startGreen`, `startBlue` (number, 0-255): shadow color (default `0, 0, 0`)
- `endRed`, `endGreen`, `endBlue` (number, 0-255): highlight color (default `255, 255, 255`)
- `reverse` (boolean): flip the mapping (default `false`)
- `dither` (boolean): dither to reduce banding (default `true`)

```javascript
// Teal-shadow / warm-highlight cinematic duotone
photoshop_add_gradient_map({
  startRed: 12, startGreen: 40, startBlue: 55,
  endRed: 250, endGreen: 214, endBlue: 165
})
// Tip: then lower the layer opacity or set its blend mode to SOFTLIGHT for a subtle grade.
```

## `photoshop_add_selective_color`

Add a **Selective Color** adjustment layer targeting **one** color band. Call once per band to adjust several.

**Parameters:**
- `target` (string, required): `"reds"` | `"yellows"` | `"greens"` | `"cyans"` | `"blues"` | `"magentas"` | `"whites"` | `"neutrals"` | `"blacks"`
- `cyan`, `magenta`, `yellow`, `black` (number, -100..100): CMYK shift for that band (default `0`)
- `relative` (boolean): `true` = relative method (subtler), `false` = absolute (stronger). Default `true`.

```javascript
// Take the green out of skin (shift the yellows toward magenta/red)
photoshop_add_selective_color({ target: "yellows", magenta: 8, yellow: -6 })

// Deepen a blue sky
photoshop_add_selective_color({ target: "blues", cyan: 15, black: 8 })
```

## `photoshop_add_photo_filter`

Add a **Photo Filter** adjustment layer — a colored filter over the image, like a warming/cooling lens filter.

**Parameters:**
- `filterColor` (string): named preset `"warm"` (Warming 85) or `"cool"` (Cooling 80). Ignored if a custom color is given.
- `filterRed`, `filterGreen`, `filterBlue` (number, 0-255): custom filter color (overrides `filterColor`)
- `density` (number, 0-100): filter strength (default `25`)
- `preserveLuminosity` (boolean): keep overall brightness constant (default `true`)

```javascript
// Warm up a flat golden-hour shot
photoshop_add_photo_filter({ filterColor: "warm", density: 30 })

// Custom tint
photoshop_add_photo_filter({ filterRed: 255, filterGreen: 120, filterBlue: 40, density: 20 })
```

## `photoshop_add_color_balance`

Add a **Color Balance** adjustment layer, shifting shadows / midtones / highlights independently along three axes.

**Parameters** (all -100..100, default `0`):
- Shadows: `shadowsCyanRed`, `shadowsMagentaGreen`, `shadowsYellowBlue`
- Midtones: `midtonesCyanRed`, `midtonesMagentaGreen`, `midtonesYellowBlue`
- Highlights: `highlightsCyanRed`, `highlightsMagentaGreen`, `highlightsYellowBlue`
- `preserveLuminosity` (boolean): default `true`

Axis convention: `cyanRed` negative = cyan / positive = red; `magentaGreen` negative = magenta / positive = green; `yellowBlue` negative = yellow / positive = blue.

```javascript
// Teal shadows, warm highlights (the "orange & teal" look)
photoshop_add_color_balance({
  shadowsCyanRed: -12, shadowsYellowBlue: 15,
  highlightsCyanRed: 10, highlightsYellowBlue: -12
})
```

## `photoshop_add_vibrance`

Add a **Vibrance** adjustment layer. Vibrance boosts muted colors while protecting saturated ones and skin tones (the creator-friendly default); saturation is a uniform boost.

**Parameters:**
- `vibrance` (number, -100..100): default `0`
- `saturation` (number, -100..100): default `0`

```javascript
// Make the colors pop without oversaturating skin
photoshop_add_vibrance({ vibrance: 35 })
```

## `photoshop_add_black_white`

Add a **Black & White** adjustment layer — a controllable grayscale conversion with an optional color tint.

**Parameters:**
- Per-channel mix (each -200..300; higher = that original color renders lighter): `reds` (default `40`), `yellows` (`60`), `greens` (`40`), `cyans` (`60`), `blues` (`20`), `magentas` (`80`)
- `tintRed`, `tintGreen`, `tintBlue` (number, 0-255): supplying any of these enables a color tint (sepia/duotone). No tint by default.

```javascript
// Punchy B&W: keep reds bright, darken the sky
photoshop_add_black_white({ reds: 80, blues: 10 })

// Sepia tone
photoshop_add_black_white({ tintRed: 225, tintGreen: 211, tintBlue: 179 })
```

---

## Live verification

With a document open in Photoshop (RGB), a full pass looks like:

```
photoshop_create_document({ width: 1200, height: 1200 })        // or open_image on a photo
// (place/paint some content so the adjustments are visible)
photoshop_apply_curves({ points: [{input:0,output:0},{input:64,output:48},{input:192,output:208},{input:255,output:255}] })
photoshop_apply_levels({ inputBlack: 10, inputWhite: 245, gamma: 1.1 })
photoshop_add_gradient_map({ startRed: 12, startGreen: 40, startBlue: 55, endRed: 250, endGreen: 214, endBlue: 165 })
photoshop_add_selective_color({ target: "yellows", magenta: 8, yellow: -6 })
photoshop_add_photo_filter({ filterColor: "warm", density: 30 })
photoshop_add_color_balance({ shadowsYellowBlue: 15, highlightsYellowBlue: -12 })
photoshop_add_vibrance({ vibrance: 30 })
photoshop_add_black_white({ tintRed: 225, tintGreen: 211, tintBlue: 179 })
photoshop_get_preview({ max_dimension_px: 1024 })               // confirm the stacked look
photoshop_get_layers()                                          // confirm 8 adjustment layers added
```

Each tool consumes exactly one history state, so eight `photoshop_undo` calls unwind the whole stack.
