import type { ToolDefinition } from '../core/tool-registry.js';
import type { TransportRouter } from '../transport/index.js';
import { executeRecipe, jsString } from './recipes/_shared.js';

/**
 * Dedicated Smart Object tools (Tier-1 roadmap item #6).
 *
 * These wrap the Action Manager Smart Object events behind typed, discoverable tools:
 *   - convert_to_smart_object   -> executeAction('newPlacedLayer')
 *   - replace_smart_object_contents -> executeAction('placedLayerReplaceContents') w/ a file
 *   - export_smart_object_contents  -> executeAction('placedLayerExportContents') w/ a path
 *
 * WHY: replace-contents is the core of template/mockup automation (drop a new image into a
 * Smart Object and every warp/style/perspective baked around it re-renders). Improvising the
 * descriptor per call is error-prone; these give one-undo, validated, guarded operations.
 *
 * ONE UNDO: convert and replace mutate the document and run through the shared recipe executor
 * (suspendHistory wrap + {ok,summary,...} envelope), so a single undo reverts them. Export is a
 * read-only disk write and consumes 0 history states.
 *
 * GUARD: replace/export require the ACTIVE LAYER to already BE a Smart Object
 * (layer.kind === LayerKind.SMARTOBJECT). A clear error is thrown otherwise. convert requires a
 * non-group active layer that is not already a Smart Object.
 *
 * NOTE: rasterizing a Smart Object back to pixels is already covered by
 * `photoshop_rasterize_layer` (its snippet has a SMARTOBJECT branch that runs 'rasterizePlaced'),
 * so no dedicated rasterize tool is added here — see docs.
 */

/**
 * Shared ExtendScript guard block. Defines __mcp_so_* helpers reused by every Smart Object body.
 * Prepended to each recipe body before the tool-specific logic runs.
 */
const SMART_OBJECT_HELPERS = `
function __mcp_so_s2t(s) { return app.stringIDToTypeID(s); }

/** Return the active layer or throw if none / a group. */
function __mcp_so_activeLayer() {
  var doc = app.activeDocument;
  var layer = doc.activeLayer;
  if (!layer) {
    throw new Error('No active layer. Select a layer first.');
  }
  if (layer.typename === 'LayerSet') {
    throw new Error('Active item is a layer group — select a single layer first.');
  }
  return layer;
}

/** Assert the active layer IS a Smart Object; return it. */
function __mcp_so_assertSmartObject(opName) {
  var layer = __mcp_so_activeLayer();
  if (layer.kind !== LayerKind.SMARTOBJECT) {
    throw new Error(
      opName + ' requires the active layer to be a Smart Object. Active layer "' +
      layer.name + '" is kind ' + String(layer.kind) +
      '. Convert it first with photoshop_convert_to_smart_object.'
    );
  }
  return layer;
}
`;

export function createSmartObjectTools(transport: TransportRouter): ToolDefinition[] {
  return [
    bindConvertToSmartObject(transport),
    bindReplaceSmartObjectContents(transport),
    bindExportSmartObjectContents(transport),
  ];
}

export const PHOTOSHOP_SMART_OBJECT_TOOL_NAMES = [
  'photoshop_convert_to_smart_object',
  'photoshop_replace_smart_object_contents',
  'photoshop_export_smart_object_contents',
] as const;

// ---------------------------------------------------------------------------
// Convert to Smart Object
// ---------------------------------------------------------------------------

function bindConvertToSmartObject(transport: TransportRouter): ToolDefinition {
  return {
    tool: {
      name: 'photoshop_convert_to_smart_object',
      description:
        'Convert the ACTIVE LAYER (or the currently selected layers) to a single Smart Object.\n\n' +
        'Users often say: convert to smart object, make it a smart object, wrap this in a smart object.\n\n' +
        'Runs the newPlacedLayer event — if multiple layers are selected they are packaged into one ' +
        'Smart Object (like Layer > Smart Objects > Convert to Smart Object). This is the setup step ' +
        'for non-destructive scaling and for the template/mockup workflow (then use ' +
        'photoshop_replace_smart_object_contents). One undo reverts it.\n\n' +
        'Guard: fails on a layer group, and is a no-op-with-error if the active layer is already a Smart Object.\n\n' +
        'Returns: { ok, summary, details: { layer_name, kind } }.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    handler: async () => {
      const body = `
        ${SMART_OBJECT_HELPERS}
        var __layer = __mcp_so_activeLayer();
        if (__layer.kind === LayerKind.SMARTOBJECT) {
          return {
            ok: false,
            code: 'already_smart_object',
            message: 'Active layer "' + __layer.name + '" is already a Smart Object.'
          };
        }
        executeAction(__mcp_so_s2t('newPlacedLayer'), undefined, DialogModes.NO);
        var __result = app.activeDocument.activeLayer;
        return {
          ok: true,
          summary: 'Converted "' + __result.name + '" to a Smart Object',
          undo_history_states_consumed: 1,
          next_suggested_tool: 'photoshop_replace_smart_object_contents',
          details: {
            layer_name: __result.name,
            kind: String(__result.kind)
          }
        };
      `;
      return executeRecipe(transport, 'Convert to Smart Object', body);
    },
  };
}

// ---------------------------------------------------------------------------
// Replace Smart Object contents
// ---------------------------------------------------------------------------

