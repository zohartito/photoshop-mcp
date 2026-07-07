import type { ToolDefinition, ToolResult } from '../core/tool-registry.js';
import type { TransportRouter } from '../transport/index.js';
import { MCP_FILL_PAINT_HELPERS } from '../api/extendscript.js';
import { clampInt, executeRecipe } from './recipes/_shared.js';

/**
 * Tier-2 "fill / gradient / pattern / paint" tools.
 *
 * These are the atomic drawing primitives that were missing from the fork:
 *   - photoshop_apply_gradient       — draw a real gradient (linear/radial/angle/
 *                                       reflected/diamond) on the active layer, or as a
 *                                       non-destructive Gradient fill layer.
 *   - photoshop_apply_pattern_fill   — fill with a named/built-in pattern (fill layer or
 *                                       drawn onto the active pixel layer).
 *   - photoshop_add_solid_fill_layer — a Solid Color fill layer (non-destructive).
 *   - photoshop_stroke_selection     — stroke the current selection (the atomic behind
 *                                       graphic borders).
 *   - photoshop_fill_selection_with  — fill the current selection with foreground /
 *                                       background / a color / black / white / 50% gray.
 *
 * TRANSPORT: the router runs ExtendScript (not UXP). Descriptor key structure and enum
 * names are cribbed from the layer-style gradient-overlay descriptor
 * (src/api/extendscript.ts __mcp_buildGradientOverlay), the mask gradient-draw helper
 * (__mcp_gradientFillLayerMask), and the UXP batchPlay reference in ~/adb-mcp
 * (uxp/ps/commands/selection.js fillSelection). batchPlay JSON descriptors translate
 * 1:1 into these ActionDescriptor putX calls.
 *
 * ONE UNDO: every tool is wrapped in a single suspendHistory step via executeRecipe, so
 * one undo reverts the whole operation. details.undo_history_states_consumed is always 1.
 *
 * RGBColor QUIRK: the Action Manager RGBColor object uses the key `grain` for the GREEN
 * channel (not `green`). All color descriptors here go through __mcp_fpRgbColor which
 * applies the quirk, matching the layer-style / adjustment-layer helpers.
 */

const BLEND_MODES = [
  'NORMAL',
  'DISSOLVE',
  'DARKEN',
  'MULTIPLY',
  'COLORBURN',
  'LINEARBURN',
  'DARKERCOLOR',
  'LIGHTEN',
  'SCREEN',
  'COLORDODGE',
  'LINEARDODGE',
  'LIGHTERCOLOR',
  'OVERLAY',
  'SOFTLIGHT',
  'HARDLIGHT',
  'VIVIDLIGHT',
  'LINEARLIGHT',
  'PINLIGHT',
  'HARDMIX',
  'DIFFERENCE',
  'EXCLUSION',
  'SUBTRACT',
  'DIVIDE',
  'HUE',
  'SATURATION',
  'COLOR',
  'LUMINOSITY',
] as const;

const GRADIENT_TYPES = ['linear', 'radial', 'angle', 'reflected', 'diamond'] as const;
const STROKE_LOCATIONS = ['inside', 'center', 'outside'] as const;
const FILL_SOURCES = [
  'foreground',
  'background',
  'color',
  'black',
  'white',
  'gray',
  '50gray',
] as const;

type Rgb = { r: number; g: number; b: number };
type Stop = { r: number; g: number; b: number; location: number };

function blendMode(value: unknown, fallback: string): string {
  const upper = typeof value === 'string' ? value.toUpperCase() : '';
  return (BLEND_MODES as readonly string[]).includes(upper) ? upper : fallback;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const lower = typeof value === 'string' ? value.toLowerCase() : '';
  return (allowed as readonly string[]).includes(lower) ? (lower as T) : fallback;
}

function rgb(args: Record<string, unknown>, dr: number, dg: number, db: number): Rgb {
  return {
    r: clampInt(args.red, 0, 255, dr),
    g: clampInt(args.green, 0, 255, dg),
    b: clampInt(args.blue, 0, 255, db),
  };
}

