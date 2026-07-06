import type { ToolDefinition, ToolResult } from '../core/tool-registry.js';
import type { TransportRouter } from '../transport/index.js';
import { MCP_ADJUSTMENT_LAYER_HELPERS } from '../api/extendscript.js';
import { clampInt, executeRecipe } from './recipes/_shared.js';

/**
 * Dedicated, parameterized NON-DESTRUCTIVE adjustment-layer tools (Tier-1 roadmap
 * items #2 and #3: the "creative color" cluster + real Curves/Levels with points).
 *
 * Each tool ADDS A NEW ADJUSTMENT LAYER above the active layer via the "Make
 * adjustmentLayer" Action Manager pattern (executeAction 'make'), so the original
 * pixels are never touched. This is the richer counterpart to the DESTRUCTIVE
 * adjust_* tools in adjustment-tools.ts.
 *
 * ONE UNDO: every tool creates exactly one adjustment layer inside a single
 * suspendHistory scope (via executeRecipe), so one undo reverts the whole thing.
 *
 * ENVELOPE: all tools return the shared { ok, summary, details } recipe envelope.
 *
 * RGB: the color-oriented adjustments (curves/levels/gradient map/selective color/
 * photo filter/color balance/black & white) require an RGB document and throw a
 * clear error otherwise. Vibrance also assumes RGB.
 */

const CURVES_CHANNELS = ['composite', 'red', 'green', 'blue'] as const;
const LEVELS_CHANNELS = ['composite', 'red', 'green', 'blue'] as const;
const SELECTIVE_COLOR_TARGETS = [
  'reds',
  'yellows',
  'greens',
  'cyans',
  'blues',
  'magentas',
  'whites',
  'neutrals',
  'blacks',
] as const;

/** Named photo-filter presets → warming/cooling RGB (matches Photoshop's built-ins). */
const PHOTO_FILTER_NAMED: Record<string, { r: number; g: number; b: number }> = {
  warm: { r: 236, g: 138, b: 0 }, // Warming Filter (85)
  cool: { r: 0, g: 109, b: 255 }, // Cooling Filter (80)
};

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/** Prepend the adjustment-layer helper block, then run through the shared recipe executor. */
function executeAdjustmentLayer(
  transport: TransportRouter,
  historyName: string,
  body: string
): Promise<ToolResult> {
  return executeRecipe(transport, historyName, `${MCP_ADJUSTMENT_LAYER_HELPERS}\n${body}`);
}

export function createAdjustmentLayerTools(transport: TransportRouter): ToolDefinition[] {
  return [
    bindCurves(transport),
    bindLevels(transport),
    bindGradientMap(transport),
    bindSelectiveColor(transport),
    bindPhotoFilter(transport),
    bindColorBalance(transport),
    bindVibrance(transport),
    bindBlackWhite(transport),
  ];
}

export const PHOTOSHOP_ADJUSTMENT_LAYER_TOOL_NAMES = [
  'photoshop_apply_curves',
  'photoshop_apply_levels',
  'photoshop_add_gradient_map',
  'photoshop_add_selective_color',
  'photoshop_add_photo_filter',
  'photoshop_add_color_balance',
  'photoshop_add_vibrance',
  'photoshop_add_black_white',
] as const;

// ---------------------------------------------------------------------------
// Curves (arbitrary points per channel)
// ---------------------------------------------------------------------------

