import { ToolDefinition, ToolResult } from '../../core/tool-registry.js';
import { PhotoshopConnection } from '../../platform/connection.js';
import { clampInt, executeRecipe } from './_shared.js';

const TOOL_NAME = 'photoshop_recipe_frequency_separation';

export function bindFrequencySeparation(connection: PhotoshopConnection): ToolDefinition {
  return {
    tool: {
      name: TOOL_NAME,
      description:
        'Build a frequency separation stack (Low + High) on top of the active layer for hands-on retouching. Does not apply any smoothing itself — the user paints into the layers afterwards.\n' +
        '\n' +
        'Use when: the user explicitly wants frequency separation setup, typically for portrait or product retouching.\n' +
        'Do NOT use when: the user wants a one-shot result without painting — use photoshop_recipe_enhance_portrait instead.\n' +
        '\n' +
        'Returns: { ok, summary, details: { radius_px, group_name } }.\n' +
        '\n' +
        'Preconditions: active document with a NORMAL raster active layer.\n' +
        'Side effects: appends a "Frequency Separation" layer group with 2 prepared layers; one undo reverts everything.',
      inputSchema: {
        type: 'object',
        properties: {
          radius_px: {
            type: 'number',
            description:
              'Gaussian blur radius for the low-frequency layer. 4-8 for portraits, 10-20 for products. Default 6. Range 1-50.',
            minimum: 1,
            maximum: 50,
            default: 6,
          },
        },
      },
    },
    handler: async (args) => runFrequencySeparation(connection, args),
  };
}

async function runFrequencySeparation(
  connection: PhotoshopConnection,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const radius = clampInt(args.radius_px, 1, 50, 6);

  const body = `
    var doc = app.activeDocument;
    var src = doc.activeLayer;
    if (src.kind !== LayerKind.NORMAL) {
      return { ok: false, code: 'unsupported_color_mode', message: 'Active layer is not a raster layer. Rasterize or pick a normal layer first.', suggested_next_tool: 'photoshop_rasterize_layer' };
    }

    var group = doc.layerSets.add();
    group.name = 'Frequency Separation';

    var low = src.duplicate(group, ElementPlacement.INSIDE);
    low.name = 'FS · Low';
    low.applyGaussianBlur(${radius});

    var high = src.duplicate(group, ElementPlacement.INSIDE);
    high.name = 'FS · High';
    doc.activeLayer = high;

    var applyDesc = new ActionDescriptor();
    var srcDesc = new ActionDescriptor();
    var srcRef = new ActionReference();
    srcRef.putName(charIDToTypeID('Lyr '), low.name);
    srcDesc.putReference(charIDToTypeID('T   '), srcRef);
    srcDesc.putEnumerated(charIDToTypeID('Clcl'), charIDToTypeID('Clcn'), charIDToTypeID('Sbtr'));
    srcDesc.putInteger(charIDToTypeID('Scl '), 2);
    srcDesc.putInteger(charIDToTypeID('Ofst'), 128);
    applyDesc.putObject(charIDToTypeID('With'), charIDToTypeID('Clcl'), srcDesc);
    try {
      executeAction(charIDToTypeID('AppI'), applyDesc, DialogModes.NO);
    } catch (eApply) {
      return { ok: false, code: 'recipe_runtime_error', message: 'Apply Image failed: ' + (eApply.message || eApply) };
    }
    high.blendMode = BlendMode.LINEARLIGHT;

    return {
      ok: true,
      summary: 'Frequency separation stack ready at radius ${radius}px — paint on FS · Low to smooth, FS · High to retouch texture',
      undo_history_states_consumed: 1,
      next_suggested_tool: 'photoshop_get_preview',
      details: {
        radius_px: ${radius},
        group_name: group.name,
        low_layer: low.name,
        high_layer: high.name
      }
    };
  `;

  return executeRecipe(connection, 'Frequency Separation', body);
}