/**
 * Normalize the gradient color stops. Accepts an explicit multi-stop `stops` array
 * (each { red, green, blue, location? } with location 0-100), otherwise falls back to
 * a two-stop start->end gradient built from startColor/endColor args. Always returns at
 * least two stops with locations spanning 0..100 (first forced to 0, last forced to 100).
 */
function gradientStops(args: Record<string, unknown>): Stop[] {
  const raw = Array.isArray(args.stops) ? (args.stops as Record<string, unknown>[]) : null;
  if (raw && raw.length >= 2) {
    const stops = raw.map((s, i) => ({
      r: clampInt(s.red, 0, 255, 0),
      g: clampInt(s.green, 0, 255, 0),
      b: clampInt(s.blue, 0, 255, 0),
      location: clampInt(s.location, 0, 100, Math.round((i / (raw.length - 1)) * 100)),
    }));
    stops.sort((a, b) => a.location - b.location);
    stops[0].location = 0;
    stops[stops.length - 1].location = 100;
    return stops;
  }
  const start: Stop = {
    r: clampInt(args.startRed, 0, 255, 0),
    g: clampInt(args.startGreen, 0, 255, 0),
    b: clampInt(args.startBlue, 0, 255, 0),
    location: 0,
  };
  const end: Stop = {
    r: clampInt(args.endRed, 0, 255, 255),
    g: clampInt(args.endGreen, 0, 255, 255),
    b: clampInt(args.endBlue, 0, 255, 255),
    location: 100,
  };
  return [start, end];
}

/** Serialize stops into an ExtendScript array literal of {r,g,b,location} objects. */
function stopsLiteral(stops: Stop[]): string {
  const parts = stops.map(
    (s) => `{ r: ${s.r}, g: ${s.g}, b: ${s.b}, location: ${s.location} }`
  );
  return `[${parts.join(', ')}]`;
}

/** Prepend the fill/paint helper block, then run through the shared recipe executor. */
function executeFillPaint(
  transport: TransportRouter,
  historyName: string,
  body: string
): Promise<ToolResult> {
  return executeRecipe(transport, historyName, `${MCP_FILL_PAINT_HELPERS}\n${body}`);
}

const RGB_STOP_PROPS = {
  red: { type: 'number', description: 'Red component (0-255)', minimum: 0, maximum: 255 },
  green: { type: 'number', description: 'Green component (0-255)', minimum: 0, maximum: 255 },
  blue: { type: 'number', description: 'Blue component (0-255)', minimum: 0, maximum: 255 },
  location: {
    type: 'number',
    description: 'Stop position along the gradient, 0-100 (0 = start, 100 = end)',
    minimum: 0,
    maximum: 100,
  },
} as const;

export function createFillPaintTools(transport: TransportRouter): ToolDefinition[] {
  return [
    bindApplyGradient(transport),
    bindApplyPatternFill(transport),
    bindAddSolidFillLayer(transport),
    bindStrokeSelection(transport),
    bindFillSelectionWith(transport),
  ];
}

export const PHOTOSHOP_FILL_PAINT_TOOL_NAMES = [
  'photoshop_apply_gradient',
  'photoshop_apply_pattern_fill',
  'photoshop_add_solid_fill_layer',
  'photoshop_stroke_selection',
  'photoshop_fill_selection_with',
] as const;

// ---------------------------------------------------------------------------
// Apply gradient (draw on active layer, or as a gradient fill layer)
// ---------------------------------------------------------------------------

