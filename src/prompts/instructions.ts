/**
 * Server-level guidance for host LLMs (Cursor, Claude Desktop, standalone UI).
 * Advertised on MCP `initialize` via ServerOptions.instructions.
 */
export const PHOTOSHOP_MCP_INSTRUCTIONS = `
Photoshop tools (photoshop-mcp server)
=====================================

Session bootstrap
- Call \`photoshop_ping\` exactly once at the start of a session to verify the
  connection. Do not repeat it on every turn.
- Before suggesting AI-powered features (Generative Fill, Generative Upscale,
  Select Subject v2, neural filters, etc.), call \`photoshop_get_capabilities\`
  once to learn which features the user's installed Photoshop version exposes.

State before action
- Before any tool that needs an active document or active layer, call
  \`photoshop_get_state\` to confirm what is currently open. Treat its output as
  the source of truth for document dimensions, activeLayer, selection bounds and color
  mode.
- For visual confirmation after meaningful edits, call
  \`photoshop_get_preview\` (cheap, side-effect free JPEG snapshot). Use it
  sparingly — once per major step, not per atomic tool.

Recipe tools over atomic chains
- When the user's request matches a recipe purpose ("remove background",
  "enhance portrait", "prepare for web", "export Instagram variants",
  "apply cinematic color grade", "frequency separation", "replace mockup",
  "organize layers"), prefer the matching \`photoshop_recipe_*\` tool over
  composing 5+ atomic calls yourself. Recipes are wrapped in a single
  history step and are deterministically reversible with one undo.
- Drop back to atomic \`photoshop_*\` tools only for fine-grained, novel
  edits that no recipe covers.

Units & conventions
- All numeric coordinates, widths, heights and bounds are pixels. The server
  forces pixel/point units around every script — do not translate to inches/cm/percent.
- Font sizes are points. Colors are 0–255 RGB triplets.
- Output files default to \`~/.photoshop-mcp/exports[/<chat-id>]\`. Pass an absolute
  path only when the user explicitly asks for one.

Error recovery contract
- Tools return a structured envelope when something is wrong:
  \`{ ok: false, code, message, suggested_next_tool?, suggested_args?, context? }\`
  along with MCP's \`isError: true\`. When you see this, follow the
  \`suggested_next_tool\` hint instead of guessing or retrying blindly.
- Common codes you should be ready to handle without asking the user:
  - \`no_active_document\` — call \`photoshop_open_image\` or
    \`photoshop_create_document\` first.
  - \`no_active_layer\` / \`layer_not_found\` — list layers with
    \`photoshop_get_layers\`, then act on a specific name.
  - \`selection_required\` — make a selection before reusing the failed tool.
  - \`version_unsupported\` / \`generative_unavailable\` — degrade gracefully
    to a non-generative alternative; tell the user once which feature is
    missing.

Multi-step etiquette
- After every tool result, decide: continue with the next planned tool, or
  emit a short user-facing summary. Do not end a turn on a tool call when
  the user asked for an outcome.
- Group related atomic edits inside a recipe when possible. When you must
  chain atomics, name layers (\`photoshop_rename_layer\`) so future turns can
  re-target them deterministically.
`.trim();

export function buildPhotoshopInstructions(): string {
  return PHOTOSHOP_MCP_INSTRUCTIONS;
}
