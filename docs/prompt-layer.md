# AI / Prompt Layer for Photoshop

The photoshop-mcp server exposes 55 atomic `photoshop_*` tools plus a thin
AI/prompt layer ported from TTT: server-level instructions, MCP prompt templates,
recipe tools, state/preview tools, version-aware capabilities, and structured
error envelopes.

## 1. Server `instructions`

Source: [`src/prompts/instructions.ts`](../src/prompts/instructions.ts)

Advertised on MCP `initialize`. Covers session bootstrap, recipe-over-atomic
selection, `~/.photoshop-mcp/exports` conventions, and error recovery contract.

## 2. MCP `prompts` primitive

Eight templates in [`src/prompts/templates/`](../src/prompts/templates/), registered via
[`src/prompts/registry.ts`](../src/prompts/registry.ts).

| Prompt | Recipe tool |
|--------|-------------|
| `ps.enhance_portrait` | `photoshop_recipe_enhance_portrait` |
| `ps.remove_background` | `photoshop_recipe_remove_background` |
| `ps.prepare_for_web` | `photoshop_recipe_prepare_for_web` |
| `ps.export_social_variants` | `photoshop_recipe_export_social_variants` |
| `ps.apply_color_grade` | `photoshop_recipe_apply_color_grade` |
| `ps.frequency_separation` | `photoshop_recipe_frequency_separation` |
| `ps.batch_mockup_replace` | `photoshop_recipe_batch_mockup_replace` |
| `ps.organize_layers` | `photoshop_recipe_organize_layers` |

Each template uses arg coercion helpers from [`src/prompts/_shared.ts`](../src/prompts/_shared.ts)
and returns a `GetPromptResult` with `description` + structured Goal/Plan/End state text.

## 3. Recipe tools

Eight recipes in [`src/tools/recipes/`](../src/tools/recipes/), sharing
[`src/tools/recipes/_shared.ts`](../src/tools/recipes/_shared.ts) (`executeRecipe`,
`suspendHistory`, uniform `{ ok, summary, ... }` envelope).

Export recipes write to `~/.photoshop-mcp/exports` (or `~/.photoshop-mcp/exports/<chat-id>`
when the standalone UI passes `PHOTOSHOP_EXPORT_CHAT_ID` to the MCP child).

## 4. State & preview tools

| Tool | File |
|------|------|
| `photoshop_get_state` | [`src/tools/state-tools.ts`](../src/tools/state-tools.ts) |
| `photoshop_get_preview` | same |
| `photoshop_get_capabilities` | same |

## 5. Verification

```bash
npm run verify:photoshop-prompts
```

Strict 8↔8 recipe/prompt parity check (ported from TTT).

## Backwards compatibility

All 55 original `photoshop_*` tool names and schemas are unchanged. New
capabilities are additive only.
