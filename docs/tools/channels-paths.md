# Channels, Paths & Advanced Selection Tools

Tier-2 tools for **color/tonal selection**, **selection edge refinement**, **alpha channels**, **work paths**, and **clipping masks** — the "advanced selection" layer that sits on top of the basic marquee/subject tools in [selection-tools](../available-tools.md). These let an agent build a tonal selection (grade the reds, mask the highlights), clean up its edges, stash it for later, vectorize it, or clip one layer to another — without hand-authoring batchPlay.

← Back to [Available Tools](../available-tools.md)

## Behavior contract (read once)

- **One undo each.** Every tool is wrapped in a single `suspendHistory` step, so one `photoshop_undo` reverts the whole operation. `details.undo_history_states_consumed` is always `1`.
- **Return envelope:** `{ ok, summary, undo_history_states_consumed, next_suggested_tool, details }`. On failure: `{ ok: false, code, message, suggested_next_tool }`.
- **Guards.** Tools that need a selection (`refine_selection`, `save_selection_as_channel`, `make_work_path_from_selection`) return `{ ok: false, code: "selection_required" }` when none exists. `create_clipping_mask` rejects a Background / bottom layer (`invalid_target`). `load_channel_as_selection` returns `channel_not_found` when the named channel is missing.
- **Selection side effects.** `select_color_range`, `refine_selection`, and `load_channel_as_selection` **replace** the current selection. `save_selection_as_channel` adds an alpha channel (replacing one of the same name). `make_work_path_from_selection` creates/replaces the Work Path. None of these deselect afterward, so you can chain them.
- **Pixels are pixels.** All radii, tolerances, and fuzziness values are in pixels (fuzziness is Color Range's 0-200 tolerance scale).

---

## `photoshop_select_color_range`

**Select > Color Range** — build a selection from a tonal/color preset or a sampled RGB color.

**Parameters:**
- `preset` (string, optional): one of `reds` | `yellows` | `greens` | `cyans` | `blues` | `magentas` | `highlights` | `midtones` | `shadows` | `skin`. Omit when sampling a color.
- `color` (object, optional): `{ r, g, b }` each 0-255 — the color to select around. Used **only** when no `preset` is given.
- `fuzziness` (number, 0-200): tolerance / softness of the color match (default `40`). Higher = wider range. (Preset tonal ranges like `highlights`/`shadows` ignore fuzziness internally.)

Provide **either** a `preset` **or** a `color`. Providing neither returns `{ ok:false, code:"invalid_params" }`.

```javascript
// Grade the reds — select every red pixel with a moderate tolerance
photoshop_select_color_range({ preset: "reds", fuzziness: 60 })

// Mask the highlights (e.g. to clip a warming filter to them)
photoshop_select_color_range({ preset: "highlights" })

// Select skin tones before a soften/dodge pass
photoshop_select_color_range({ preset: "skin", fuzziness: 45 })

// Select around a sampled teal
photoshop_select_color_range({ color: { r: 30, g: 130, b: 140 }, fuzziness: 50 })
```

## `photoshop_refine_selection`

Grow, shrink, feather, smooth, or border-band the **current** selection.

**Parameters:**
- `operation` (string, **required**): `expand` (grow) | `contract` (shrink) | `feather` | `smooth` | `border`.
- `radius` (number, 1-500): amount in pixels (default `2`). For `smooth` this is the sample radius; for `border` it is the band width.

Requires an active selection (`selection_required` otherwise).

```javascript
// Grow a subject selection by 4px before cutting, to avoid a halo
photoshop_refine_selection({ operation: "expand", radius: 4 })

// Soften the edge of a color-range selection
photoshop_refine_selection({ operation: "feather", radius: 3 })

// Turn a selection into a 6px border band (e.g. for a stroke)
photoshop_refine_selection({ operation: "border", radius: 6 })
```

## `photoshop_save_selection_as_channel`

**Select > Save Selection** — store the active selection to a named alpha channel for later reuse. Re-saving to the same name replaces the existing channel (idempotent).

**Parameters:**
- `channel_name` (string): alpha channel name (default `"Alpha 1"`).

Requires an active selection.

```javascript
// Stash the current selection so a later step can restore it
photoshop_save_selection_as_channel({ channel_name: "subject-mask" })
```

## `photoshop_load_channel_as_selection`

**Select > Load Selection** — load a previously saved alpha channel back as the active selection.

**Parameters:**
- `channel_name` (string): alpha channel to load (default `"Alpha 1"`).
- `invert` (boolean): invert the loaded selection (default `false`).

Returns `channel_not_found` if no channel with that name exists.

```javascript
// Restore the saved selection
photoshop_load_channel_as_selection({ channel_name: "subject-mask" })

// Load it inverted (select everything except the saved region)
photoshop_load_channel_as_selection({ channel_name: "subject-mask", invert: true })
```

## `photoshop_make_work_path_from_selection`

**Selection > Make Work Path** — convert the active selection into a vector Work Path (for a vector mask, stroke, or export).

**Parameters:**
- `tolerance` (number, 0.5-10): path fit tolerance in pixels (default `2`). **Lower = tighter fit / more anchor points; higher = smoother / fewer points.**

Requires an active selection.

```javascript
// Tight path (more points) from a precise selection
photoshop_make_work_path_from_selection({ tolerance: 1 })

// Smoother path (fewer points)
photoshop_make_work_path_from_selection({ tolerance: 4 })
```

## `photoshop_create_clipping_mask`

**Layer > Create Clipping Mask** — clip the active layer to the layer directly below it, so it shows only where that layer has pixels.

**Parameters:** none — operates on the active layer.

Rejects a Background layer (`invalid_target`). There must be a layer below the active one to clip to.

```javascript
// Clip a texture / adjustment layer to the shape layer beneath it
photoshop_create_clipping_mask()
```

---

## Live verification

With an RGB document open (a photo works best so color/tonal selections have something to bite on):

```
photoshop_get_state()                                           // confirm active doc + layer

// Color/tonal selection → save → refine → make path
photoshop_select_color_range({ preset: "reds", fuzziness: 60 })
photoshop_save_selection_as_channel({ channel_name: "reds-mask" })
photoshop_refine_selection({ operation: "expand", radius: 3 })
photoshop_refine_selection({ operation: "feather", radius: 2 })
photoshop_make_work_path_from_selection({ tolerance: 2 })
photoshop_get_state()                                           // confirm Work Path + "reds-mask" channel

// Restore the saved selection later
photoshop_load_channel_as_selection({ channel_name: "reds-mask" })

// Clipping mask (needs ≥2 layers, active layer not Background)
photoshop_create_clipping_mask()
photoshop_get_preview({ max_dimension_px: 1024 })               // confirm the clip
```

Each call consumes exactly one history state, so one `photoshop_undo` per step unwinds the chain.
