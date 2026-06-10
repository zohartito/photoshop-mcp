# Intent Taxonomy (finalized — Phase 0 handoff)

`User phrase` → `Intent ID` → primary tool/recipe → fallback → capability gate.

## Tier A — high frequency

| User phrase (EN / TR-adjacent) | Intent ID | Primary | Fallback chain | Gate |
|-------------------------------|-----------|---------|----------------|------|
| remove background, cut out, isolate subject, arka planı sil | `bg.remove` | `photoshop_recipe_remove_background` | `photoshop_select_subject` → mask → feather | `select_subject_v2` — **scriptable** |
| remove that person, erase distraction, generative remove | `obj.remove` | `photoshop_recipe_remove_distraction` (P4) | `photoshop_content_aware_fill` → ask user | `generative_fill` — **manual_only** (ExtendScript); use content-aware |
| fade into background, gradient mask, blend subject | `mask.gradient_fade` | `photoshop_recipe_gradient_fade` (P4) | `photoshop_apply_gradient_mask` on existing mask | none; gradient mask **P2 research** |
| replace sky, fix blown sky, better clouds | `sky.replace` | `photoshop_recipe_sky_blend` (P4) | `photoshop_place_image` + gradient mask | `sky_replacement` — **manual_only**; manual blend default |
| smooth skin, retouch portrait, fix blemishes | `portrait.enhance` | `photoshop_recipe_enhance_portrait` | `photoshop_recipe_frequency_separation` | none |
| frequency separation, split texture and color | `portrait.freq_sep` | `photoshop_recipe_frequency_separation` | manual group + blur (recipe) | RGB raster layer |
| make it pop, S-curve, fix flat image | `color.correct` | `photoshop_adjust_curves` (P3) | `photoshop_auto_levels` → brightness/contrast | curves — **scriptable** |
| cinematic, teal orange, moody grade | `color.grade` | `photoshop_recipe_apply_color_grade` | hue/sat + curves atomics | RGB document |
| dodge and burn, sculpt light, lighten face | `light.dodge_burn` | `photoshop_recipe_dodge_burn` (P4) | guide: gray overlay + blend mode atomics | none |

## Tier B — supporting

| User phrase | Intent ID | Primary | Fallback | Gate |
|-------------|-----------|---------|----------|------|
| mask the adjustment, only on face | `mask.adjustment` | Curves/HS + invert mask (guide) | `photoshop_create_layer_mask` | active adjustment layer |
| screen for glow, multiply darken | `blend.mode` | `photoshop_set_layer_blend_mode` | opacity tweak | none |
| for Instagram, web export | `export.social` | `photoshop_recipe_export_social_variants` | `photoshop_recipe_prepare_for_web` | none |
| organize layers, rename mess | `layers.organize` | `photoshop_recipe_organize_layers` | `photoshop_rename_layer` | none |

## Disambiguation rules (for instructions glossary)

| Ambiguous term | Meaning A | Meaning B |
|----------------|-----------|-----------|
| gradient | Linear gradient **on layer mask** (blend) | **Gradient Fill** layer (`LayerKind.GRADIENTFILL`) |
| remove | Delete layer pixels | Mask or generative/content-aware inpainting |
| sharpen | Recipe prepare_for_web sharpen pass | `photoshop_apply_sharpen` on active layer |

## Phase 0 spike summary (PS 26.5.0)

| Spike action | Status |
|--------------|--------|
| curves_adjustment | scriptable |
| select_subject | scriptable (production recipe; synthetic spike fails) |
| content_aware_fill | scriptable |
| gradient_mask | **scriptable** — StackSupport `Grdn` + channel/mask `at` ref (Phase 2 handoff) |
| generative_fill / generative_remove / sky_replacement | manual_only — omit generative atomics |

See [phase-0-handoff.md](./phase-0-handoff.md) for full table and go/no-go.