function bindCurves(transport: TransportRouter): ToolDefinition {
  return {
    tool: {
      name: 'photoshop_apply_curves',
      description:
        'Add a Curves ADJUSTMENT LAYER (non-destructive) above the active layer, with ARBITRARY points on one channel.\n\n' +
        'Users often say: S-curve, lift the shadows, crush the blacks, boost contrast, tone curve, fade the film look.\n\n' +
        'Unlike photoshop_adjust_curves (presets only), this takes real points. Each point is { input: 0-255, output: 0-255 }; ' +
        'points are auto-sorted by input and de-duplicated. Provide at least 2 points (endpoints default to (0,0) and (255,255) if omitted). ' +
        'channel = composite (RGB luminance) or a single red/green/blue channel for color grading (e.g. lift blue in shadows).\n\n' +
        'Adds a NEW layer above the active one; the underlying pixels are untouched. One undo removes it. Requires an RGB document.\n\n' +
        'Returns: { ok, summary, details: { layer_name, channel, points } }.',
      inputSchema: {
        type: 'object',
        properties: {
          channel: {
            type: 'string',
            enum: CURVES_CHANNELS as unknown as string[],
            description: 'Channel to shape (default composite)',
            default: 'composite',
          },
          points: {
            type: 'array',
            description:
              'Curve points, each { input: 0-255, output: 0-255 }. Auto-sorted by input. ' +
              'If omitted or fewer than 2, endpoints (0,0)/(255,255) are used.',
            items: {
              type: 'object',
              properties: {
                input: { type: 'number', minimum: 0, maximum: 255, description: 'Input level 0-255' },
                output: { type: 'number', minimum: 0, maximum: 255, description: 'Output level 0-255' },
              },
              required: ['input', 'output'],
            },
          },
        },
      },
    },
    handler: async (args) => {
      const channel = oneOf(args.channel, CURVES_CHANNELS, 'composite');
      const points = normalizeCurvePoints(args.points);
      const pointsLiteral = points.map((p) => `{ input: ${p.input}, output: ${p.output} }`).join(', ');
      const body = `
        __mcp_assertRgbForAdjustment();
        var __points = [${pointsLiteral}];
        var __layerName = __mcp_makeCurvesPointsLayer('${channel}', __points);
        return {
          ok: true,
          summary: 'Curves adjustment layer (${channel}, ' + __points.length + ' points) added above ' + __layerName,
          undo_history_states_consumed: 1,
          next_suggested_tool: 'photoshop_get_preview',
          details: {
            layer_name: __layerName,
            channel: '${channel}',
            points: __points
          }
        };
      `;
      return executeAdjustmentLayer(transport, 'Add Curves Adjustment', body);
    },
  };
}

/** Sort by input, clamp to 0-255 ints, dedupe identical inputs, ensure >=2 points. */
function normalizeCurvePoints(raw: unknown): Array<{ input: number; output: number }> {
  const parsed: Array<{ input: number; output: number }> = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (item && typeof item === 'object') {
        const rec = item as Record<string, unknown>;
        if (typeof rec.input === 'number' && typeof rec.output === 'number') {
          parsed.push({
            input: clampInt(rec.input, 0, 255, 0),
            output: clampInt(rec.output, 0, 255, 0),
          });
        }
      }
    }
  }
  parsed.sort((a, b) => a.input - b.input);
  // Drop duplicate inputs (keep the last one specified for that input).
  const deduped: Array<{ input: number; output: number }> = [];
  for (const p of parsed) {
    if (deduped.length > 0 && deduped[deduped.length - 1].input === p.input) {
      deduped[deduped.length - 1] = p;
    } else {
      deduped.push(p);
    }
  }
  if (deduped.length >= 2) return deduped;
  // Fall back to an identity curve if the caller gave too few usable points.
  if (deduped.length === 1) {
    const only = deduped[0];
    if (only.input === 0) return [only, { input: 255, output: 255 }];
    if (only.input === 255) return [{ input: 0, output: 0 }, only];
    return [{ input: 0, output: 0 }, only, { input: 255, output: 255 }];
  }
  return [
    { input: 0, output: 0 },
    { input: 255, output: 255 },
  ];
}

// ---------------------------------------------------------------------------
// Levels
// ---------------------------------------------------------------------------