function bindApplyGradient(transport: TransportRouter): ToolDefinition {
  return {
    tool: {
      name: 'photoshop_apply_gradient',
      description:
        'Draw a GRADIENT on the active layer, or create a non-destructive Gradient fill layer.\n\n' +
        'Users often say: add a gradient, fade from one color to another, sunset background, ' +
        'radial glow fill, two-tone / multi-color gradient.\n\n' +
        'THE real gradient fill tool (photoshop_add_gradient_overlay is only a layer *effect*). ' +
        'By default it draws the gradient across the active pixel layer (respecting the active ' +
        'selection if there is one). Set asFillLayer:true for a non-destructive Gradient fill layer.\n\n' +
        'Colors: pass a two-color gradient with startRed/Green/Blue + endRed/Green/Blue, OR a ' +
        'multi-stop `stops` array (each { red, green, blue, location 0-100 }). type is one of ' +
        'linear/radial/angle/reflected/diamond. One undo reverts the whole thing.\n' +
        'Requires an RGB document. Drawing (asFillLayer:false) needs a pixel/normal active layer.\n\n' +
        'Returns: { ok, summary, details: { mode, type, stops, angle, scale, reverse, opacity, blend_mode, layer_name } }.',
      inputSchema: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            description: 'Gradient type (default linear)',
            enum: GRADIENT_TYPES as unknown as string[],
            default: 'linear',
          },
          startRed: { type: 'number', minimum: 0, maximum: 255, default: 0, description: 'Start color red (default 0). Ignored if stops[] given.' },
          startGreen: { type: 'number', minimum: 0, maximum: 255, default: 0, description: 'Start color green (default 0). Ignored if stops[] given.' },
          startBlue: { type: 'number', minimum: 0, maximum: 255, default: 0, description: 'Start color blue (default 0). Ignored if stops[] given.' },
          endRed: { type: 'number', minimum: 0, maximum: 255, default: 255, description: 'End color red (default 255). Ignored if stops[] given.' },
          endGreen: { type: 'number', minimum: 0, maximum: 255, default: 255, description: 'End color green (default 255). Ignored if stops[] given.' },
          endBlue: { type: 'number', minimum: 0, maximum: 255, default: 255, description: 'End color blue (default 255). Ignored if stops[] given.' },
          stops: {
            type: 'array',
            description:
              'Optional multi-stop gradient (overrides start/end). 2+ color stops; first is forced to location 0, last to 100.',
            minItems: 2,
            items: {
              type: 'object',
              properties: { ...RGB_STOP_PROPS },
              required: ['red', 'green', 'blue'],
            },
          },
          angle: { type: 'number', description: 'Gradient angle -180..180 degrees (default 90)', minimum: -180, maximum: 180, default: 90 },
          scale: { type: 'number', description: 'Gradient scale 10-150 percent (default 100)', minimum: 10, maximum: 150, default: 100 },
          reverse: { type: 'boolean', description: 'Reverse the gradient direction (default false)', default: false },
          dither: { type: 'boolean', description: 'Dither to reduce banding (default true)', default: true },
          opacity: { type: 'number', description: 'Opacity 0-100 (default 100)', minimum: 0, maximum: 100, default: 100 },
          blendMode: { type: 'string', description: 'Blend mode (default NORMAL)', enum: BLEND_MODES as unknown as string[], default: 'NORMAL' },
          asFillLayer: {
            type: 'boolean',
            description:
              'true = create a non-destructive Gradient fill layer instead of drawing pixels (default false). ' +
              'Fill layers ignore the active selection but honor angle/scale/reverse.',
            default: false,
          },
        },
      },
    },
    handler: async (args) => {
      const type = oneOf(args.type, GRADIENT_TYPES, 'linear');
      const stops = gradientStops(args);
      const angle = clampInt(args.angle, -180, 180, 90);
      const scale = clampInt(args.scale, 10, 150, 100);
      const reverse = args.reverse === true;
      const dither = args.dither !== false;
      const opacity = clampInt(args.opacity, 0, 100, 100);
      const mode = blendMode(args.blendMode, 'NORMAL');
      const asFillLayer = args.asFillLayer === true;
      const body = `
        var __res = __mcp_applyGradient({
          type: '${type}',
          stops: ${stopsLiteral(stops)},
          angle: ${angle}, scale: ${scale}, reverse: ${reverse}, dither: ${dither},
          opacity: ${opacity}, blendMode: '${mode}', asFillLayer: ${asFillLayer}
        });
        return {
          ok: true,
          summary: (${asFillLayer} ? 'Gradient fill layer created on ' : 'Gradient drawn on ') + __res.layer_name,
          undo_history_states_consumed: 1,
          next_suggested_tool: 'photoshop_get_preview',
          details: {
            mode: (${asFillLayer} ? 'fill_layer' : 'draw'),
            type: '${type}',
            stops: ${stopsLiteral(stops)},
            angle: ${angle}, scale: ${scale}, reverse: ${reverse},
            opacity: ${opacity}, blend_mode: '${mode}',
            layer_name: __res.layer_name
          }
        };
      `;
      return executeFillPaint(transport, 'Apply Gradient', body);
    },
  };
}

