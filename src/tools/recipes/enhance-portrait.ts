import { ToolDefinition, ToolResult } from '../../core/tool-registry.js';
import { PhotoshopConnection } from '../../platform/connection.js';
import { executeRecipe } from './_shared.js';

const TOOL_NAME = 'photoshop_recipe_enhance_portrait';

const INTENSITY_OPTIONS = ['low', 'medium', 'high'] as const;
type Intensity = (typeof INTENSITY_OPTIONS)[number];

const RADIUS_BY_INTENSITY: Record<Intensity, number> = {
  low: 2,
  medium: 4,
  high: 7,
};

export function bindEnhancePortrait(connection: PhotoshopConnection): ToolDefinition {
  return {
    tool: {
      name: TOOL_NAME,
      description:
        'Set up a non-destructive portrait enhancement: duplicates the active layer, builds a frequency separation pair (low/high) for skin smoothing, and adds an auto-tone curves adjustment on top. Grouped as "Enhance Portrait" and reversible with one undo.\n' +
        '\n' +
        'Use when: the user asks to "enhance", "retouch", "clean up" or "smooth" a portrait photo and is happy with a baseline that they can further tweak interactively.\n' +
        'Do NOT use when: the user wants destructive, final edits — recommend manual frequency separation work via photoshop_recipe_frequency_separation instead so they can paint by hand.\n' +
        '\n' +
        'Returns: { ok, summary, details: { intensity, radius_px, group_name } }.\n' +
        '\n' +
        'Preconditions: active document with a NORMAL or background-converted raster layer.\n' +
        'Side effects: appends one layer group of 2-3 layers above the active layer; original layer untouched.',
      inputSchema: {
        type: 'object',
        properties: {
          intensity: {
            type: 'string',
            description:
              'Retouch strength: low (subtle), medium (default), high (heavier smoothing).',
            enum: ['low', 'medium', 'high'],
            default: 'medium',
          },
          skin_smoothing: {
            type: 'boolean',
            description:
              'Whether to build the frequency separation pair. When false, only the auto-tone curves are added.',
            default: true,
          },
        },
      },
    },
    handler: async (args) => runEnhancePortrait(connection, args),
  };
}

async function runEnhancePortrait(
  connection: PhotoshopConnection,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const intensity = parseIntensity(args.intensity);
  const skinSmoothing = args.skin_smoothing !== false;
  const radius = RADIUS_BY_INTENSITY[intensity];

  const body = `
    var doc = app.activeDocument;
    var src = doc.activeLayer;
    if (src.kind !== LayerKind.NORMAL && !src.isBackgroundLayer) {
      return { ok: false, code: 'unsupported_color_mode', message: 'Active layer is not a raster layer (kind=' + src.kind + '). Rasterize or pick a normal layer first.', suggested_next_tool: 'photoshop_rasterize_layer' };
    }
    if (src.isBackgroundLayer) {
      try { src.isBackgroundLayer = false; } catch (eBg) {}
    }

    var group = doc.layerSets.add();
    group.name = 'Enhance Portrait';

    var createdNames = [];

    if (${skinSmoothing ? 'true' : 'false'}) {
      var low = src.duplicate(group, ElementPlacement.INSIDE);
      low.name = 'FS · Low';
      low.applyGaussianBlur(${radius});
      createdNames.push(low.name);

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
      } catch (eApplyImage) {
        return { ok: false, code: 'recipe_runtime_error', message: 'Apply Image step failed: ' + (eApplyImage.message || eApplyImage) };
      }
      high.blendMode = BlendMode.LINEARLIGHT;
      createdNames.push(high.name);
    }

    var idMk = charIDToTypeID('Mk  ');
    var idCrvs = charIDToTypeID('Crvs');
    var curvesDesc = new ActionDescriptor();
    var curvesRef = new ActionReference();
    curvesRef.putClass(idCrvs);
    curvesDesc.putReference(charIDToTypeID('null'), curvesRef);
    var curvesUsing = new ActionDescriptor();
    var curvesAdjust = new ActionDescriptor();
    var curvesAdjustments = new ActionList();
    var curvesPair = new ActionDescriptor();
    var curvesPoints = new ActionList();
    var ptBlack = new ActionDescriptor();
    ptBlack.putDouble(charIDToTypeID('Hrzn'), 12);
    ptBlack.putDouble(charIDToTypeID('Vrtc'), 0);
    var ptWhite = new ActionDescriptor();
    ptWhite.putDouble(charIDToTypeID('Hrzn'), 243);
    ptWhite.putDouble(charIDToTypeID('Vrtc'), 255);
    curvesPoints.putObject(charIDToTypeID('Pnt '), ptBlack);
    curvesPoints.putObject(charIDToTypeID('Pnt '), ptWhite);
    curvesPair.putList(charIDToTypeID('Crv '), curvesPoints);
    var channelRef = new ActionReference();
    channelRef.putEnumerated(charIDToTypeID('Chnl'), charIDToTypeID('Chnl'), charIDToTypeID('Cmps'));
    curvesPair.putReference(charIDToTypeID('Chnl'), channelRef);
    curvesAdjustments.putObject(charIDToTypeID('CrvA'), curvesPair);
    curvesAdjust.putList(charIDToTypeID('Adjs'), curvesAdjustments);
    curvesUsing.putObject(charIDToTypeID('Type'), idCrvs, curvesAdjust);
    curvesDesc.putObject(charIDToTypeID('Usng'), charIDToTypeID('AdjL'), curvesUsing);
    try {
      executeAction(idMk, curvesDesc, DialogModes.NO);
      var curvesLayer = doc.activeLayer;
      curvesLayer.move(group, ElementPlacement.INSIDE);
      curvesLayer.name = 'Auto-tone (curves)';
      createdNames.push(curvesLayer.name);
    } catch (eCurves) {
      return { ok: false, code: 'recipe_runtime_error', message: 'Curves adjustment failed: ' + (eCurves.message || eCurves) };
    }

    return {
      ok: true,
      summary: 'Portrait enhancement set up at intensity "' + '${intensity}' + '" — ' + createdNames.length + ' layers grouped under "Enhance Portrait"',
      undo_history_states_consumed: 1,
      next_suggested_tool: 'photoshop_get_preview',
      details: {
        intensity: '${intensity}',
        radius_px: ${radius},
        group_name: group.name,
        created_layers: createdNames
      }
    };
  `;

  return executeRecipe(connection, 'Enhance Portrait', body);
}

function parseIntensity(raw: unknown): Intensity {
  if (typeof raw !== 'string') return 'medium';
  const v = raw.trim().toLowerCase();
  return INTENSITY_OPTIONS.find((o) => o === v) ?? 'medium';
}