function bindLevels(transport: TransportRouter): ToolDefinition {
  return {
    tool: {
      name: 'photoshop_apply_levels',
      description:
        'Add a Levels ADJUSTMENT LAYER (non-destructive) above the active layer.\n\n' +
        'Users often say: set the black point, set the white point, brighten midtones, fix flat/washed-out contrast, expand the histogram.\n\n' +
        'Input black/white (0-255) clip the shadows/highlights; gamma (0.1-9.99, 1.0 = neutral, >1 brightens midtones) reshapes midtones; ' +
        'output black/white (0-255) compress the result into a tonal range (e.g. fade to milky blacks). ' +
        'channel = composite or a single red/green/blue for a color cast fix.\n\n' +
        'Adds a NEW layer above the active one; pixels are untouched. One undo removes it. Requires an RGB document.\n\n' +
        'Returns: { ok, summary, details: { layer_name, channel, input_black, input_white, gamma, output_black, output_white } }.',
      inputSchema: {
        type: 'object',
        properties: {
          channel: {
            type: 'string',
            enum: LEVELS_CHANNELS as unknown as string[],
            description: 'Channel to adjust (default composite)',
            default: 'composite',
          },
          inputBlack: { type: 'number', minimum: 0, maximum: 253, description: 'Input black point 0-253 (default 0)', default: 0 },
          inputWhite: { type: 'number', minimum: 2, maximum: 255, description: 'Input white point 2-255 (default 255)', default: 255 },
          gamma: { type: 'number', minimum: 0.1, maximum: 9.99, description: 'Midtone gamma 0.1-9.99, 1.0 = neutral (default 1.0)', default: 1.0 },
          outputBlack: { type: 'number', minimum: 0, maximum: 255, description: 'Output black point 0-255 (default 0)', default: 0 },
          outputWhite: { type: 'number', minimum: 0, maximum: 255, description: 'Output white point 0-255 (default 255)', default: 255 },
        },
      },
    },
    handler: async (args) => {
      const channel = oneOf(args.channel, LEVELS_CHANNELS, 'composite');
      let inputBlack = clampInt(args.inputBlack, 0, 253, 0);
      let inputWhite = clampInt(args.inputWhite, 2, 255, 255);
      if (inputWhite <= inputBlack) {
        // Keep a valid histogram window (white must stay above black).
        inputWhite = Math.min(255, inputBlack + 1);
      }
      const gammaRaw = typeof args.gamma === 'number' && Number.isFinite(args.gamma) ? args.gamma : 1.0;
      const gamma = Math.max(0.1, Math.min(9.99, Math.round(gammaRaw * 100) / 100));
      const outputBlack = clampInt(args.outputBlack, 0, 255, 0);
      const outputWhite = clampInt(args.outputWhite, 0, 255, 255);
      const body = `
        __mcp_assertRgbForAdjustment();
        var __layerName = __mcp_makeLevelsLayer('${channel}', ${inputBlack}, ${inputWhite}, ${gamma}, ${outputBlack}, ${outputWhite});
        return {
          ok: true,
          summary: 'Levels adjustment layer (${channel}) added above ' + __layerName,
          undo_history_states_consumed: 1,
          next_suggested_tool: 'photoshop_get_preview',
          details: {
            layer_name: __layerName,
            channel: '${channel}',
            input_black: ${inputBlack}, input_white: ${inputWhite}, gamma: ${gamma},
            output_black: ${outputBlack}, output_white: ${outputWhite}
          }
        };
      `;
      return executeAdjustmentLayer(transport, 'Add Levels Adjustment', body);
    },
  };
}

// ---------------------------------------------------------------------------
// Gradient Map
// ---------------------------------------------------------------------------