// ---------------------------------------------------------------------------
// Apply pattern fill
// ---------------------------------------------------------------------------

function bindApplyPatternFill(transport: TransportRouter): ToolDefinition {
  return {
    tool: {
      name: 'photoshop_apply_pattern_fill',
      description:
        'Fill with a PATTERN — as a non-destructive Pattern fill layer (default) or drawn onto the active pixel layer.\n\n' +
        'Users often say: fill with a pattern, tile this texture, add a checkerboard/dots pattern.\n\n' +
        'patternName selects a preset by (case-insensitive) name from the currently loaded pattern presets ' +
        '(the built-in set plus any the user has loaded). Omit patternName to use the first available preset. ' +
        'scale resizes the tile. One undo reverts it.\n' +
        'Requires an RGB document and at least one pattern preset available. Drawing (asFillLayer:false) needs a pixel/normal active layer.\n\n' +
        'Returns: { ok, summary, details: { mode, pattern_name, scale, opacity, blend_mode, layer_name } }.',
      inputSchema: {
        type: 'object',
        properties: {
          patternName: {
            type: 'string',
            description:
              'Name of a loaded pattern preset (case-insensitive substring match). Omit to use the first available preset.',
          },
          scale: { type: 'number', description: 'Pattern scale 1-1000 percent (default 100)', minimum: 1, maximum: 1000, default: 100 },
          opacity: { type: 'number', description: 'Opacity 0-100 (default 100)', minimum: 0, maximum: 100, default: 100 },
          blendMode: { type: 'string', description: 'Blend mode (default NORMAL)', enum: BLEND_MODES as unknown as string[], default: 'NORMAL' },
          asFillLayer: {
            type: 'boolean',
            description:
              'true = non-destructive Pattern fill layer (default true). false = draw the pattern onto the active pixel layer (honors the active selection).',
            default: true,
          },
        },
      },
    },
    handler: async (args) => {
      const patternName = typeof args.patternName === 'string' ? args.patternName : '';
      const scale = clampInt(args.scale, 1, 1000, 100);
      const opacity = clampInt(args.opacity, 0, 100, 100);
      const mode = blendMode(args.blendMode, 'NORMAL');
      const asFillLayer = args.asFillLayer !== false;
      // jsString-style escaping for the pattern name embedded in the ExtendScript literal.
      const safeName = patternName
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/\n/g, ' ')
        .replace(/\r/g, ' ');
      const body = `
        var __res = __mcp_applyPatternFill({
          patternName: '${safeName}', scale: ${scale},
          opacity: ${opacity}, blendMode: '${mode}', asFillLayer: ${asFillLayer}
        });
        return {
          ok: true,
          summary: (${asFillLayer} ? 'Pattern fill layer created on ' : 'Pattern drawn on ') + __res.layer_name + ' (' + __res.pattern_name + ')',
          undo_history_states_consumed: 1,
          next_suggested_tool: 'photoshop_get_preview',
          details: {
            mode: (${asFillLayer} ? 'fill_layer' : 'draw'),
            pattern_name: __res.pattern_name,
            scale: ${scale}, opacity: ${opacity}, blend_mode: '${mode}',
            layer_name: __res.layer_name
          }
        };
      `;
      return executeFillPaint(transport, 'Apply Pattern Fill', body);
    },
  };
}

// ---------------------------------------------------------------------------
// Add solid color fill layer (non-destructive)
// ---------------------------------------------------------------------------

