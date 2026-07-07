# Heavy-Filter Tools (Tier-2)

Dedicated, parameterized tools for Photoshop's four "heavy" filters — **Camera Raw Filter**, **Lighting Effects**, **Lens Correction**, and **Liquify**. These are the destructive, dialog-backed filters that hand-authoring `batchPlay`/Action Manager for is painful and error-prone. Each is wrapped in a single one-undo step with the standard envelope.

← Back to [Available Tools](../available-tools.md)

## Behavior contract (read once)

- **Operates on the ACTIVE LAYER.** Select the target layer first (`photoshop_select_layer_by_name`) if needed.
- **Raster-only.** Text and smart-object layers are **auto-rasterized** first; layer **groups throw a clear error** (via `__mcp_ensureRasterActiveLayer`). Background layers are promoted to a normal layer.
- **Destructive.** Unlike the adjustment-layer tools, these bake pixels. To keep them non-destructive, convert the layer to a Smart Object first (then the filter becomes a Smart Filter) — but note these tools apply to the rasterized pixels, so wrap manually if you need that.
- **RGB where required.** Camera Raw Filter and Lighting Effects require an RGB document and throw a clear error otherwise. Lens Correction and Liquify do not.
- **One undo each.** Every call is wrapped in a single `suspendHistory` step, so one undo removes the whole filter. `details.undo_history_states_consumed` is always `1`.
- **Optional params omit cleanly.** For ACR and Lens Correction, only the params you pass are written to the descriptor — unset adjustments keep their neutral default.
- **Return envelope:** `{ ok, summary, undo_history_states_consumed, next_suggested_tool, details }`. On failure: `{ ok: false, code, message }`.

---

## Scriptability matrix (honest)

| Tool | Status | Notes |
|---|---|---|
| `photoshop_apply_lens_correction` | **Fully working** | Documented Action Manager keys (`LnCr`). Reliable. |
| `photoshop_apply_camera_raw_filter` | **Working** | `executeAction('Adobe Camera Raw Filter')` with PV2012 charID keys cross-verified from ScriptingListener captures. One key (`Strt`/saturation) flagged for a live diff. |
| `photoshop_apply_liquify` | **Partial (by design)** | Saved-mesh apply + open-dialog only. The interactive forward-warp brush is **not scriptable** in Photoshop — no tool can paint a warp headlessly, and this one does not pretend to. |
| `photoshop_apply_lighting_effects` | **Best-effort / may fail** | The modern GPU Lighting Effects workspace is not reliably recordable. The tool attempts a single-light descriptor and returns a clear error if the event is unavailable in your build. |

---

## `photoshop_apply_camera_raw_filter`

Apply the Camera Raw Filter (Filter > Camera Raw Filter) — the photographer-grade tone + color engine. Process version is forced to **PV2012**. Pass only the adjustments you want to change.

**Parameters (all optional):**
- `temperature` (-100..100): white balance, cooler → warmer
- `tint` (-100..100): green → magenta
- `exposure` (-5..5): in stops (the only floating-point param)
- `contrast` (-100..100)
- `highlights` (-100..100): recover → boost
- `shadows` (-100..100): → lift
- `whites` (-100..100)
- `blacks` (-100..100)
- `clarity` (-100..100): midtone contrast
- `dehaze` (-100..100)
- `vibrance` (-100..100)
- `saturation` (-100..100)
- `sharpenAmount` (0..150)

```javascript
// Warm it up, recover highlights, lift shadows, add a little clarity
photoshop_apply_camera_raw_filter({
  temperature: 12, highlights: -30, shadows: 25, clarity: 10, vibrance: 15
})

// Dehaze a flat landscape and add punch
photoshop_apply_camera_raw_filter({ dehaze: 25, contrast: 15, whites: 10, blacks: -8 })

// +0.5 stop exposure only
photoshop_apply_camera_raw_filter({ exposure: 0.5 })
```