function bindGradientMap(transport: TransportRouter): ToolDefinition {
  return {
    tool: {
      name: 'photoshop_add_gradient_map',
      description:
        'Add a Gradient Map ADJUSTMENT LAYER (non-destructive) above the active layer.\n\n' +
        'Users often say: duotone, cinematic teal-and-orange, map shadows to one color and highlights to another, ' +
        'moody color grade, split-tone.\n\n' +
        'Maps image luminance from a START color (shadows) to an END color (highlights). Defaults to black->white (a neutral ' +
        'contrast map). Supply startRed/Green/Blue and endRed/Green/Blue for a duotone. reverse flips the mapping.\n\n' +
        'Adds a NEW layer above the active one; pixels are untouched. One undo removes it. Requires an RGB document. ' +
        'Tip: pair with a lowered layer opacity or a SOFTLIGHT blend for a subtler grade.\n\n' +
        'Returns: { ok, summary, details: { layer_name, start_color, end_color, reverse, dither } }.',
      inputSchema: {
        type: 'object',
        properties: {
          startRed: { type: 'number', minimum: 0, maximum: 255, default: 0, description: 'Shadow color red (default 0)' },
          startGreen: { type: 'number', minimum: 0, maximum: 255, default: 0, description: 'Shadow color green (default 0)' },
          startBlue: { type: 'number', minimum: 0, maximum: 255, default: 0, description: 'Shadow color blue (default 0)' },
          endRed: { type: 'number', minimum: 0, maximum: 255, default: 255, description: 'Highlight color red (default 255)' },
          endGreen: { type: 'number', minimum: 0, maximum: 255, default: 255, description: 'Highlight color green (default 255)' },
          endBlue: { type: 'number', minimum: 0, maximum: 255, default: 255, description: 'Highlight color blue (default 255)' },
          reverse: { type: 'boolean', description: 'Reverse the gradient (swap shadow/highlight mapping). Default false.', default: false },
          dither: { type: 'boolean', description: 'Dither the gradient to reduce banding. Default true.', default: true },
        },
      },
    },
    handler: async (args) => {
      const start = {
        r: clampInt(args.startRed, 0, 255, 0),
        g: clampInt(args.startGreen, 0, 255, 0),
        b: clampInt(args.startBlue, 0, 255, 0),
      };
      const end = {
        r: clampInt(args.endRed, 0, 255, 255),
        g: clampInt(args.endGreen, 0, 255, 255),
        b: clampInt(args.endBlue, 0, 255, 255),
      };
      const reverse = args.reverse === true;
      const dither = args.dither !== false;
      const body = `
        __mcp_assertRgbForAdjustment();
        var __layerName = __mcp_makeGradientMapLayer(${start.r}, ${start.g}, ${start.b}, ${end.r}, ${end.g}, ${end.b}, ${reverse}, ${dither});
        return {
          ok: true,
          summary: 'Gradient map adjustment layer added above ' + __layerName,
          undo_history_states_consumed: 1,
          next_suggested_tool: 'photoshop_get_preview',
          details: {
            layer_name: __layerName,
            start_color: { red: ${start.r}, green: ${start.g}, blue: ${start.b} },
            end_color: { red: ${end.r}, green: ${end.g}, blue: ${end.b} },
            reverse: ${reverse}, dither: ${dither}
          }
        };
      `;
      return executeAdjustmentLayer(transport, 'Add Gradient Map', body);
    },
  };
}

// ---------------------------------------------------------------------------
// Selective Color
// ---------------------------------------------------------------------------

