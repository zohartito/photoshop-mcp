# Filter & Transform Tools

Two dedicated tool groups that harvest Photoshop's **Filter Gallery / Distort / Stylize / Pixelate / Render / Blur** family and the missing **transform** operations (skew, free distort, perspective, warp, free transform) out of the raw `execute_script` escape hatch into typed, one-undo tools.

← Back to [Available Tools](../available-tools.md)

## Behavior contract (read once)

- **Target:** every tool operates on the **active layer**. Select it first (`photoshop_select_layer_by_name`) if needed.
- **Raster-only.** Text and smart-object layers are **auto-rasterized** before the effect is applied; **layer groups throw a clear error** (`Active item is a layer group — select a raster layer first.`). This matches the existing dedicated filter tools (`photoshop_apply_gaussian_blur` etc.).
- **One undo each.** Every call is wrapped in a single `suspendHistory` step; a single undo reverts the whole operation. `details.undo_history_states_consumed` is always `1`.
- **Return envelope:** `{ ok, summary, undo_history_states_consumed, next_suggested_tool, details }`. On failure: `{ ok: false, code, message }`.
- **Clamping:** all numeric params are clamped to their documented range (fractional precision preserved for blur radii/thresholds).
- **Coordinates & units:** pixels unless noted; angles in degrees; scale/amount in percent; colors 0-255. Corner points for `photoshop_distort_corners` are **absolute document pixel** coordinates.

---

## `photoshop_apply_filter`

Apply one filter (Distort / Stylize / Pixelate / Render / Blur) that has **no dedicated tool**. Gaussian Blur, Motion Blur, Unsharp Mask and Add Noise keep their own `photoshop_apply_*` tools and are **not** covered here.

Pick the effect with `filter`; pass that filter's params. Params belonging to other filters are ignored. Where the ArtLayer ExtendScript DOM has an `apply*` method it is used directly; the AM-only filters (shear, wave, ocean ripple, glass, box/surface/shape/lens blur) go through a fixed `executeAction` descriptor.

**`filter` (required):** one of the names below.

### Distort

| `filter` | Params (with ranges) |
|---|---|
| `twirl` | `angle` (-999..999, def 50) |
| `wave` | `generators` (1..999, def 5), `minWavelength` (1..998, def 10), `maxWavelength` (2..999, def 120), `minAmplitude` (1..998, def 5), `maxAmplitude` (2..999, def 35), `waveType` (`sine`\|`triangle`\|`square`, def sine) |
| `ripple` | `amount` (-999..999, def 100), `size` (`small`\|`medium`\|`large`, def medium) |
| `pinch` | `amount` (-100..100, def 50; negative bulges, positive pinches) |
| `spherize` | `amount` (-100..100, def 100), `mode` (`normal`\|`horizontal`\|`vertical`, def normal) |
| `polar_coordinates` | `conversion` (`rect_to_polar`\|`polar_to_rect`, def rect_to_polar) |
| `zigzag` | `amount` (-100..100, def 10), `ridges` (0..20, def 5), `style` (`around_center`\|`out_from_center`\|`pond_ripples`, def pond_ripples) |
| `ocean_ripple` | `size` (1..15, def 9), `magnitude` (0..20, def 10) |
| `glass` | `distortion` (0..20, def 5), `smoothness` (1..15, def 3) |
| `shear` | `offset` (-255..255, def 30; horizontal shift in px at the bottom edge) |

### Stylize

| `filter` | Params |
|---|---|
| `glowing_edges` | `edgeWidth` (1..14, def 2), `edgeBrightness` (0..20, def 6), `smoothness` (1..15, def 5) |
| `emboss` | `angle` (-360..360, def 135), `height` (1..100, def 3), `amount` (1..500, def 100) |
| `diffuse_glow` | `graininess` (0..10, def 6), `glowAmount` (0..20, def 10), `clearAmount` (0..20, def 15) |
| `find_edges` | *(none)* |
| `solarize` | *(none)* |

### Pixelate

| `filter` | Params |
|---|---|
| `crystallize` | `cellSize` (3..300, def 10) |
| `mosaic` | `cellSize` (2..200, def 10) |
| `pointillize` | `cellSize` (3..300, def 5) |
| `facet` | *(none)* |

### Render

| `filter` | Params |
|---|---|
| `lens_flare` | `brightness` (10..300, def 100), `positionX` (0..100, def 50), `positionY` (0..100, def 50; center as % of layer bounds), `lensType` (`zoom`\|`prime35`\|`prime105`\|`movie`, def zoom) |
| `difference_clouds` | *(none)* |
| `clouds` | *(none)* |

### Blur (variants not already tooled)

