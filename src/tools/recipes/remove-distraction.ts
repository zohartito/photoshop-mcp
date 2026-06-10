import { ToolDefinition, ToolResult } from '../../core/tool-registry.js';
import { PhotoshopConnection } from '../../platform/connection.js';
import { clampInt, executeRecipe } from './_shared.js';

const TOOL_NAME = 'photoshop_recipe_remove_distraction';

export function bindRemoveDistraction(connection: PhotoshopConnection): ToolDefinition {
  return {
    tool: {
      name: TOOL_NAME,
      description:
        'One-shot distraction removal: content-aware fills the current pixel selection. Wrapped in a single undoable history step.\n' +
        '\n' +
        'Users often say: remove that person, erase distraction, content aware remove, clone out object.\n' +
        '\n' +
        'Use when: the user has selected the object or region to remove and wants content-aware fill in one step.\n' +
        'Do NOT use when: no selection exists — use photoshop_select_rectangle or photoshop_select_subject first.\n' +
        'Do NOT use when: generative remove is requested — not scriptable via ExtendScript; this uses content-aware fill only.\n' +
        '\n' +
        'Returns: { ok, summary, undo_history_states_consumed, details: { feather_px, fill_method } }.\n' +
        '\n' +
        'Preconditions: active document with an active pixel selection.\n' +
        'Side effects: fills selected pixels; clears selection; one undo reverts.',
      inputSchema: {
        type: 'object',
        properties: {
          feather_px: {
            type: 'number',
            description: 'Edge feather in pixels before fill (0-20, default 0)',
            minimum: 0,
            maximum: 20,
            default: 0,
          },
        },
      },
    },
    handler: async (args) => runRemoveDistraction(connection, args),
  };
}

async function runRemoveDistraction(
  connection: PhotoshopConnection,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const feather = clampInt(args.feather_px, 0, 20, 0);

  const body = `
    var doc = app.activeDocument;
    var hasSel = false;
    try { hasSel = doc.selection.bounds != null; } catch (e) { hasSel = false; }
    if (!hasSel) {
      return {
        ok: false,
        code: 'selection_required',
        message: 'Active pixel selection required before content-aware fill',
        suggested_next_tool: 'photoshop_select_rectangle'
      };
    }

    app.displayDialogs = DialogModes.NO;

    if (${feather} > 0) {
      try { doc.selection.feather(${feather}); } catch (eF) {}
    }

    var fillDesc = new ActionDescriptor();
    fillDesc.putEnumerated(sTID('using'), sTID('fillContents'), sTID('contentAware'));
    executeAction(sTID('fill'), fillDesc, DialogModes.NO);
    doc.selection.deselect();

    return {
      ok: true,
      summary: 'Distraction removed via content-aware fill (content-aware; refine manually if needed)',
      undo_history_states_consumed: 1,
      next_suggested_tool: 'photoshop_get_preview',
      details: {
        feather_px: ${feather},
        fill_method: 'content_aware'
      }
    };
  `;

  return executeRecipe(connection, 'Remove Distraction', body);
}