function bindSelectiveColor(transport: TransportRouter): ToolDefinition {
  return {
    tool: {
      name: 'photoshop_add_selective_color',
      description:
        'Add a Selective Color ADJUSTMENT LAYER (non-destructive) above the active layer, targeting ONE color band.\n\n' +
        'Users often say: make the reds warmer, take the green out of the skin, deepen the blue sky, tweak just the yellows.\n\n' +
        'Pick a target color band, then shift its CMYK mix: cyan/magenta/yellow/black each -100..100. ' +
        'relative=true scales existing ink (subtler); relative=false (absolute) adds a fixed amount (stronger). ' +
        'To adjust several bands, call this tool once per band (each adds its own layer, or stack them).\n\n' +
        'Adds a NEW layer above the active one; pixels are untouched. One undo removes it. Requires an RGB document.\n\n' +
        'Returns: { ok, summary, details: { layer_name, target, cyan, magenta, yellow, black, relative } }.',
      inputSchema: {
        type: 'object',
        properties: {
          target: {
            type: 'string',
            enum: SELECTIVE_COLOR_TARGETS as unknown as string[],
            description: 'Color band to adjust (reds/yellows/greens/cyans/blues/magentas/whites/neutrals/blacks)',
          },
          cyan: { type: 'number', minimum: -100, maximum: 100, default: 0, description: 'Cyan shift -100..100 (default 0)' },
          magenta: { type: 'number', minimum: -100, maximum: 100, default: 0, description: 'Magenta shift -100..100 (default 0)' },
          yellow: { type: 'number', minimum: -100, maximum: 100, default: 0, description: 'Yellow shift -100..100 (default 0)' },
          black: { type: 'number', minimum: -100, maximum: 100, default: 0, description: 'Black shift -100..100 (default 0)' },
          relative: { type: 'boolean', description: 'Relative method (true, subtler) vs absolute (false). Default true.', default: true },
        },
        required: ['target'],
      },
    },
    handler: async (args) => {
      const target = oneOf(args.target, SELECTIVE_COLOR_TARGETS, 'reds');
      const cyan = clampInt(args.cyan, -100, 100, 0);
      const magenta = clampInt(args.magenta, -100, 100, 0);
      const yellow = clampInt(args.yellow, -100, 100, 0);
      const black = clampInt(args.black, -100, 100, 0);
      const relative = args.relative !== false;
      const body = `
        __mcp_assertRgbForAdjustment();
        var __layerName = __mcp_makeSelectiveColorLayer('${target}', ${cyan}, ${magenta}, ${yellow}, ${black}, ${relative});
        return {
          ok: true,
          summary: 'Selective color adjustment layer (${target}) added above ' + __layerName,
          undo_history_states_consumed: 1,
          next_suggested_tool: 'photoshop_get_preview',
          details: {
            layer_name: __layerName,
            target: '${target}',
            cyan: ${cyan}, magenta: ${magenta}, yellow: ${yellow}, black: ${black},
            relative: ${relative}
          }
        };
      `;
      return executeAdjustmentLayer(transport, 'Add Selective Color', body);
    },
  };
}

// ---------------------------------------------------------------------------
// Photo Filter
// ---------------------------------------------------------------------------

function bindPhotoFilter(transport: TransportRouter): ToolDefinition {
  return {
    tool: {
      name: 'photoshop_add_photo_filter',
      description:
        'Add a Photo Filter ADJUSTMENT LAYER (non-destructive) above the active layer — a colored filter over the image ' +
        '(like a warming/cooling lens filter).\n\n' +
        'Users often say: warm it up, cool it down, add a warming filter, golden-hour tint, correct the white balance.\n\n' +
        'Either name a preset (filterColor = "warm" or "cool") OR give a custom filterRed/Green/Blue. density (0-100) sets the ' +
        'strength. preserveLuminosity (default true) keeps overall brightness constant so only color shifts.\n\n' +
        'Adds a NEW layer above the active one; pixels are untouched. One undo removes it. Requires an RGB document.\n\n' +
        'Returns: { ok, summary, details: { layer_name, color, density, preserve_luminosity, source } }.',
      inputSchema: {
        type: 'object',
        properties: {
          filterColor: {
            type: 'string',
            enum: ['warm', 'cool'],
            description: 'Named preset: warm (Warming 85) or cool (Cooling 80). Ignored if filterRed/Green/Blue given.',
          },
          filterRed: { type: 'number', minimum: 0, maximum: 255, description: 'Custom filter color red (overrides filterColor)' },
          filterGreen: { type: 'number', minimum: 0, maximum: 255, description: 'Custom filter color green (overrides filterColor)' },
          filterBlue: { type: 'number', minimum: 0, maximum: 255, description: 'Custom filter color blue (overrides filterColor)' },
          density: { type: 'number', minimum: 0, maximum: 100, default: 25, description: 'Filter strength 0-100 (default 25)' },
          preserveLuminosity: { type: 'boolean', description: 'Keep overall brightness constant. Default true.', default: true },
        },
      },
    },
    handler: async (args) => {
      const hasCustom =
        typeof args.filterRed === 'number' ||
        typeof args.filterGreen === 'number' ||
        typeof args.filterBlue === 'number';
      let color: { r: number; g: number; b: number };
      let source: string;
      if (hasCustom) {
        color = {
          r: clampInt(args.filterRed, 0, 255, 236),
          g: clampInt(args.filterGreen, 0, 255, 138),
          b: clampInt(args.filterBlue, 0, 255, 0),
        };
        source = 'custom';
      } else {
        const named = oneOf(args.filterColor, ['warm', 'cool'] as const, 'warm');
        const preset = PHOTO_FILTER_NAMED[named];
        color = { r: preset.r, g: preset.g, b: preset.b };
        source = named;
      }
      const density = clampInt(args.density, 0, 100, 25);
      const preserveLuminosity = args.preserveLuminosity !== false;
      const body = `
        __mcp_assertRgbForAdjustment();
        var __layerName = __mcp_makePhotoFilterLayer(true, ${color.r}, ${color.g}, ${color.b}, ${density}, ${preserveLuminosity});
        return {
          ok: true,
          summary: 'Photo filter adjustment layer (${source}) added above ' + __layerName,
          undo_history_states_consumed: 1,
          next_suggested_tool: 'photoshop_get_preview',
          details: {
            layer_name: __layerName,
            color: { red: ${color.r}, green: ${color.g}, blue: ${color.b} },
            density: ${density}, preserve_luminosity: ${preserveLuminosity}, source: '${source}'
          }
        };
      `;
      return executeAdjustmentLayer(transport, 'Add Photo Filter', body);
    },
  };
}