function bindReplaceSmartObjectContents(transport: TransportRouter): ToolDefinition {
  return {
    tool: {
      name: 'photoshop_replace_smart_object_contents',
      description:
        "Replace the ACTIVE Smart Object's contents with an image file on disk (the template-mockup workflow).\n\n" +
        'Users often say: replace the smart object, drop this image into the mockup, swap the artwork.\n\n' +
        'Runs placedLayerReplaceContents with filePath. Any transform (scale/warp/perspective) and layer ' +
        'styles already applied to the Smart Object are preserved and re-render around the new source — ' +
        'this is what makes branded mockups repeatable. One undo reverts it.\n\n' +
        'Guard: the active layer MUST already be a Smart Object (kind SMARTOBJECT) or a clear error is ' +
        'thrown; convert first with photoshop_convert_to_smart_object. The file must exist on disk.\n\n' +
        'Returns: { ok, summary, details: { layer_name, file_path } }.',
      inputSchema: {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description: 'Absolute path to the replacement image file (PNG, JPEG, PSD, TIFF, etc.)',
          },
        },
        required: ['filePath'],
      },
    },
    handler: async (args) => {
      const filePath = String(args.filePath ?? '');
      if (!filePath) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                { ok: false, code: 'missing_file_path', message: 'filePath is required' },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }
      const body = `
        ${SMART_OBJECT_HELPERS}
        var __layer = __mcp_so_assertSmartObject('Replace Smart Object contents');
        var __file = new File("${jsString(filePath)}");
        if (!__file.exists) {
          return {
            ok: false,
            code: 'file_not_found',
            message: 'Replacement file not found: ${jsString(filePath)}'
          };
        }
        var __desc = new ActionDescriptor();
        __desc.putPath(__mcp_so_s2t('null'), __file);
        __desc.putInteger(__mcp_so_s2t('layerID'), __layer.id);
        executeAction(__mcp_so_s2t('placedLayerReplaceContents'), __desc, DialogModes.NO);
        var __result = app.activeDocument.activeLayer;
        return {
          ok: true,
          summary: 'Replaced contents of "' + __result.name + '"',
          undo_history_states_consumed: 1,
          next_suggested_tool: 'photoshop_get_preview',
          details: {
            layer_name: __result.name,
            file_path: "${jsString(filePath)}"
          }
        };
      `;
      return executeRecipe(transport, 'Replace Smart Object Contents', body);
    },
  };
}

// ---------------------------------------------------------------------------
// Export Smart Object contents
// ---------------------------------------------------------------------------

function bindExportSmartObjectContents(transport: TransportRouter): ToolDefinition {
  return {
    tool: {
      name: 'photoshop_export_smart_object_contents',
      description:
        "Export the ACTIVE Smart Object's embedded source to a file on disk, unmodified.\n\n" +
        'Users often say: export the smart object contents, save the embedded source, extract the original.\n\n' +
        'Runs placedLayerExportContents to write the exact bytes stored inside the Smart Object (the ' +
        'original placed PSB/PNG/etc.) to outputPath — useful for recovering or re-using the source art. ' +
        'This is a read-only disk write; it does NOT modify the document (0 undo states).\n\n' +
        'Guard: the active layer MUST be a Smart Object (kind SMARTOBJECT) or a clear error is thrown. ' +
        'The exported file keeps the Smart Object\'s stored format/extension; give outputPath a matching ' +
        'extension when known.\n\n' +
        'Support note: placedLayerExportContents is available for embedded Smart Objects. If a specific ' +
        'Smart Object cannot be exported (e.g. certain linked or generated sources), Photoshop raises an ' +
        'error which is surfaced verbatim.\n\n' +
        'Returns: { ok, summary, details: { layer_name, output_path } }.',
      inputSchema: {
        type: 'object',
        properties: {
          outputPath: {
            type: 'string',
            description:
              "Absolute path to write the Smart Object's source to. Use an extension matching the stored source (e.g. .psb, .png).",
          },
        },
        required: ['outputPath'],
      },
    },
    handler: async (args) => {
      const outputPath = String(args.outputPath ?? '');
      if (!outputPath) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                { ok: false, code: 'missing_output_path', message: 'outputPath is required' },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }
      // Export is a pure disk write (no document mutation), but we still route it through the
      // recipe executor for a uniform {ok,summary,...} envelope and the global operation queue.
      // undo_history_states_consumed is reported as 0.
      const body = `
        ${SMART_OBJECT_HELPERS}
        var __layer = __mcp_so_assertSmartObject('Export Smart Object contents');
        var __out = new File("${jsString(outputPath)}");
        var __desc = new ActionDescriptor();
        __desc.putPath(__mcp_so_s2t('null'), __out);
        __desc.putInteger(__mcp_so_s2t('layerID'), __layer.id);
        executeAction(__mcp_so_s2t('placedLayerExportContents'), __desc, DialogModes.NO);
        return {
          ok: true,
          summary: 'Exported contents of "' + __layer.name + '" to ${jsString(outputPath)}',
          undo_history_states_consumed: 0,
          output_paths: ["${jsString(outputPath)}"],
          details: {
            layer_name: __layer.name,
            output_path: "${jsString(outputPath)}"
          }
        };
      `;
      return executeRecipe(transport, 'Export Smart Object Contents', body);
    },
  };
}