function bindAddSolidFillLayer(transport: TransportRouter): ToolDefinition {
  return {
    tool: {
      name: 'photoshop_add_solid_fill_layer',
      description:
        'Add a Solid Color FILL LAYER (non-destructive flat color).\n\n' +
        'Users often say: add a color fill layer, flat background color, solid color layer.\n\n' +
        'Creates a Solid Color content layer above the active layer, filled with the given RGB. ' +
        'Non-destructive (editable, maskable) — unlike photoshop_fill_layer which paints pixels. ' +
        'If a selection is active, the fill layer is clipped to it via its layer mask. One undo reverts it.\n' +
        'Requires an RGB document.\n\n' +
        'Returns: { ok, summary, details: { layer_name, color, opacity, blend_mode, clipped_to_selection } }.',
      inputSchema: {
        type: 'object',
        properties: {
          red: { type: 'number', description: 'Red component (0-255)', minimum: 0, maximum: 255 },
          green: { type: 'number', description: 'Green component (0-255)', minimum: 0, maximum: 255 },
          blue: { type: 'number', description: 'Blue component (0-255)', minimum: 0, maximum: 255 },
          opacity: { type: 'number', description: 'Layer opacity 0-100 (default 100)', minimum: 0, maximum: 100, default: 100 },
          blendMode: { type: 'string', description: 'Layer blend mode (default NORMAL)', enum: BLEND_MODES as unknown as string[], default: 'NORMAL' },
          name: { type: 'string', description: 'Optional layer name (default "Color Fill")' },
        },
        required: ['red', 'green', 'blue'],
      },
    },
    handler: async (args) => {
      const color = rgb(args, 0, 0, 0);
      const opacity = clampInt(args.opacity, 0, 100, 100);
      const mode = blendMode(args.blendMode, 'NORMAL');
      const rawName = typeof args.name === 'string' && args.name.trim() ? args.name : 'Color Fill';
      const safeName = rawName
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/\n/g, ' ')
        .replace(/\r/g, ' ');
      const body = `
        var __res = __mcp_addSolidFillLayer({
          red: ${color.r}, green: ${color.g}, blue: ${color.b},
          opacity: ${opacity}, blendMode: '${mode}', name: '${safeName}'
        });
        return {
          ok: true,
          summary: 'Solid color fill layer created: ' + __res.layer_name,
          undo_history_states_consumed: 1,
          next_suggested_tool: 'photoshop_get_preview',
          details: {
            layer_name: __res.layer_name,
            color: { red: ${color.r}, green: ${color.g}, blue: ${color.b} },
            opacity: ${opacity}, blend_mode: '${mode}',
            clipped_to_selection: __res.clipped_to_selection
          }
        };
      `;
      return executeFillPaint(transport, 'Add Solid Fill Layer', body);
    },
  };
}

// ---------------------------------------------------------------------------
// Stroke selection
// ---------------------------------------------------------------------------

function bindStrokeSelection(transport: TransportRouter): ToolDefinition {
  return {
    tool: {
      name: 'photoshop_stroke_selection',
      description:
        'STROKE (outline) the current selection on the active pixel layer.\n\n' +
        'Users often say: outline the selection, draw a border around this, add a frame/rule.\n\n' +
        'The atomic behind graphic borders: paints a stroke of the given width and color along the ' +
        'selection edge. location controls whether the stroke sits inside / centered on / outside the ' +
        'selection boundary. Destructive (paints onto the active layer). One undo reverts it.\n' +
        'Requires an RGB document, an ACTIVE SELECTION, and a pixel/normal active layer (clear error otherwise).\n\n' +
        'Returns: { ok, summary, details: { layer_name, width, location, color, opacity, blend_mode } }.',
      inputSchema: {
        type: 'object',
        properties: {
          width: { type: 'number', description: 'Stroke width in px (default 3)', minimum: 1, maximum: 1000, default: 3 },
          location: {
            type: 'string',
            description: 'Stroke position relative to the selection edge (default center)',
            enum: STROKE_LOCATIONS as unknown as string[],
            default: 'center',
          },
          red: { type: 'number', description: 'Red component (0-255, default 0)', minimum: 0, maximum: 255, default: 0 },
          green: { type: 'number', description: 'Green component (0-255, default 0)', minimum: 0, maximum: 255, default: 0 },
          blue: { type: 'number', description: 'Blue component (0-255, default 0)', minimum: 0, maximum: 255, default: 0 },
          opacity: { type: 'number', description: 'Stroke opacity 0-100 (default 100)', minimum: 0, maximum: 100, default: 100 },
          blendMode: { type: 'string', description: 'Blend mode (default NORMAL)', enum: BLEND_MODES as unknown as string[], default: 'NORMAL' },
        },
      },
    },
    handler: async (args) => {
      const width = clampInt(args.width, 1, 1000, 3);
      const location = oneOf(args.location, STROKE_LOCATIONS, 'center');
      const color = rgb(args, 0, 0, 0);
      const opacity = clampInt(args.opacity, 0, 100, 100);
      const mode = blendMode(args.blendMode, 'NORMAL');
      const body = `
        var __layerName = __mcp_strokeSelection({
          width: ${width}, location: '${location}',
          red: ${color.r}, green: ${color.g}, blue: ${color.b},
          opacity: ${opacity}, blendMode: '${mode}'
        });
        return {
          ok: true,
          summary: 'Selection stroked on ' + __layerName,
          undo_history_states_consumed: 1,
          next_suggested_tool: 'photoshop_get_preview',
          details: {
            layer_name: __layerName,
            width: ${width}, location: '${location}',
            color: { red: ${color.r}, green: ${color.g}, blue: ${color.b} },
            opacity: ${opacity}, blend_mode: '${mode}'
          }
        };
      `;
      return executeFillPaint(transport, 'Stroke Selection', body);
    },
  };
}