// ---------------------------------------------------------------------------
// Color Balance
// ---------------------------------------------------------------------------

function bindColorBalance(transport: TransportRouter): ToolDefinition {
  return {
    tool: {
      name: 'photoshop_add_color_balance',
      description:
        'Add a Color Balance ADJUSTMENT LAYER (non-destructive) above the active layer, shifting shadows/midtones/highlights ' +
        'independently along three color axes.\n\n' +
        'Users often say: warm the highlights, push the shadows blue, teal shadows and warm skin, color-grade by tonal range.\n\n' +
        'Each tonal range (shadows, midtones, highlights) has three sliders, all -100..100:\n' +
        '  - cyanRed: negative = cyan, positive = red\n' +
        '  - magentaGreen: negative = magenta, positive = green\n' +
        '  - yellowBlue: negative = yellow, positive = blue\n' +
        'preserveLuminosity (default true) keeps brightness steady.\n\n' +
        'Adds a NEW layer above the active one; pixels are untouched. One undo removes it. Requires an RGB document.\n\n' +
        'Returns: { ok, summary, details: { layer_name, shadows, midtones, highlights, preserve_luminosity } }.',
      inputSchema: {
        type: 'object',
        properties: {
          shadowsCyanRed: { type: 'number', minimum: -100, maximum: 100, default: 0, description: 'Shadows cyan(-)/red(+) (default 0)' },
          shadowsMagentaGreen: { type: 'number', minimum: -100, maximum: 100, default: 0, description: 'Shadows magenta(-)/green(+) (default 0)' },
          shadowsYellowBlue: { type: 'number', minimum: -100, maximum: 100, default: 0, description: 'Shadows yellow(-)/blue(+) (default 0)' },
          midtonesCyanRed: { type: 'number', minimum: -100, maximum: 100, default: 0, description: 'Midtones cyan(-)/red(+) (default 0)' },
          midtonesMagentaGreen: { type: 'number', minimum: -100, maximum: 100, default: 0, description: 'Midtones magenta(-)/green(+) (default 0)' },
          midtonesYellowBlue: { type: 'number', minimum: -100, maximum: 100, default: 0, description: 'Midtones yellow(-)/blue(+) (default 0)' },
          highlightsCyanRed: { type: 'number', minimum: -100, maximum: 100, default: 0, description: 'Highlights cyan(-)/red(+) (default 0)' },
          highlightsMagentaGreen: { type: 'number', minimum: -100, maximum: 100, default: 0, description: 'Highlights magenta(-)/green(+) (default 0)' },
          highlightsYellowBlue: { type: 'number', minimum: -100, maximum: 100, default: 0, description: 'Highlights yellow(-)/blue(+) (default 0)' },
          preserveLuminosity: { type: 'boolean', description: 'Keep overall brightness constant. Default true.', default: true },
        },
      },
    },
    handler: async (args) => {
      const shadows = [
        clampInt(args.shadowsCyanRed, -100, 100, 0),
        clampInt(args.shadowsMagentaGreen, -100, 100, 0),
        clampInt(args.shadowsYellowBlue, -100, 100, 0),
      ];
      const midtones = [
        clampInt(args.midtonesCyanRed, -100, 100, 0),
        clampInt(args.midtonesMagentaGreen, -100, 100, 0),
        clampInt(args.midtonesYellowBlue, -100, 100, 0),
      ];
      const highlights = [
        clampInt(args.highlightsCyanRed, -100, 100, 0),
        clampInt(args.highlightsMagentaGreen, -100, 100, 0),
        clampInt(args.highlightsYellowBlue, -100, 100, 0),
      ];
      const preserveLuminosity = args.preserveLuminosity !== false;
      const body = `
        __mcp_assertRgbForAdjustment();
        var __layerName = __mcp_makeColorBalanceLayer([${shadows.join(', ')}], [${midtones.join(', ')}], [${highlights.join(', ')}], ${preserveLuminosity});
        return {
          ok: true,
          summary: 'Color balance adjustment layer added above ' + __layerName,
          undo_history_states_consumed: 1,
          next_suggested_tool: 'photoshop_get_preview',
          details: {
            layer_name: __layerName,
            shadows: { cyan_red: ${shadows[0]}, magenta_green: ${shadows[1]}, yellow_blue: ${shadows[2]} },
            midtones: { cyan_red: ${midtones[0]}, magenta_green: ${midtones[1]}, yellow_blue: ${midtones[2]} },
            highlights: { cyan_red: ${highlights[0]}, magenta_green: ${highlights[1]}, yellow_blue: ${highlights[2]} },
            preserve_luminosity: ${preserveLuminosity}
          }
        };
      `;
      return executeAdjustmentLayer(transport, 'Add Color Balance', body);
    },
  };
}

