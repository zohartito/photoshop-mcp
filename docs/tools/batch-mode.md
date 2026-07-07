# Headless Batch Mode

Apply one **recipe** (an ordered list of `photoshop_*` tool steps) to a whole folder of images, from either the MCP tool `photoshop_batch_run` or the CLI subcommand `photoshop-mcp batch <recipe.json>`. Batch mode sits **above** the transport layer and drives the existing tool handlers — it does not reimplement any command (see [transport-layer design §8](../design/transport-layer.md#8-headless-batch-mode-design-sketch-build-in-m4)).

← Back to [Available Tools](../available-tools.md)

## The honest constraint: "headless" = agentless, not Photoshop-less

macOS Photoshop has **no true headless mode**. "Headless" here means **no agent / no MCP client in the loop** — you hand over a recipe and it runs to completion. **The Photoshop GUI must still be running.** The `PhotoshopTransport` id union reserves `firefly` for a hypothetical true-headless cloud backend (Firefly Services / Photoshop API, enterprise-gated); that seam is stubbed in `src/transport/firefly-transport.ts` but **not** built — see [Backend C](#backend-c-firefly-cloud-stub) below.

## Behavior contract (read once)

- **What a recipe is:** JSON with `steps` (ordered `{ name, params }`), plus `inputGlob`, `outputTemplate`, and optional `errorPolicy`. Step `name`/`params` are **identical** to the individual `photoshop_*` MCP tools and their schemas — a recipe step is just a deferred tool call.
- **Per-file lifecycle (engine-managed):** for every matched file the engine runs `open → each step → export → close(no-save)`. **Do not** put open/save/close in your `steps` — the engine owns them. `export` calls `photoshop_save_document` with a path from `outputTemplate` and a format inferred from its extension.
- **Serial by construction.** Photoshop is single-instance; the transport router's one global command queue (transport-layer §6.2) serializes everything. Files are processed one at a time, in **sorted glob order** (so `{index}` is deterministic).
- **Unit of undo is the file, not the step.** A recipe is a *mixed-backend transaction* (open/export are pinned to ExtendScript) and an operation cannot span backends (§6.3), so steps are **not** wrapped in one history scope. Each file is opened fresh and closed without saving the working doc — the only persisted artifact is the exported output.
- **Return:** a **per-file JSON report** (`status`, per-step results, output path, `durationMs`) plus run totals.
- **Errors:** each `photoshop_*` handler returns an error envelope rather than throwing; the engine treats `isError` as a step failure. `errorPolicy` governs the run:
  - `skip` (default): the failing file is marked `skipped`, the doc is still closed, and the run continues to the next file.
  - `abort`: the failing file is marked `failed` and the run stops immediately (`aborted: true` in the report).

## `outputTemplate` substitution

| Token | Expands to |
|---|---|
| `{stem}` | input filename without its extension (`hero.jpg` → `hero`) |
| `{index}` | 1-based file position, zero-padded to the file count (`3` of 12 → `03`) |

The output **extension picks the export format**: `.png` → PNG, `.jpg`/`.jpeg` → JPEG, anything else → PSD. Output directories are created as needed.

Relative `inputGlob` / `outputTemplate` resolve against the **recipe file's directory** (CLI, or the MCP tool when `recipe` is a file path); for an **inline** recipe object/string passed to the MCP tool they resolve against the process working directory.

## `photoshop_batch_run` (MCP tool)

| Param | Type | Notes |
|---|---|---|
| `recipe` | object \| string | **Required.** An inline recipe object, an inline recipe JSON string, or a path to a `.json` recipe file. |
| `inputGlob` | string | Overrides `recipe.inputGlob`. |
| `outputTemplate` | string | Overrides `recipe.outputTemplate`. |
| `errorPolicy` | `skip` \| `abort` | Overrides `recipe.errorPolicy` (default `skip`). |

The call returns the JSON report as text. It is flagged `isError` **only** when *zero* files succeeded (a wholesale failure); a run with some `skipped` files is still a successful call whose report carries the per-file truth. Progress is emitted to **stderr** as `[batch] {json}` lines (stdout is the MCP protocol channel and must not be polluted).

## `photoshop-mcp batch <recipe.json>` (CLI subcommand)

```
photoshop-mcp batch <recipe.json> [options]

Options:
  --input-glob <glob>          Override recipe.inputGlob.
  --output-template <tmpl>     Override recipe.outputTemplate ({stem}, {index}).
  --error-policy <skip|abort>  Override recipe.errorPolicy (default: skip).
  -h, --help                   Show help.
```

Progress → **stderr** (JSON lines); the final per-file report → **stdout** as JSON (pipe/redirect friendly). **Exit code** `0` when no files failed, `1` otherwise (or on a setup error: missing glob/template, no matches, unknown tool in a step).

The CLI builds a `TransportRouter` directly over a `PhotoshopConnection` (same router, same global queue, same backend selection as the server) — it never opens the stdio MCP channel.

### Example

Recipe — [`examples/batch-recipe.example.json`](../../examples/batch-recipe.example.json):

```json
{
  "inputGlob": "./input/*.jpg",
  "outputTemplate": "./output/{stem}-graded.png",
  "errorPolicy": "skip",
  "steps": [
    { "name": "photoshop_adjust_brightness_contrast", "params": { "brightness": 8, "contrast": 12 } },
    { "name": "photoshop_add_vibrance", "params": { "vibrance": 20, "saturation": 5 } },
    { "name": "photoshop_apply_sharpen", "params": { "amount": 60, "radius": 1.0 } }
  ]
}
```

Run it (Photoshop must be open):

```bash
photoshop-mcp batch examples/batch-recipe.example.json
# or override I/O without editing the recipe:
photoshop-mcp batch examples/batch-recipe.example.json \
  --input-glob '/Users/me/shoot/*.jpg' \
  --output-template '/Users/me/out/{index}_{stem}.png' \
  --error-policy abort
```

### Report shape

```jsonc
{
  "ok": true,                 // true when failed === 0
  "totalFiles": 3,
  "succeeded": 3,
  "failed": 0,
  "skipped": 0,
  "errorPolicy": "skip",
  "files": [
    {
      "input": "/abs/input/a.jpg",
      "output": "/abs/output/a-graded.png",   // present only when status === "ok"
      "status": "ok",                          // ok | failed | skipped
      "steps": [
        { "name": "photoshop_adjust_brightness_contrast", "ok": true },
        { "name": "photoshop_add_vibrance", "ok": true },
        { "name": "photoshop_apply_sharpen", "ok": true }
      ],
      "durationMs": 812
    }
  ]
  // "aborted": true          // present only when errorPolicy=abort stopped the run early
}
```

## Python angle

Recipes are plain JSON, so they are trivially authored from Python. Two integration paths:

1. **Shell out** to `photoshop-mcp batch recipe.json` and parse the stdout report.
2. **Drive the MCP tool** from a stdio MCP client, calling `photoshop_batch_run` with an inline `recipe` dict.

Either way the batch loop, ordering, and per-file open/close discipline live in the engine — Python only authors the recipe and reads the report.

## Backend C: Firefly cloud (stub)

`src/transport/firefly-transport.ts` implements the `PhotoshopTransport` interface so the router *could* hold a third backend with zero interface churn, but every network-bound method throws `FireflyNotImplementedError` and `isAvailable()` returns `false` — so `auto` routing never selects it and desktop behavior is unchanged. It is gated behind an explicit opt-in (`PHOTOSHOP_MCP_FIREFLY=1` + `FIREFLY_CLIENT_ID`/`FIREFLY_CLIENT_SECRET`) that, until the cloud client is built, only changes error text. The file documents the checklist a real backend C would own (IMS auth, actionJSON command mapping, presigned-URL asset IO, async job polling, cloud capability reporting). Building the cloud calls is out of scope for M4.