// ---------------------------------------------------------------------------
// Fill selection with (foreground / background / color / black / white / 50% gray)
// ---------------------------------------------------------------------------

function bindFillSelectionWith(transport: TransportRouter): ToolDefinition {
  return {
    tool: {
      name: 'photoshop_fill_selection_with',
      description:
        'FILL the current selection on the active pixel layer with a named source.\n\n' +
        'Users often say: fill with black, fill the selection with foreground color, fill it white, fill with 50% gray.\n\n' +
        'source is one of foreground | background | color | black | white | 50gray (alias gray). ' +
        'For source:"color" pass red/green/blue. Honors opacity + blendMode. Destructive (paints the active ' +
        'layer inside the selection). One undo reverts it.\n' +
        'Differs from photoshop_fill_layer (whole-layer flat fill, no selection/opacity/mode) and ' +
        'photoshop_add_solid_fill_layer (non-destructive fill layer).\n' +
        'Requires an RGB document, an ACTIVE SELECTION, and a pixel/normal active layer (clear error otherwise).\n\n' +
        'Returns: { ok, summary, details: { layer_name, source, color, opacity, blend_mode } }.',
      inputSchema: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            description: 'Fill source (default foreground)',
            enum: FILL_SOURCES as unknown as string[],
            default: 'foreground',
          },
          red: { type: 'number', description: 'Red (0-255) — only used when source is "color"', minimum: 0, maximum: 255, default: 0 },
          green: { type: 'number', description: 'Green (0-255) — only used when source is "color"', minimum: 0, maximum: 255, default: 0 },
          blue: { type: 'number', description: 'Blue (0-255) — only used when source is "color"', minimum: 0, maximum: 255, default: 0 },
          opacity: { type: 'number', description: 'Fill opacity 0-100 (default 100)', minimum: 0, maximum: 100, default: 100 },
          blendMode: { type: 'string', description: 'Blend mode (default NORMAL)', enum: BLEND_MODES as unknown as string[], default: 'NORMAL' },
        },
      },
    },
    handler: async (args) => {
      const source = oneOf(args.source, FILL_SOURCES, 'foreground');
      const color = rgb(args, 0, 0, 0);
      const opacity = clampInt(args.opacity, 0, 100, 100);
      const mode = blendMode(args.blendMode, 'NORMAL');
      const body = `
        var __layerName = __mcp_fillSelectionWith({
          source: '${source}',
          red: ${color.r}, green: ${color.g}, blue: ${color.b},
          opacity: ${opacity}, blendMode: '${mode}'
        });
        return {
          ok: true,
          summary: 'Selection filled with ${source} on ' + __layerName,
          undo_history_states_consumed: 1,
          next_suggested_tool: 'photoshop_get_preview',
          details: {
            layer_name: __layerName,
            source: '${source}',
            color: { red: ${color.r}, green: ${color.g}, blue: ${color.b} },
            opacity: ${opacity}, blend_mode: '${mode}'
          }
        };
      `;
      return executeFillPaint(transport, 'Fill Selection', body);
    },
  };
}