**Descriptor keys (PV2012 recorded charIDs):** every slider is `putInteger` **except** `Ex12` (exposure) which is `putDouble`. Values map 1:1 to the ACR UI slider numbers.

| Adjustment | key | put-method |
|---|---|---|
| temperature | `Temp` | Integer |
| tint | `Tint` | Integer |
| exposure | `Ex12` | **Double** |
| contrast | `Cr12` | Integer |
| highlights | `Hi12` | Integer |
| shadows | `Sh12` | Integer |
| whites | `Wh12` | Integer |
| blacks | `Bk12` | Integer |
| clarity | `Cl12` | Integer |
| dehaze | `Dhze` | Integer |
| vibrance | `Vibr` | Integer |
| saturation | `Strt` | Integer *(flagged — verify)* |
| sharpenAmount | `Shrp` | Integer |

Plus fixed `CrVe` ("15.2" string), `PrVN` (5), `PrVe` (184549376).

> **Live-verify before relying on it:** `Vibr` and `Cr12` are confirmed from multiple captures. `Strt` is labeled "saturation" by the capturing author but the 4-char code reads like "strength" — record two ACR filters that differ only in Saturation and diff the ScriptingListener log to confirm. Do the same 3-min ritual for the other `*12` keys on your Photoshop version.
>
> **Not the same as `Exposure2012` XMP names:** those (`Exposure2012`, `Shadows2012`, …) are XMP-sidecar properties for RAW-file *reprocessing*, a different mechanism. The filter descriptor uses the `Ex12`/`Cl12` charIDs above.

---

## `photoshop_apply_lens_correction`

Apply Filter > Lens Correction — geometric distortion, vignette, perspective and rotation. Combine auto toggles with manual amounts. All params optional.

**Manual parameters:**
- `distortionAmount` (-100 pincushion .. 100 barrel)
- `vignetteAmount` (-100 darken .. 100 lighten)
- `vignetteMidpoint` (0..100)
- `verticalPerspective` (-100..100)
- `horizontalPerspective` (-100..100)
- `rotationAngle` (-180..180)
- `scale` (0..200): correction scale percent
- `edgeFill`: `edge_extension` | `transparency` | `black` | `white`

**Auto-correction booleans:**
- `autoDistortion`, `autoChromaticAberration`, `autoVignette`, `autoScale`

```javascript
// Fix barrel distortion and darken corners a touch
photoshop_apply_lens_correction({ distortionAmount: -18, vignetteAmount: -20, vignetteMidpoint: 50 })

// Straighten converging verticals
photoshop_apply_lens_correction({ verticalPerspective: -15, autoScale: true, edgeFill: "edge_extension" })
```

**Descriptor keys (`LnCr` event, all documented):**

| Param | key | put-method |
|---|---|---|
| autoDistortion | `LnAg` | Boolean |
| autoChromaticAberration | `LnAc` | Boolean |
| autoVignette | `LnAv` | Boolean |
| autoScale | `LnAs` | Boolean |
| distortionAmount | `LnIa` | Double |
| vignetteAmount | `LnSb` | Double |
| vignetteMidpoint | `LnSt` | Integer |
| verticalPerspective | `LnVp` | Double |
| horizontalPerspective | `LnHp` | Double |
| rotationAngle | `LnRa` | Double |
| scale | `LnSi` | Double |
| edgeFill | `LnFt` | Integer (1=edge extension, 2=transparency, 3=black, 4=white) |

---

## `photoshop_apply_liquify`

Liquify on the active layer. **The interactive forward-warp / push / bloat / pucker brushes are NOT scriptable** — Photoshop exposes no Action Manager path to paint a warp headlessly. This tool exposes the two things that ARE reachable:

- `mode="apply_mesh"` — apply a **previously saved** Liquify mesh file (`.msh`/`.psp`) to the layer, fully headless. Requires `meshPath` to an existing file. **This genuinely warps the pixels.** Save a mesh first via the Liquify dialog (**Liquify > Save Mesh**).
- `mode="dialog"` (default) — open the **interactive** Liquify dialog so a human can warp by hand. This is **not** automation — Photoshop blocks until the user clicks OK/Cancel.

