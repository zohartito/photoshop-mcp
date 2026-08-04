# Development

Build, lint, and test the photoshop-mcp server locally.

← Back to [README](../README.md)

### From Source

```bash
git clone https://github.com/alisaitteke/photoshop-mcp.git
cd photoshop-mcp
npm install
npm run build
```

### Build

```bash
npm run build
```

### Watch Mode

```bash
npm run dev
```

### Lint & Format

```bash
npm run lint
npm run format
```

### Integration tests (requires running Photoshop)

```bash
npm run build:server
npm run spike:issue-2     # issue #2 targeted regression (no alert-dialog check)
npm run test:mcp-local    # prompt-layer smoke
npm run test:mcp-all      # full sequential tool sweep
npm run spike:photoshop-actions  # generative AI action probes → scripts/output/generative-probe-report.json
npm run verify:photoshop-prompts
```

### UXP bridge plugin (Neural Filters)

Neural Filters (`photoshop_neural_filter`) require the companion plugin in `uxp-plugin/`:

1. Install [Adobe UXP Developer Tools](https://developer.adobe.com/photoshop/uxp/2022/guides/devtool/).
2. **Load Plugin** → select the `uxp-plugin/` folder in this repo.
3. Open the **MCP Bridge** panel in Photoshop (keeps polling the MCP server on `127.0.0.1:38452`).
4. Start `photoshop-mcp` — the server starts the bridge HTTP listener automatically.

The standalone browser UI is security-disabled pending authenticated pairing and
TLS. `npm run dev:web` only serves the preserved frontend source; it is not a
supported route to the privileged Photoshop API.

Override port with `PHOTOSHOP_UXP_BRIDGE_PORT` (default `38452`).

### Generative AI tools

Firefly tools (`photoshop_generative_*`, `photoshop_generate_image`, `photoshop_sky_replacement`) require:

- Photoshop 24+ (Generative Fill) or 27+ (Generative Upscale)
- Signed-in Adobe account with generative credits
- Optional live smoke: `PHOTOSHOP_AI_SMOKE=1 npm run test:mcp-all`

## Integration-test status

Live Photoshop coverage is **unverified for this checkout**. The owner must run
the following harnesses against a prepared local Photoshop instance before
recording pass/fail/skip totals; this document intentionally does not preserve
historical totals as current evidence.

| Suite                    | Command                            | Current evidence                                                                                                         |
| ------------------------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Issue #2 regression      | `npm run spike:issue-2`            | Owner live harness pending; covers metadata, layers, placement, Smart Object transforms, escaping, fonts, and CJK names. |
| Full tool + recipe sweep | `npm run test:mcp-all`             | Owner live harness pending.                                                                                              |
| Prompt-layer smoke       | `npm run test:mcp-local`           | Owner live harness pending.                                                                                              |
| Prompt ↔ recipe parity   | `npm run verify:photoshop-prompts` | Static check; current catalog target is 11 recipe prompts and 7 guides.                                                  |

Static package metadata currently declares 85 tools, including 11
`photoshop_recipe_*` tools, and 18 prompts (11 recipe + 7 guide). This is a
catalog count, not live integration-test evidence.

**Intentional skips** (environment-dependent, not regressions):

| Tool                                    | Reason                                                               |
| --------------------------------------- | -------------------------------------------------------------------- |
| `photoshop_play_action`                 | Requires a real Actions palette entry on the machine                 |
| `photoshop_select_subject`              | Requires a recognizable subject in the active layer                  |
| `photoshop_recipe_remove_background`    | Synthetic test canvas has no recognizable subject for Select Subject |
| `photoshop_recipe_batch_mockup_replace` | Requires a Smart Object mockup PSD                                   |

**PS 26 compatibility notes** (ExtendScript): layer masks use `stringID make`;
mask apply uses `delete` + `apply: true`; hue/saturation uses `Hst2` descriptors;
frequency separation uses `applyImageEvent` calculation descriptors. See
[`src/api/extendscript.ts`](../src/api/extendscript.ts) and
[`src/tools/recipes/_shared.ts`](../src/tools/recipes/_shared.ts).

Prerequisites: Photoshop installed and scriptable; run from the repo root after
`npm run build:server`.

## Usage Examples

Prompt the AI assistant in natural language — the MCP server picks the right tools.

### Create a Simple Design

> Create an 800×600 RGB document, add a light blue background layer, center the text "My Design" at 64pt, then save as `design.psd` on the Desktop.

### Batch Process Images

> Open my image, resize to 1920×1080, save as a high-quality JPEG to the Desktop, then close without saving the PSD.

### Design with Stock Images (Pexels)

Combine with a [Pexels MCP server](https://github.com/modelcontextprotocol/servers) if configured:

> Search Pexels for "nature landscape", place the downloaded photo in a 1920×1080 document, fit to fill the canvas, add "Beautiful Nature" as overlay text at the top, save as `nature-design.psd`.

## Quick Start Examples

### Common Use Cases

| Task                     | Prompt Example                                                           |
| ------------------------ | ------------------------------------------------------------------------ |
| **Basic Design**         | "Create 1920x1080 document, add blue background, center text 'Hello'"    |
| **Photo Edit**           | "Open photo.jpg, apply auto levels, sharpen 100%, save as edited.jpg"    |
| **Stock Image**          | "Place image.jpg, fit to fill canvas, add overlay text 'Summer 2026'"    |
| **Layer Effects**        | "Set active layer blend mode to MULTIPLY, opacity 80%"                   |
| **Filters**              | "Apply 10px Gaussian blur to current layer"                              |
| **Text Styling**         | "Change text to Helvetica 64pt, color red, center aligned"               |
| **Batch Work**           | "Resize to 1080x1080, auto contrast, save as square.jpg, close"          |
| **Masks**                | "Select rectangle 100,100 to 500,500, create layer mask"                 |
| **Portrait recipe**      | "Enhance portrait at medium intensity with skin smoothing, then preview" |
| **Background removal**   | "Remove background from active layer, 2px feather, non-destructive mask" |
| **Social export**        | "Export Instagram and X post variants to the exports folder"             |
| **Color grade**          | "Apply warm_film color grade as adjustment layers"                       |
| **Frequency separation** | "Build FS stack at 6px — I'll paint the Low/High layers myself"          |
| **State check**          | "Ping Photoshop, get capabilities, then get_state before editing"        |
