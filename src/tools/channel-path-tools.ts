import { ToolDefinition, ToolResult } from '../core/tool-registry.js';
import type { TransportRouter } from '../transport/index.js';
import { clampInt, executeRecipe } from './recipes/_shared.js';
import { jsString } from '../utils/js-string.js';

/**
 * Tier-2 "channels / paths / advanced selection" tools.
 *
 * Every tool is a single one-undo operation: the handler builds an ExtendScript
 * body and hands it to executeRecipe(), which wraps it in a suspendHistory scope
 * (docs/design/transport-layer.md §6.3) so the whole multi-step body collapses to
 * one history state. Bodies run inside RECIPE_ACTION_HELPERS, so sTID/cTID and
 * __mcp_s2t/__mcp_c2t are already defined. Guards return
 * { ok:false, code, message, suggested_next_tool } which parseRecipeResult turns
 * into an isError envelope; success returns
 * { ok:true, summary, undo_history_states_consumed:1, details }.
 */

// Color Range preset -> Action Manager `colorRange` colors enum string.
const COLOR_RANGE_PRESETS: Record<string, string> = {
  reds: 'reds',
  yellows: 'yellows',
  greens: 'greens',
  cyans: 'cyans',
  blues: 'blues',
  magentas: 'magentas',
  highlights: 'highlights',
  midtones: 'midtones',
  shadows: 'shadows',
  skin: 'skinTones',
};

const COLOR_RANGE_PRESET_NAMES = Object.keys(COLOR_RANGE_PRESETS);

type RefineOp = 'expand' | 'contract' | 'feather' | 'smooth' | 'border';
const REFINE_OPS: RefineOp[] = ['expand', 'contract', 'feather', 'smooth', 'border'];

