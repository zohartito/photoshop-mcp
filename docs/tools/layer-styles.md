# Layer Styles / FX Tools

Dedicated, parameterized tools that apply Photoshop **layer effects (FX)** — drop shadow, stroke, outer glow, color overlay, inner shadow, bevel & emboss, and gradient overlay — to the **active layer**. These are the "text and product graphics for social" unlock: crisp outlines, glows, and shadows on type and cutout product shots without hand-authoring batchPlay.

← Back to [Available Tools](../available-tools.md)

## Behavior contract (read once)

- **Target:** every tool operates on the **active layer**. Select the layer first (`photoshop_select_layer_by_name`) if it is not already active. Works on normal, text, and smart-object layers; **not** on layer groups (clear error).
- **Effects merge — stacking preserves prior effects.** Each tool reads the layer's current `layerEffects`, adds/replaces just its one effect, and writes it back. So `photoshop_add_stroke` **after** `photoshop_add_drop_shadow` keeps **both**. Re-applying the **same** effect type replaces only that sub-effect (e.g. calling `photoshop_add_drop_shadow` twice updates the shadow, it does not duplicate it).
- **One undo each.** Every call is wrapped in a single `suspendHistory` step, so a single undo reverts the whole effect. `details.undo_history_states_consumed` is always `1`.
- **RGB only.** Layer effects require an RGB document. If the active document is CMYK/Grayscale/etc., the tool throws a clear error ("Layer effects require an RGB document…"). Convert with Image > Mode > RGB Color first.
- **Return envelope:** `{ ok, summary, undo_history_states_consumed, next_suggested_tool, details }`. On failure: `{ ok: false, code, message }`.
- **Units:** `angle` is degrees (-180..180), `distance`/`size` are pixels, `opacity` is percent (0-100). `spread`/choke takes a 0-100 value (shown as a percentage in Photoshop's UI, stored as a pixel-unit number in the effect descriptor). Colors are 0-255 RGB.
- **Blend modes:** friendly names — `NORMAL`, `MULTIPLY`, `SCREEN`, `OVERLAY`, `SOFTLIGHT`, `COLORDODGE`, `LINEARDODGE`, `DARKEN`, `LIGHTEN`, `DIFFERENCE`, `HUE`, `SATURATION`, `COLOR`, `LUMINOSITY`, and the rest of Photoshop's set (same vocabulary as `photoshop_set_layer_blend_mode`).

---

## `photoshop_add_drop_shadow`

Add a Drop Shadow to the active layer.

**Parameters:**
- `red`, `green`, `blue` (number, 0-255): shadow color (default `0, 0, 0`)
- `opacity` (number, 0-100): default `35`
- `angle` (number, -180..180): light angle (default `120`)
- `distance` (number, px): offset (default `10`)
- `size` (number, px): blur (default `10`)
- `spread` (number, 0-100): default `0`
- `blendMode` (string): default `MULTIPLY`

```javascript
// Soft dark shadow behind a product cutout
photoshop_add_drop_shadow({ opacity: 40, angle: 120, distance: 12, size: 20, spread: 5 })
```

## `photoshop_add_stroke`

Add a Stroke (outline) to the active layer.

**Parameters:**
- `size` (number, px): default `3`
- `position` (string): `"outside"` | `"inside"` | `"center"` (default `"outside"`)
- `red`, `green`, `blue` (number, 0-255): default `0, 0, 0`
- `opacity` (number, 0-100): default `100`
- `blendMode` (string): default `NORMAL`

```javascript
// White 6px outline around headline text
photoshop_add_stroke({ size: 6, position: "outside", red: 255, green: 255, blue: 255 })
```

## `photoshop_add_outer_glow`

Add an Outer Glow to the active layer.

**Parameters:**
- `red`, `green`, `blue` (number, 0-255): default `255, 255, 190` (warm white)
- `opacity` (number, 0-100): default `50`
- `size` (number, px): default `15`
- `spread` (number, 0-100): default `0`
- `blendMode` (string): default `SCREEN`

```javascript
// Neon cyan glow
photoshop_add_outer_glow({ red: 0, green: 240, blue: 255, opacity: 70, size: 25 })
```

## `photoshop_add_color_overlay`

Recolor the active layer's content non-destructively with a solid color.

**Parameters:**
- `red`, `green`, `blue` (number, 0-255): **required**
- `opacity` (number, 0-100): default `100`
- `blendMode` (string): default `NORMAL`

```javascript
// Tint the layer brand-red
photoshop_add_color_overlay({ red: 220, green: 38, blue: 38 })
```

## `photoshop_add_inner_shadow`

Add an Inner Shadow (shadow cast inward — pressed / cut-in look).

**Parameters:**
- `red`, `green`, `blue` (number, 0-255): default `0, 0, 0`
- `opacity` (number, 0-100): default `35`
- `angle` (number, -180..180): default `120`
- `distance` (number, px): default `5`
- `size` (number, px): default `5`
- `spread` (number, 0-100): default `0`
- `blendMode` (string): default `MULTIPLY`

```javascript
photoshop_add_inner_shadow({ opacity: 45, distance: 6, size: 8 })
```

## `photoshop_add_bevel_emboss`

Add a Bevel & Emboss (3D edge highlight/shadow).

**Parameters:**
- `style` (string): `"outerBevel"` | `"innerBevel"` | `"emboss"` | `"pillowEmboss"` | `"strokeEmboss"` (default `"innerBevel"`)
- `depth` (number, 1-1000): percent (default `100`)
- `size` (number, px): default `5`
- `soften` (number, px): default `0`
- `angle` (number, -180..180): default `120`
- `altitude` (number, 0-90): default `30`
- `highlightRed/Green/Blue` (0-255): default `255, 255, 255`
- `highlightOpacity` (0-100): default `75`
- `highlightBlendMode` (string): default `SCREEN`
- `shadowRed/Green/Blue` (0-255): default `0, 0, 0`
- `shadowOpacity` (0-100): default `75`
- `shadowBlendMode` (string): default `MULTIPLY`

```javascript
photoshop_add_bevel_emboss({ style: "innerBevel", depth: 150, size: 8, soften: 2 })
```

## `photoshop_add_gradient_overlay`

Add a two-color linear Gradient Overlay (start color → end color).

**Parameters:**
- `startRed/Green/Blue` (0-255): default `0, 0, 0`
- `endRed/Green/Blue` (0-255): default `255, 255, 255`
- `angle` (number, -180..180): default `90`
- `scale` (number, 10-150): percent (default `100`)
- `opacity` (number, 0-100): default `100`
- `blendMode` (string): default `NORMAL`

```javascript
// Purple-to-pink gradient across the layer
photoshop_add_gradient_overlay({
  startRed: 124, startGreen: 58, startBlue: 237,
  endRed: 236, endGreen: 72, endBlue: 153,
  angle: 90
})
```

---

## Stacking example (one effect = one undo)

```javascript
photoshop_select_layer_by_name({ name: "Headline" })

// Each call is one undoable step; effects accumulate on the layer.
photoshop_add_drop_shadow({ opacity: 40, distance: 8, size: 14 })   // shadow
photoshop_add_stroke({ size: 4, red: 255, green: 255, blue: 255 })  // + outline (shadow kept)
photoshop_add_outer_glow({ red: 255, green: 220, blue: 120 })       // + glow (both kept)

photoshop_get_preview()  // confirm the result
```

## Implementation notes

- Descriptor builders live in `src/api/extendscript.ts` (`MCP_LAYER_STYLE_HELPERS`); tools in `src/tools/layer-style-tools.ts`; registered via `createLayerStyleTools` in `src/core/server.ts`.
- The descriptor key structure (sub-effect keys `dropShadow` / `frameFX` / `outerGlow` / `solidFill` / `innerShadow` / `bevelEmboss` / `gradientFill`, and the RGBColor `grain`=green quirk) is translated from the adb-mcp UXP batchPlay reference into ExtendScript `ActionDescriptor` + `executeAction(sTID('set'), …)` calls.
- Merge is achieved by `getd`-reading the layer's existing `layerEffects` object descriptor, mutating it, and `set`-ting it back — so sibling effects are preserved automatically.
