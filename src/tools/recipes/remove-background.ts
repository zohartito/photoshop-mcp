import { ToolDefinition, ToolResult } from '../../core/tool-registry.js';
import { PhotoshopConnection } from '../../platform/connection.js';
import { PhotoshopDetector } from '../../platform/detector.js';
import { clampInt, executeRecipe, toolFailure } from './_shared.js';

const TOOL_NAME = 'photoshop_recipe_remove_background';

export function bindRemoveBackground(connection: PhotoshopConnection): ToolDefinition {
  return {
    tool: {
      name: TOOL_NAME,
      description:
        'One-shot background removal: runs Select Subject on the active layer, inverts the selection, attaches a layer mask, and applies an optional feather. Wrapped in a single undoable history step.\n' +
        '\n' +
        'Use when: the user wants the subject isolated from the background non-destructively. The source pixels are preserved behind the mask.\n' +
        'Do NOT use when: the subject is extremely fine-edged (hair against a busy background) — propose a manual Refine Edge pass afterwards.\n' +
        '\n' +
        'Returns: { ok, summary, undo_history_states_consumed, details }. On failure, an error envelope with code and suggested_next_tool.\n' +
        '\n' +
        'Preconditions: PS ≥ 23 (Select Subject v2). Active document with a non-background active layer that contains a subject.\n' +
        'Side effects: attaches a pixel mask to the active layer; no pixels destroyed; one undo reverts everything.',
      inputSchema: {
        type: 'object',
        properties: {
          feather_px: {
            type: 'number',
            description:
              'Edge feather in pixels (0-20). 0 = hard edge (default for product shots), 1-3 = soft edge for portraits.',
            minimum: 0,
            maximum: 20,
            default: 0,
          },
          keep_shadow: {
            type: 'boolean',
            description:
              'Reserved for a future iteration; currently recorded in the response but no shadow layer is created yet.',
            default: false,
          },
        },
      },
    },
    handler: async (args) => runRemoveBackground(connection, args),
  };
}

async function runRemoveBackground(
  connection: PhotoshopConnection,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const feather = clampInt(args.feather_px, 0, 20, 0);
  const keepShadow = args.keep_shadow === true;

  await connection.ping().catch(() => undefined);
  const info = connection.getPhotoshopInfo();
  if (info) {
    const detector = new PhotoshopDetector();
    if (!detector.supportsSelectSubjectV2(info.version)) {
      return toolFailure({
        ok: false,
        code: 'version_unsupported',
        message: `Select Subject v2 requires Photoshop 23.0+; detected version ${info.version}. Upgrade Photoshop or remove the background manually.`,
        suggested_next_tool: 'photoshop_get_capabilities',
      });
    }
  }

  const body = `
    var doc = app.activeDocument;
    var layer = doc.activeLayer;
    if (layer.isBackgroundLayer) {
      return { ok: false, code: 'no_active_layer', message: 'Active layer is the Background layer — convert it to a normal layer first.', suggested_next_tool: 'photoshop_rasterize_layer' };
    }

    try {
      var idAutoCutout = stringIDToTypeID('autoCutout');
      executeAction(idAutoCutout, undefined, DialogModes.NO);
    } catch (eSelectSubject) {
      return { ok: false, code: 'generative_unavailable', message: 'Select Subject is not available: ' + (eSelectSubject.message || eSelectSubject), suggested_next_tool: 'photoshop_get_capabilities' };
    }

    var hasSel = false;
    try { hasSel = doc.selection.bounds != null; } catch (e) { hasSel = false; }
    if (!hasSel) {
      return { ok: false, code: 'selection_required', message: 'Select Subject produced no selection — the layer may not contain a recognizable subject.' };
    }

    if (${feather} > 0) {
      try { doc.selection.feather(${feather}); } catch (eF) {}
    }

    var idMk = charIDToTypeID('Mk  ');
    var idMsk = charIDToTypeID('Msk ');
    var idChnl = charIDToTypeID('Chnl');
    var idUsng = charIDToTypeID('Usng');
    var idUsrM = charIDToTypeID('UsrM');
    var idRvlS = charIDToTypeID('RvlS');
    var maskDesc = new ActionDescriptor();
    var maskRef = new ActionReference();
    maskRef.putEnumerated(idChnl, idChnl, idMsk);
    maskDesc.putReference(charIDToTypeID('null'), maskRef);
    maskDesc.putEnumerated(idUsng, idUsrM, idRvlS);
    executeAction(idMk, maskDesc, DialogModes.NO);

    return {
      ok: true,
      summary: 'Background removed via Select Subject + layer mask' + (${feather} > 0 ? ' (feather ' + ${feather} + 'px)' : ''),
      undo_history_states_consumed: 1,
      next_suggested_tool: 'photoshop_get_preview',
      details: {
        feather_px: ${feather},
        keep_shadow: ${keepShadow ? 'true' : 'false'},
        layer_name: layer.name
      }
    };
  `;

  return executeRecipe(connection, 'Remove Background', body);
}