export function createChannelPathTools(transport: TransportRouter): ToolDefinition[] {
  return [
    {
      tool: {
        name: 'photoshop_select_color_range',
        description:
          'Select > Color Range: build a pixel selection from a color preset (reds/yellows/greens/cyans/blues/magentas/highlights/midtones/shadows/skin) or a sampled RGB color, controlled by fuzziness. Wrapped in a single undoable step.\n' +
          '\n' +
          'Users often say: select the reds, select highlights, select shadows, select skin tones, select by color.\n' +
          '\n' +
          'Use when: you need a tonal or color-based selection (e.g. mask the highlights, grade the reds, isolate skin).\n' +
          'Do NOT use when: isolating a subject/object — use photoshop_select_subject.\n' +
          '\n' +
          'Returns: { ok, summary, undo_history_states_consumed, details: { mode, preset?, color?, fuzziness, selected } }.\n' +
          '\n' +
          'Preconditions: active document. Side effects: replaces the current selection.',
        inputSchema: {
          type: 'object',
          properties: {
            preset: {
              type: 'string',
              description:
                'Tonal/color preset. One of reds, yellows, greens, cyans, blues, magentas, highlights, midtones, shadows, skin. Omit when sampling a color.',
              enum: COLOR_RANGE_PRESET_NAMES,
            },
            color: {
              type: 'object',
              description:
                'Sampled RGB color to select around (used only when no preset is given). Each channel 0-255.',
              properties: {
                r: { type: 'number', minimum: 0, maximum: 255 },
                g: { type: 'number', minimum: 0, maximum: 255 },
                b: { type: 'number', minimum: 0, maximum: 255 },
              },
              required: ['r', 'g', 'b'],
            },
            fuzziness: {
              type: 'number',
              description:
                'Color Range fuzziness / tolerance (0-200, default 40). Ignored for presets that do not use it.',
              minimum: 0,
              maximum: 200,
              default: 40,
            },
          },
        },
      },
      handler: async (args) => selectColorRange(transport, args),
    },
    {
      tool: {
        name: 'photoshop_refine_selection',
        description:
          'Refine the current pixel selection: grow (expand), shrink (contract), feather, smooth, or convert to a border band. Wrapped in a single undoable step.\n' +
          '\n' +
          'Users often say: grow the selection, shrink it, feather the edge, smooth the selection, make a border.\n' +
          '\n' +
          'Use when: an active selection already exists and needs edge cleanup before masking or filling.\n' +
          'Do NOT use when: there is no selection — create one first (photoshop_select_subject, photoshop_select_color_range, photoshop_select_rectangle).\n' +
          '\n' +
          'Returns: { ok, summary, undo_history_states_consumed, details: { operation, radius, selected } }.\n' +
          '\n' +
          'Preconditions: active document with an active selection. Side effects: modifies the current selection.',
        inputSchema: {
          type: 'object',
          properties: {
            operation: {
              type: 'string',
              description: 'Refinement to apply.',
              enum: REFINE_OPS,
            },
            radius: {
              type: 'number',
              description:
                'Radius / amount in pixels (expand/contract/feather/border). For smooth this is the sample radius. Default 2.',
              minimum: 1,
              maximum: 500,
              default: 2,
            },
          },
          required: ['operation'],
        },
      },
      handler: async (args) => refineSelection(transport, args),
    },
    {
      tool: {
        name: 'photoshop_save_selection_as_channel',
        description:
          'Save the active pixel selection to a named alpha channel (Select > Save Selection). Wrapped in a single undoable step.\n' +
          '\n' +
          'Users often say: save this selection, store the mask, keep the selection as a channel.\n' +
          '\n' +
          'Use when: you want to reuse a selection later — load it back with photoshop_load_channel_as_selection.\n' +
          '\n' +
          'Returns: { ok, summary, undo_history_states_consumed, details: { channel_name } }.\n' +
          '\n' +
          'Preconditions: active document with an active selection. Side effects: adds an alpha channel (replaces one of the same name).',
        inputSchema: {
          type: 'object',
          properties: {
            channel_name: {
              type: 'string',
              description:
                'Name for the alpha channel (default "Alpha 1"). An existing channel of the same name is replaced.',
              default: 'Alpha 1',
            },
          },
        },
      },
      handler: async (args) => saveSelectionAsChannel(transport, args),
    },
    {
      tool: {
        name: 'photoshop_load_channel_as_selection',
        description:
          'Load a named alpha channel back as the active pixel selection (Select > Load Selection). Wrapped in a single undoable step.\n' +
          '\n' +
          'Users often say: load the saved selection, restore the mask, reselect from channel.\n' +
          '\n' +
          'Use when: a selection was previously saved with photoshop_save_selection_as_channel.\n' +
          '\n' +
          'Returns: { ok, summary, undo_history_states_consumed, details: { channel_name, invert, selected } }.\n' +
          '\n' +
          'Preconditions: active document containing the named alpha channel. Side effects: replaces the current selection.',
        inputSchema: {
          type: 'object',
          properties: {
            channel_name: {
              type: 'string',
              description: 'Name of the alpha channel to load (default "Alpha 1").',
              default: 'Alpha 1',
            },
            invert: {
              type: 'boolean',
              description: 'Invert the loaded selection (default false).',
              default: false,
            },
          },
        },
      },
      handler: async (args) => loadChannelAsSelection(transport, args),
    },
    {
      tool: {
        name: 'photoshop_make_work_path_from_selection',
        description:
          'Convert the active pixel selection into a vector Work Path (Selection > Make Work Path). Wrapped in a single undoable step.\n' +
          '\n' +
          'Users often say: turn the selection into a path, make a work path, vectorize the selection.\n' +
          '\n' +
          'Use when: you need a path for a vector mask, stroke, or export from an existing selection.\n' +
          'Do NOT use when: there is no selection — create one first.\n' +
          '\n' +
          'Returns: { ok, summary, undo_history_states_consumed, details: { tolerance, path_name } }.\n' +
          '\n' +
          'Preconditions: active document with an active selection. Side effects: creates/replaces the Work Path.',
        inputSchema: {
          type: 'object',
          properties: {
            tolerance: {
              type: 'number',
              description:
                'Path fit tolerance in pixels (0.5-10, lower = tighter/more points). Default 2.',
              minimum: 0.5,
              maximum: 10,
              default: 2,
            },
          },
        },
      },
      handler: async (args) => makeWorkPathFromSelection(transport, args),
    },
    {
      tool: {
        name: 'photoshop_create_clipping_mask',
        description:
          'Clip the active layer to the layer directly below it (Layer > Create Clipping Mask). Wrapped in a single undoable step.\n' +
          '\n' +
          'Users often say: clip this layer, clip to the layer below, use as clipping mask.\n' +
          '\n' +
          'Use when: you want the active layer to show only where the layer below has pixels (e.g. texture/adjustment clipped to a shape).\n' +
          'Do NOT use when: the active layer is the bottom layer or a Background — there is nothing below to clip to.\n' +
          '\n' +
          'Returns: { ok, summary, undo_history_states_consumed, details: { layer_name, clipped } }.\n' +
          '\n' +
          'Preconditions: active document with an active layer that has a layer below it. Side effects: sets the layer grouping (clipping) flag.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      handler: async () => createClippingMask(transport),
    },
  ];
}

async function selectColorRange(
  transport: TransportRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const presetKey = typeof args.preset === 'string' ? args.preset : undefined;
  const presetEnum = presetKey ? COLOR_RANGE_PRESETS[presetKey] : undefined;
  const fuzziness = clampInt(args.fuzziness, 0, 200, 40);

  const colorArg = args.color as Record<string, unknown> | undefined;
  const hasColor =
    !presetEnum &&
    colorArg &&
    typeof colorArg.r === 'number' &&
    typeof colorArg.g === 'number' &&
    typeof colorArg.b === 'number';

  if (!presetEnum && !hasColor) {
    // Fail fast in TS so we do not enter Photoshop just to bounce back out.
    return executeRecipe(
      transport,
      'Color Range',
      `return { ok: false, code: 'invalid_params', message: 'Provide either a preset (${COLOR_RANGE_PRESET_NAMES.join('/')}) or a color {r,g,b}.', suggested_next_tool: 'photoshop_get_state' };`
    );
  }

  const r = hasColor ? clampInt(colorArg!.r, 0, 255, 128) : 0;
  const g = hasColor ? clampInt(colorArg!.g, 0, 255, 128) : 0;
  const b = hasColor ? clampInt(colorArg!.b, 0, 255, 128) : 0;

  const body = `
    var doc = app.activeDocument;
    app.displayDialogs = DialogModes.NO;

    var desc = new ActionDescriptor();
    desc.putInteger(sTID('fuzziness'), ${fuzziness});
    ${
      presetEnum
        ? `desc.putEnumerated(sTID('colors'), sTID('colors'), sTID('${presetEnum}'));`
        : `var __mcp_color = new ActionDescriptor();
    __mcp_color.putDouble(sTID('red'), ${r});
    __mcp_color.putDouble(sTID('grain'), ${g});
    __mcp_color.putDouble(sTID('blue'), ${b});
    desc.putObject(sTID('minimum'), sTID('RGBColor'), __mcp_color);`
    }
    executeAction(sTID('colorRange'), desc, DialogModes.NO);

    var selected = false;
    try { selected = !!(doc.selection.bounds); } catch (e) { selected = false; }

    return {
      ok: true,
      summary: ${presetEnum ? `'Color Range selected preset ${presetKey || ''}'` : `'Color Range selected sampled color'`},
      undo_history_states_consumed: 1,
      next_suggested_tool: 'photoshop_get_preview',
      details: {
        mode: ${presetEnum ? "'preset'" : "'color'"},
        ${presetEnum ? `preset: '${presetKey || ''}',` : `color: { r: ${r}, g: ${g}, b: ${b} },`}
        fuzziness: ${fuzziness},
        selected: selected
      }
    };
  `;

  return executeRecipe(transport, 'Color Range', body);
}

async function refineSelection(
  transport: TransportRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const operation = REFINE_OPS.includes(args.operation as RefineOp)
    ? (args.operation as RefineOp)
    : undefined;

  if (!operation) {
    return executeRecipe(
      transport,
      'Refine Selection',
      `return { ok: false, code: 'invalid_params', message: 'operation must be one of ${REFINE_OPS.join('/')}.', suggested_next_tool: 'photoshop_get_state' };`
    );
  }

  const radius = clampInt(args.radius, 1, 500, 2);

  // DOM Selection methods cover expand/contract/feather/smooth; border needs AM.
  const domCall: Record<Exclude<RefineOp, 'border'>, string> = {
    expand: `doc.selection.expand(${radius});`,
    contract: `doc.selection.contract(${radius});`,
    feather: `doc.selection.feather(${radius});`,
    smooth: `doc.selection.smooth(${radius});`,
  };

  const opBody =
    operation === 'border'
      ? `var __mcp_borderDesc = new ActionDescriptor();
    __mcp_borderDesc.putUnitDouble(sTID('width'), sTID('pixelsUnit'), ${radius});
    executeAction(sTID('border'), __mcp_borderDesc, DialogModes.NO);`
      : domCall[operation];

  const body = `
    var doc = app.activeDocument;
    var hasSel = false;
    try { hasSel = !!(doc.selection.bounds); } catch (e) { hasSel = false; }
    if (!hasSel) {
      return { ok: false, code: 'selection_required', message: 'No active selection to refine.', suggested_next_tool: 'photoshop_select_subject' };
    }

    app.displayDialogs = DialogModes.NO;
    ${opBody}

    var stillSelected = false;
    try { stillSelected = !!(doc.selection.bounds); } catch (e) { stillSelected = false; }

    return {
      ok: true,
      summary: 'Selection ${operation} by ${radius}px',
      undo_history_states_consumed: 1,
      next_suggested_tool: 'photoshop_get_preview',
      details: {
        operation: '${operation}',
        radius: ${radius},
        selected: stillSelected
      }
    };
  `;

  return executeRecipe(transport, 'Refine Selection', body);
}

async function saveSelectionAsChannel(
  transport: TransportRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const channelName =
    typeof args.channel_name === 'string' && args.channel_name.trim().length > 0
      ? args.channel_name.trim()
      : 'Alpha 1';

  const body = `
    var doc = app.activeDocument;
    var hasSel = false;
    try { hasSel = !!(doc.selection.bounds); } catch (e) { hasSel = false; }
    if (!hasSel) {
      return { ok: false, code: 'selection_required', message: 'No active selection to save.', suggested_next_tool: 'photoshop_select_subject' };
    }

    var name = "${jsString(channelName)}";

    // Replace an existing alpha channel of the same name so re-saving is idempotent.
    for (var i = doc.channels.length - 1; i >= 0; i--) {
      var ch = doc.channels[i];
      if (ch.name === name && ch.kind === ChannelType.MASKEDAREA) {
        try { ch.remove(); } catch (eRem) {}
      } else if (ch.name === name && ch.kind === ChannelType.SELECTEDAREA) {
        try { ch.remove(); } catch (eRem2) {}
      }
    }

    var alpha = doc.channels.add();
    alpha.name = name;
    doc.selection.store(alpha, SelectionType.REPLACE);

    return {
      ok: true,
      summary: 'Selection saved to channel "' + name + '"',
      undo_history_states_consumed: 1,
      next_suggested_tool: 'photoshop_load_channel_as_selection',
      details: {
        channel_name: name
      }
    };
  `;

  return executeRecipe(transport, 'Save Selection', body);
}

async function loadChannelAsSelection(
  transport: TransportRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const channelName =
    typeof args.channel_name === 'string' && args.channel_name.trim().length > 0
      ? args.channel_name.trim()
      : 'Alpha 1';
  const invert = args.invert === true;

  const body = `
    var doc = app.activeDocument;
    var name = "${jsString(channelName)}";

    // Only match saved-selection alpha channels — never a component (RGB) or
    // spot channel, which cannot be loaded as a selection and would throw.
    var alpha = null;
    for (var i = 0; i < doc.channels.length; i++) {
      var candidate = doc.channels[i];
      if (candidate.name !== name) continue;
      if (candidate.kind === ChannelType.MASKEDAREA || candidate.kind === ChannelType.SELECTEDAREA) {
        alpha = candidate;
        break;
      }
    }
    if (!alpha) {
      return { ok: false, code: 'channel_not_found', message: 'Alpha channel "' + name + '" not found.', suggested_next_tool: 'photoshop_get_state' };
    }

    doc.selection.load(alpha, SelectionType.REPLACE, ${invert ? 'true' : 'false'});

    var selected = false;
    try { selected = !!(doc.selection.bounds); } catch (e) { selected = false; }

    return {
      ok: true,
      summary: 'Channel "' + name + '" loaded as selection',
      undo_history_states_consumed: 1,
      next_suggested_tool: 'photoshop_get_preview',
      details: {
        channel_name: name,
        invert: ${invert ? 'true' : 'false'},
        selected: selected
      }
    };
  `;

  return executeRecipe(transport, 'Load Selection', body);
}

async function makeWorkPathFromSelection(
  transport: TransportRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const toleranceRaw =
    typeof args.tolerance === 'number' && Number.isFinite(args.tolerance) ? args.tolerance : 2;
  const tolerance = Math.min(10, Math.max(0.5, toleranceRaw));

  const body = `
    var doc = app.activeDocument;
    var hasSel = false;
    try { hasSel = !!(doc.selection.bounds); } catch (e) { hasSel = false; }
    if (!hasSel) {
      return { ok: false, code: 'selection_required', message: 'No active selection to convert to a path.', suggested_next_tool: 'photoshop_select_subject' };
    }

    app.displayDialogs = DialogModes.NO;
    doc.selection.makeWorkPath(${tolerance});

    var pathName = 'Work Path';
    try {
      if (doc.pathItems.length > 0) {
        pathName = doc.pathItems[doc.pathItems.length - 1].name;
      }
    } catch (eName) {}

    return {
      ok: true,
      summary: 'Work Path created from selection',
      undo_history_states_consumed: 1,
      next_suggested_tool: 'photoshop_get_state',
      details: {
        tolerance: ${tolerance},
        path_name: pathName
      }
    };
  `;

  return executeRecipe(transport, 'Make Work Path', body);
}

async function createClippingMask(transport: TransportRouter): Promise<ToolResult> {
  const body = `
    var doc = app.activeDocument;
    var layer = doc.activeLayer;
    if (!layer) {
      return { ok: false, code: 'no_active_layer', message: 'No active layer to clip.', suggested_next_tool: 'photoshop_get_layers' };
    }
    if (layer.isBackgroundLayer) {
      return { ok: false, code: 'invalid_target', message: 'Background layer cannot be clipped.', suggested_next_tool: 'photoshop_get_layers' };
    }

    // Clipping needs a sibling directly below in the same container. The
    // bottommost item has itemIndex === parent.layers.length (itemIndex is
    // 1-based within its parent, doc or LayerSet). Guard so we return
    // invalid_target instead of letting groupEvent throw. If the position
    // read fails on some build, fall through and let the action attempt run.
    try {
      var parent = layer.parent;
      if (parent && parent.layers && layer.itemIndex >= parent.layers.length) {
        return { ok: false, code: 'invalid_target', message: 'No layer below to clip to — the active layer is the bottom of its group.', suggested_next_tool: 'photoshop_get_layers' };
      }
    } catch (ePos) {}

    app.displayDialogs = DialogModes.NO;
    var desc = new ActionDescriptor();
    var ref = new ActionReference();
    ref.putEnumerated(sTID('layer'), sTID('ordinal'), sTID('targetEnum'));
    desc.putReference(sTID('null'), ref);
    executeAction(sTID('groupEvent'), desc, DialogModes.NO);

    return {
      ok: true,
      summary: 'Layer "' + layer.name + '" clipped to the layer below',
      undo_history_states_consumed: 1,
      next_suggested_tool: 'photoshop_get_preview',
      details: {
        layer_name: layer.name,
        clipped: true
      }
    };
  `;

  return executeRecipe(transport, 'Create Clipping Mask', body);
}