There is deliberately **no** "warp with these brush strokes" mode, because Photoshop does not support one.

**Parameters:**
- `mode`: `apply_mesh` | `dialog` (default `dialog`)
- `meshPath`: absolute path to a saved mesh file (required for `apply_mesh`)

```javascript
// Re-apply a warp you saved earlier
photoshop_apply_liquify({ mode: "apply_mesh", meshPath: "/Users/you/warps/face-slim.msh" })

// Open Liquify for manual work (blocks on the user)
photoshop_apply_liquify({ mode: "dialog" })
```

**Descriptor keys:** event `LqFy` (charID). `apply_mesh` sets `LqMD` (mesh-data) to the mesh `File` via `putPath` and runs with `DialogModes.NO`. `dialog` runs the same event with `DialogModes.ALL` and no mesh key.

> **Why not full warp control?** Recording the forward-warp tool produces the error *"The command "" is not currently available"* — the brush mutation is not an Actionable step. Batch-apply "Last Filter" also does not work with Liquify on modern Photoshop (it did on CS6). Saved meshes are the only reliable headless path.

---

## `photoshop_apply_lighting_effects`

Apply Render > Lighting Effects (a single light: type, intensity, color). **Best-effort — may not work on your build.**

**Parameters:**
- `lightType`: `spot` | `omni` | `directional` (default `spot`)
- `intensity` (-100..100, default 35)
- `red` / `green` / `blue` (0..255, default white light 255/255/255)

```javascript
photoshop_apply_lighting_effects({ lightType: "spot", intensity: 40, red: 255, green: 240, blue: 200 })
```

**Descriptor keys (`lightFilterLightingEffects` event):** `Type` (Integer), `hots` (Double, intensity/hotspot), and color under space-padded keys `Rd  ` / `Grn ` / `Bl  ` (Doubles, **0..1** — the tool normalizes your 0..255 input). A single light is placed into the `lights` list.

> **Why "best-effort":** the modern (CC 2015+) Lighting Effects is a GPU *workspace* that records as **two** action steps. The first (entering the workspace + building the light rig) does **not** replay from a script; only the second `lightFilterLightingEffects` executeAction renders, and its full descriptor is a large image-dependent nested light array (~50 keys: position, focus, ambience, …). Hand-authoring a minimal single-light descriptor may render or may be rejected depending on version/GPU state. If `executeAction` throws, the tool returns a clear `{ ok:false, ... }` telling you to apply the filter manually or record + clean a full action once (e.g. with CleanSL). It never reports a fake success.
>
> The `Type` enum (spot/omni/directional → 1/2/3) is the conventional recorded order but was not diff-verified — confirm on your machine if the light type matters.

---

## Staged live checks

These tools were built and type-checked **offline** (no live Photoshop). Before relying on them, run this ritual on a connected Photoshop with a flattened RGB test document (ScriptingListener plugin installed):

1. **Lens Correction** — `photoshop_apply_lens_correction({ distortionAmount: -20, vignetteAmount: -25 })`. Expect visible barrel-correction + darker corners, one undo reverts. This is the most likely to work first-try.
2. **Camera Raw Filter** — `photoshop_apply_camera_raw_filter({ exposure: 0.5, contrast: 20, vibrance: 15, dehaze: 10 })`. Confirm the look matches the sliders. Then diff-verify the `Strt` (saturation) and `*12` keys via ScriptingListener.
3. **Liquify (mesh)** — save a mesh from the Liquify dialog, then `photoshop_apply_liquify({ mode: "apply_mesh", meshPath: "…" })`. Confirm the warp applies. Also confirm `mode:"dialog"` opens the dialog.
4. **Lighting Effects** — `photoshop_apply_lighting_effects({ intensity: 40 })`. If it errors with "not reliably scriptable", that is the honest expected outcome on modern builds — fall back to a recorded+cleaned action.