| `filter` | Params |
|---|---|
| `smart_blur` | `radius` (0.1..100, def 5), `threshold` (0.1..100, def 25) |
| `radial_blur` | `amount` (1..100, def 10), `method` (`spin`\|`zoom`, def spin) |
| `lens_blur` | `radius` (0..100, def 15), `brightness` (0..100, def 0), `threshold` (0..255, def 255) |
| `surface_blur` | `radius` (1..100, def 5), `threshold` (1..255, def 15) |
| `box_blur` | `radius` (1..999, def 10) |
| `shape_blur` | `radius` (1..1000, def 20) |

```javascript
// Swirl a raster layer
photoshop_apply_filter({ filter: "twirl", angle: 120 })

// Chunky mosaic
photoshop_apply_filter({ filter: "mosaic", cellSize: 24 })

// Warm lens flare in the upper-right
photoshop_apply_filter({ filter: "lens_flare", brightness: 130, positionX: 75, positionY: 25, lensType: "prime105" })

// Dreamy soft glow
photoshop_apply_filter({ filter: "diffuse_glow", graininess: 4, glowAmount: 12, clearAmount: 12 })
```

`details` on success: `{ filter, category, layer_name, params }`.

---

## Transform tools

Existing basic transforms — scale, rotate, flip, move — live in the layer-transform tools. These add the missing ones.

### `photoshop_skew`

Slant the active layer by horizontal and/or vertical angles, anchored at the layer center.

**Parameters:** `horizontalAngle` (-89..89, def 0), `verticalAngle` (-89..89, def 0). At least one must be non-zero.

```javascript
photoshop_skew({ horizontalAngle: 15 })          // lean right
photoshop_skew({ horizontalAngle: 10, verticalAngle: -5 })
```

### `photoshop_distort_corners`

Free-distort (corner-pin) the active layer by moving its four corners to absolute document pixel positions. The layer's current bounding box is mapped onto the quad you give.

**Parameters (all required):** `topLeft`, `topRight`, `bottomRight`, `bottomLeft`, each `{ x, y }` in document pixels.

```javascript
photoshop_distort_corners({
  topLeft:     { x: 120, y: 80 },
  topRight:    { x: 900, y: 40 },
  bottomRight: { x: 950, y: 700 },
  bottomLeft:  { x: 60,  y: 660 }
})
```

### `photoshop_perspective`

Symmetric perspective transform. `axis: "horizontal"` narrows the **top** edge; `axis: "vertical"` narrows the **right** edge. `amount` is the percent of width/height to inset that edge (positive narrows, negative widens).

**Parameters:** `axis` (`horizontal`\|`vertical`, def horizontal), `amount` (-90..90, def 25; required, non-zero).

```javascript
photoshop_perspective({ axis: "horizontal", amount: 30 })   // classic receding-into-distance
```

### `photoshop_warp`

Warp with a preset style. `bend` sets strength; `horizontalDistortion` / `verticalDistortion` add perspective distortion; `orientation` flips the warp axis.

**Parameters:** `style` (required — one of `arc, arc_lower, arc_upper, arch, bulge, shell_lower, shell_upper, flag, wave, fish, rise, fisheye, inflate, squeeze, twist`), `bend` (-100..100, def 50), `horizontalDistortion` (-100..100, def 0), `verticalDistortion` (-100..100, def 0), `orientation` (`horizontal`\|`vertical`, def horizontal).

```javascript
photoshop_warp({ style: "flag", bend: 40 })
photoshop_warp({ style: "arc", bend: 60, orientation: "horizontal" })
```

### `photoshop_free_transform`

Combined scale + rotate + skew in one call, anchored at the layer center.

**Parameters:** `scaleX` (1..10000%, def 100), `scaleY` (1..10000%, def 100), `angle` (-360..360, def 0), `skewHorizontal` (-89..89, def 0), `skewVertical` (-89..89, def 0). At least one must be non-identity.

```javascript
photoshop_free_transform({ scaleX: 80, scaleY: 80, angle: 15 })
```

---

## Implementation notes

- Filter dispatcher + transform descriptors live in `src/api/extendscript.ts` (`MCP_FILTER_GALLERY_HELPER`, `MCP_TRANSFORM_EXTRA_HELPER`).
- Tools in `src/tools/filter-gallery-tools.ts` (`createFilterGalleryTools`) and `src/tools/transform-extra-tools.ts` (`createTransformExtraTools`); both registered in `src/core/server.ts`.
- Both groups route through the shared recipe executor (`src/tools/recipes/_shared.ts` → `executeRecipe` → `wrapInSuspendHistory`), which supplies the one-undo `suspendHistory` scope, the RECIPE_ACTION_HELPERS (`__mcp_s2t` / `__mcp_c2t` / `__mcp_ensureRasterActiveLayer`), and the `{ ok, summary, details }` envelope.
- Filters prefer the ArtLayer DOM `apply*` method; AM-only filters (`shear`, `wave`, `ocean_ripple`, `glass`, `box_blur`, `surface_blur`, `shape_blur`, `lens_blur`) use fixed `executeAction` descriptors. All five transforms use the AM `transform` / `warp` event.