// ---------------------------------------------------------------------------
// Vibrance
// ---------------------------------------------------------------------------

function bindVibrance(transport: TransportRouter): ToolDefinition {
  return {
    tool: {
      name: 'photoshop_add_vibrance',
      description:
        'Add a Vibrance ADJUSTMENT LAYER (non-destructive) above the active layer.\n\n' +
        'Users often say: make the colors pop, more vibrant, boost saturation gently, richer colors without oversaturating.\n\n' +
        'vibrance (-100..100) boosts less-saturated colors while protecting already-saturated ones and skin tones (the ' +
        'creator-friendly default). saturation (-100..100) is a uniform boost to every color. Both default to 0.\n\n' +
        'Adds a NEW layer above the active one; pixels are untouched. One undo removes it. Requires an RGB document.\n\n' +
        'Returns: { ok, summary, details: { layer_name, vibrance, saturation } }.',
      inputSchema: {
        type: 'object',
        properties: {
          vibrance: { type: 'number', minimum: -100, maximum: 100, default: 0, description: 'Vibrance -100..100 (default 0)' },
          saturation: { type: 'number', minimum: -100, maximum: 100, default: 0, description: 'Saturation -100..100 (default 0)' },
        },
      },
    },
    handler: async (args) => {
      const vibrance = clampInt(args.vibrance, -100, 100, 0);
      const saturation = clampInt(args.saturation, -100, 100, 0);
      const body = `
        __mcp_assertRgbForAdjustment();
        var __layerName = __mcp_makeVibranceLayer(${vibrance}, ${saturation});
        return {
          ok: true,
          summary: 'Vibrance adjustment layer added above ' + __layerName,
          undo_history_states_consumed: 1,
          next_suggested_tool: 'photoshop_get_preview',
          details: {
            layer_name: __layerName,
            vibrance: ${vibrance}, saturation: ${saturation}
          }
        };
      `;
      return executeAdjustmentLayer(transport, 'Add Vibrance', body);
    },
  };
}

// ---------------------------------------------------------------------------
// Black & White
// ---------------------------------------------------------------------------

function bindBlackWhite(transport: TransportRouter): ToolDefinition {
  return {
    tool: {
      name: 'photoshop_add_black_white',
      description:
        'Add a Black & White ADJUSTMENT LAYER (non-destructive) above the active layer — a controllable grayscale conversion ' +
        'with an optional color tint.\n\n' +
        'Users often say: convert to black and white, monochrome, make it grayscale but keep the reds bright, sepia tone.\n\n' +
        'Per-channel mix (reds/yellows/greens/cyans/blues/magentas, each -200..300) controls how bright each original color ' +
        'renders in gray; higher = lighter. Defaults are Photoshop\'s neutral preset. Optionally supply a tint (tintRed/Green/Blue) ' +
        'for a sepia/duotone look (tint is applied only when you pass a tint color).\n\n' +
        'Adds a NEW layer above the active one; pixels are untouched. One undo removes it. Requires an RGB document.\n\n' +
        'Returns: { ok, summary, details: { layer_name, colors, tint, tint_color } }.',
      inputSchema: {
        type: 'object',
        properties: {
          reds: { type: 'number', minimum: -200, maximum: 300, default: 40, description: 'Reds mix -200..300 (default 40)' },
          yellows: { type: 'number', minimum: -200, maximum: 300, default: 60, description: 'Yellows mix -200..300 (default 60)' },
          greens: { type: 'number', minimum: -200, maximum: 300, default: 40, description: 'Greens mix -200..300 (default 40)' },
          cyans: { type: 'number', minimum: -200, maximum: 300, default: 60, description: 'Cyans mix -200..300 (default 60)' },
          blues: { type: 'number', minimum: -200, maximum: 300, default: 20, description: 'Blues mix -200..300 (default 20)' },
          magentas: { type: 'number', minimum: -200, maximum: 300, default: 80, description: 'Magentas mix -200..300 (default 80)' },
          tintRed: { type: 'number', minimum: 0, maximum: 255, description: 'Tint color red (enables tint when any tint channel given)' },
          tintGreen: { type: 'number', minimum: 0, maximum: 255, description: 'Tint color green' },
          tintBlue: { type: 'number', minimum: 0, maximum: 255, description: 'Tint color blue' },
        },
      },
    },
    handler: async (args) => {
      const colors = {
        red: clampInt(args.reds, -200, 300, 40),
        yellow: clampInt(args.yellows, -200, 300, 60),
        green: clampInt(args.greens, -200, 300, 40),
        cyan: clampInt(args.cyans, -200, 300, 60),
        blue: clampInt(args.blues, -200, 300, 20),
        magenta: clampInt(args.magentas, -200, 300, 80),
      };
      const hasTint =
        typeof args.tintRed === 'number' ||
        typeof args.tintGreen === 'number' ||
        typeof args.tintBlue === 'number';
      const tint = {
        r: clampInt(args.tintRed, 0, 255, 225),
        g: clampInt(args.tintGreen, 0, 255, 211),
        b: clampInt(args.tintBlue, 0, 255, 179),
      };
      const body = `
        __mcp_assertRgbForAdjustment();
        var __colors = { red: ${colors.red}, yellow: ${colors.yellow}, green: ${colors.green}, cyan: ${colors.cyan}, blue: ${colors.blue}, magenta: ${colors.magenta} };
        var __layerName = __mcp_makeBlackWhiteLayer(__colors, ${hasTint}, ${tint.r}, ${tint.g}, ${tint.b});
        return {
          ok: true,
          summary: 'Black & white adjustment layer${''}' + (${hasTint} ? ' (tinted)' : '') + ' added above ' + __layerName,
          undo_history_states_consumed: 1,
          next_suggested_tool: 'photoshop_get_preview',
          details: {
            layer_name: __layerName,
            colors: __colors,
            tint: ${hasTint},
            tint_color: ${hasTint} ? { red: ${tint.r}, green: ${tint.g}, blue: ${tint.b} } : null
          }
        };
      `;
      return executeAdjustmentLayer(transport, 'Add Black & White', body);
    },
  };
}
