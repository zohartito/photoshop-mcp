import type { ToolDefinition, ToolResult } from '../core/tool-registry.js';
import type { TransportRouter } from '../transport/index.js';
import { MCP_LAYER_STYLE_HELPERS } from '../api/extendscript.js';
import { clampInt, executeRecipe } from './recipes/_shared.js';

/**
 * Dedicated, parameterized layer-style / FX tools.
 *
 * Each tool applies one Photoshop layer effect (drop shadow, stroke, outer glow,
 * color overlay, inner shadow, bevel/emboss, gradient overlay) to the ACTIVE LAYER
 * by building a `layerEffects` ActionDescriptor and running executeAction('set', ...).
 * The transport runs ExtendScript (not UXP); descriptor key structure is cribbed from
 * the UXP batchPlay reference (add_drop_shadow_layer_style / add_stroke_layer_style).
 *
 * EFFECTS MERGE + ONE UNDO: each tool reads the layer's existing effects and merges the
 * new one in, so e.g. add_stroke after add_drop_shadow keeps BOTH. Re-applying the same
 * effect type replaces just that sub-effect. Every call is wrapped in a single
 * suspendHistory step, so one undo reverts the whole effect.
 *
 * RGB only: layer effects require an RGB document; a clear error is thrown otherwise.
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

type Rgb = { r: number; g: number; b: number };

function rgb(args: Record<string, unknown>, dr: number, dg: number, db: number): Rgb {
  return {
    r: clampInt(args.red, 0, 255, dr),
    g: clampInt(args.green, 0, 255, dg),
    b: clampInt(args.blue, 0, 255, db),
  };
}

function blendMode(value: unknown, fallback: string): string {
  const upper = typeof value === 'string' ? value.toUpperCase() : '';
  return (BLEND_MODES as readonly string[]).includes(upper) ? upper : fallback;
}

/** Prepend the layer-style helper block, then run through the shared recipe executor (suspendHistory + envelope). */
function executeLayerStyle(
  transport: TransportRouter,
  historyName: string,
  body: string
): Promise<ToolResult> {
  return executeRecipe(transport, historyName, `${MCP_LAYER_STYLE_HELPERS}\n${body}`);
}

const RGB_COLOR_PROPS = {
  red: { type: 'number', description: 'Red component (0-255)', minimum: 0, maximum: 255 },
  green: { type: 'number', description: 'Green component (0-255)', minimum: 0, maximum: 255 },
  blue: { type: 'number', description: 'Blue component (0-255)', minimum: 0, maximum: 255 },
} as const;

export function createLayerStyleTools(transport: TransportRouter): ToolDefinition[] {
  return [
    bindDropShadow(transport),
    bindStroke(transport),
    bindOuterGlow(transport),
    bindColorOverlay(transport),
    bindInnerShadow(transport),
    bindBevelEmboss(transport),
    bindGradientOverlay(transport),
  ];
}

export const PHOTOSHOP_LAYER_STYLE_TOOL_NAMES = [
  'photoshop_add_drop_shadow',
  'photoshop_add_stroke',
  'photoshop_add_outer_glow',
  'photoshop_add_color_overlay',
  'photoshop_add_inner_shadow',
  'photoshop_add_bevel_emboss',
  'photoshop_add_gradient_overlay',
] as const;

// ---------------------------------------------------------------------------
// Drop shadow
// ---------------------------------------------------------------------------

function bindDropShadow(transport: TransportRouter): ToolDefinition {
  return {
    tool: {
      name: 'photoshop_add_drop_shadow',
      description:
        'Add a Drop Shadow layer effect (FX) to the ACTIVE LAYER.\n\n' +
        'Users often say: add a drop shadow, drop shadow on the text, make it pop off the background.\n\n' +
        'Merges with existing effects (add_stroke etc. still applies) and re-applying replaces only the drop shadow. One undo reverts it.\n' +
        'Requires an RGB document (clear error otherwise) and a non-group active layer.\n\n' +
        'Returns: { ok, summary, details: { layer_name, color, opacity, angle, distance, size, spread, blend_mode } }.',
      inputSchema: {
        type: 'object',
        properties: {
          ...RGB_COLOR_PROPS,
          opacity: { type: 'number', description: 'Shadow opacity 0-100 (default 35)', minimum: 0, maximum: 100, default: 35 },
          angle: { type: 'number', description: 'Light angle -180..180 degrees (default 120)', minimum: -180, maximum: 180, default: 120 },
          distance: { type: 'number', description: 'Offset distance in px (default 10)', minimum: 0, default: 10 },
          size: { type: 'number', description: 'Blur size in px (default 10)', minimum: 0, default: 10 },
          spread: { type: 'number', description: 'Spread 0-100 (default 0)', minimum: 0, maximum: 100, default: 0 },
          blendMode: { type: 'string', description: 'Blend mode (default MULTIPLY)', enum: BLEND_MODES as unknown as string[], default: 'MULTIPLY' },
        },
      },
    },
    handler: async (args) => {
      const color = rgb(args, 0, 0, 0);
      const opacity = clampInt(args.opacity, 0, 100, 35);
      const angle = clampInt(args.angle, -180, 180, 120);
      const distance = clampInt(args.distance, 0, 30000, 10);
      const size = clampInt(args.size, 0, 250, 10);
      const spread = clampInt(args.spread, 0, 100, 0);
      const mode = blendMode(args.blendMode, 'MULTIPLY');
      const body = `
        var __layerName = __mcp_applyLayerEffect('dropShadow', __mcp_buildDropShadow({
          red: ${color.r}, green: ${color.g}, blue: ${color.b},
          opacity: ${opacity}, angle: ${angle}, distance: ${distance},
          size: ${size}, spread: ${spread}, blendMode: '${mode}'
        }), ${angle});
        return {
          ok: true,
          summary: 'Drop shadow applied to ' + __layerName,
          undo_history_states_consumed: 1,
          next_suggested_tool: 'photoshop_get_preview',
          details: {
            layer_name: __layerName,
            color: { red: ${color.r}, green: ${color.g}, blue: ${color.b} },
            opacity: ${opacity}, angle: ${angle}, distance: ${distance},
            size: ${size}, spread: ${spread}, blend_mode: '${mode}'
          }
        };
      `;
      return executeLayerStyle(transport, 'Add Drop Shadow', body);
    },
  };
}

// ---------------------------------------------------------------------------
// Stroke
// ---------------------------------------------------------------------------

function bindStroke(transport: TransportRouter): ToolDefinition {
  return {
    tool: {
      name: 'photoshop_add_stroke',
      description:
        'Add a Stroke (outline) layer effect to the ACTIVE LAYER.\n\n' +
        'Users often say: add an outline, stroke the text, put a border around it.\n\n' +
        'Merges with existing effects (keeps a drop shadow etc.) and re-applying replaces only the stroke. One undo reverts it.\n' +
        'Requires an RGB document and a non-group active layer.\n\n' +
        'Returns: { ok, summary, details: { layer_name, size, position, color, opacity, blend_mode } }.',
      inputSchema: {
        type: 'object',
        properties: {
          size: { type: 'number', description: 'Stroke width in px (default 3)', minimum: 0, default: 3 },
          position: { type: 'string', description: 'Stroke position relative to layer edge (default outside)', enum: ['outside', 'inside', 'center'], default: 'outside' },
          ...RGB_COLOR_PROPS,
          opacity: { type: 'number', description: 'Stroke opacity 0-100 (default 100)', minimum: 0, maximum: 100, default: 100 },
          blendMode: { type: 'string', description: 'Blend mode (default NORMAL)', enum: BLEND_MODES as unknown as string[], default: 'NORMAL' },
        },
      },
    },
    handler: async (args) => {
      const size = clampInt(args.size, 0, 250, 3);
      const position = ['outside', 'inside', 'center'].includes(String(args.position))
        ? String(args.position)
        : 'outside';
      const color = rgb(args, 0, 0, 0);
      const opacity = clampInt(args.opacity, 0, 100, 100);
      const mode = blendMode(args.blendMode, 'NORMAL');
      const body = `
        var __layerName = __mcp_applyLayerEffect('frameFX', __mcp_buildStroke({
          size: ${size}, position: '${position}',
          red: ${color.r}, green: ${color.g}, blue: ${color.b},
          opacity: ${opacity}, blendMode: '${mode}'
        }));
        return {
          ok: true,
          summary: 'Stroke applied to ' + __layerName,
          undo_history_states_consumed: 1,
          next_suggested_tool: 'photoshop_get_preview',
          details: {
            layer_name: __layerName,
            size: ${size}, position: '${position}',
            color: { red: ${color.r}, green: ${color.g}, blue: ${color.b} },
            opacity: ${opacity}, blend_mode: '${mode}'
          }
        };
      `;
      return executeLayerStyle(transport, 'Add Stroke', body);
    },
  };
}

// ---------------------------------------------------------------------------
// Outer glow
// ---------------------------------------------------------------------------

function bindOuterGlow(transport: TransportRouter): ToolDefinition {
  return {
    tool: {
      name: 'photoshop_add_outer_glow',
      description:
        'Add an Outer Glow layer effect to the ACTIVE LAYER.\n\n' +
        'Users often say: add a glow, make it glow, neon edge.\n\n' +
        'Default color is a warm white (255,255,190) on SCREEN blend. Merges with existing effects; re-applying replaces only the outer glow. One undo reverts it.\n' +
        'Requires an RGB document and a non-group active layer.\n\n' +
        'Returns: { ok, summary, details: { layer_name, color, opacity, size, spread, blend_mode } }.',
      inputSchema: {
        type: 'object',
        properties: {
          red: { type: 'number', description: 'Red component (0-255, default 255)', minimum: 0, maximum: 255, default: 255 },
          green: { type: 'number', description: 'Green component (0-255, default 255)', minimum: 0, maximum: 255, default: 255 },
          blue: { type: 'number', description: 'Blue component (0-255, default 190)', minimum: 0, maximum: 255, default: 190 },
          opacity: { type: 'number', description: 'Glow opacity 0-100 (default 50)', minimum: 0, maximum: 100, default: 50 },
          size: { type: 'number', description: 'Glow size in px (default 15)', minimum: 0, default: 15 },
          spread: { type: 'number', description: 'Spread 0-100 (default 0)', minimum: 0, maximum: 100, default: 0 },
          blendMode: { type: 'string', description: 'Blend mode (default SCREEN)', enum: BLEND_MODES as unknown as string[], default: 'SCREEN' },
        },
      },
    },
    handler: async (args) => {
      const color = rgb(args, 255, 255, 190);
      const opacity = clampInt(args.opacity, 0, 100, 50);
      const size = clampInt(args.size, 0, 250, 15);
      const spread = clampInt(args.spread, 0, 100, 0);
      const mode = blendMode(args.blendMode, 'SCREEN');
      const body = `
        var __layerName = __mcp_applyLayerEffect('outerGlow', __mcp_buildOuterGlow({
          red: ${color.r}, green: ${color.g}, blue: ${color.b},
          opacity: ${opacity}, size: ${size}, spread: ${spread}, blendMode: '${mode}'
        }));
        return {
          ok: true,
          summary: 'Outer glow applied to ' + __layerName,
          undo_history_states_consumed: 1,
          next_suggested_tool: 'photoshop_get_preview',
          details: {
            layer_name: __layerName,
            color: { red: ${color.r}, green: ${color.g}, blue: ${color.b} },
            opacity: ${opacity}, size: ${size}, spread: ${spread}, blend_mode: '${mode}'
          }
        };
      `;
      return executeLayerStyle(transport, 'Add Outer Glow', body);
    },
  };
}

// ---------------------------------------------------------------------------
// Color overlay
// ---------------------------------------------------------------------------

function bindColorOverlay(transport: TransportRouter): ToolDefinition {
  return {
    tool: {
      name: 'photoshop_add_color_overlay',
      description:
        'Add a Color Overlay layer effect to the ACTIVE LAYER (recolor content non-destructively).\n\n' +
        'Users often say: recolor this, tint the layer, fill it with a color.\n\n' +
        'Color (red/green/blue) is required. Merges with existing effects; re-applying replaces only the color overlay. One undo reverts it.\n' +
        'Requires an RGB document and a non-group active layer.\n\n' +
        'Returns: { ok, summary, details: { layer_name, color, opacity, blend_mode } }.',
      inputSchema: {
        type: 'object',
        properties: {
          ...RGB_COLOR_PROPS,
          opacity: { type: 'number', description: 'Overlay opacity 0-100 (default 100)', minimum: 0, maximum: 100, default: 100 },
          blendMode: { type: 'string', description: 'Blend mode (default NORMAL)', enum: BLEND_MODES as unknown as string[], default: 'NORMAL' },
        },
        required: ['red', 'green', 'blue'],
      },
    },
    handler: async (args) => {
      const color = rgb(args, 0, 0, 0);
      const opacity = clampInt(args.opacity, 0, 100, 100);
      const mode = blendMode(args.blendMode, 'NORMAL');
      const body = `
        var __layerName = __mcp_applyLayerEffect('solidFill', __mcp_buildColorOverlay({
          red: ${color.r}, green: ${color.g}, blue: ${color.b},
          opacity: ${opacity}, blendMode: '${mode}'
        }));
        return {
          ok: true,
          summary: 'Color overlay applied to ' + __layerName,
          undo_history_states_consumed: 1,
          next_suggested_tool: 'photoshop_get_preview',
          details: {
            layer_name: __layerName,
            color: { red: ${color.r}, green: ${color.g}, blue: ${color.b} },
            opacity: ${opacity}, blend_mode: '${mode}'
          }
        };
      `;
      return executeLayerStyle(transport, 'Add Color Overlay', body);
    },
  };
}

// ---------------------------------------------------------------------------
// Inner shadow
// ---------------------------------------------------------------------------

function bindInnerShadow(transport: TransportRouter): ToolDefinition {
  return {
    tool: {
      name: 'photoshop_add_inner_shadow',
      description:
        'Add an Inner Shadow layer effect to the ACTIVE LAYER (shadow cast inward, for a cut-in / pressed look).\n\n' +
        'Merges with existing effects; re-applying replaces only the inner shadow. One undo reverts it.\n' +
        'Requires an RGB document and a non-group active layer.\n\n' +
        'Returns: { ok, summary, details: { layer_name, color, opacity, angle, distance, size, spread, blend_mode } }.',
      inputSchema: {
        type: 'object',
        properties: {
          ...RGB_COLOR_PROPS,
          opacity: { type: 'number', description: 'Shadow opacity 0-100 (default 35)', minimum: 0, maximum: 100, default: 35 },
          angle: { type: 'number', description: 'Light angle -180..180 degrees (default 120)', minimum: -180, maximum: 180, default: 120 },
          distance: { type: 'number', description: 'Offset distance in px (default 5)', minimum: 0, default: 5 },
          size: { type: 'number', description: 'Blur size in px (default 5)', minimum: 0, default: 5 },
          spread: { type: 'number', description: 'Choke 0-100 (default 0)', minimum: 0, maximum: 100, default: 0 },
          blendMode: { type: 'string', description: 'Blend mode (default MULTIPLY)', enum: BLEND_MODES as unknown as string[], default: 'MULTIPLY' },
        },
      },
    },
    handler: async (args) => {
      const color = rgb(args, 0, 0, 0);
      const opacity = clampInt(args.opacity, 0, 100, 35);
      const angle = clampInt(args.angle, -180, 180, 120);
      const distance = clampInt(args.distance, 0, 30000, 5);
      const size = clampInt(args.size, 0, 250, 5);
      const spread = clampInt(args.spread, 0, 100, 0);
      const mode = blendMode(args.blendMode, 'MULTIPLY');
      const body = `
        var __layerName = __mcp_applyLayerEffect('innerShadow', __mcp_buildInnerShadow({
          red: ${color.r}, green: ${color.g}, blue: ${color.b},
          opacity: ${opacity}, angle: ${angle}, distance: ${distance},
          size: ${size}, spread: ${spread}, blendMode: '${mode}'
        }), ${angle});
        return {
          ok: true,
          summary: 'Inner shadow applied to ' + __layerName,
          undo_history_states_consumed: 1,
          next_suggested_tool: 'photoshop_get_preview',
          details: {
            layer_name: __layerName,
            color: { red: ${color.r}, green: ${color.g}, blue: ${color.b} },
            opacity: ${opacity}, angle: ${angle}, distance: ${distance},
            size: ${size}, spread: ${spread}, blend_mode: '${mode}'
          }
        };
      `;
      return executeLayerStyle(transport, 'Add Inner Shadow', body);
    },
  };
}

// ---------------------------------------------------------------------------
// Bevel & emboss
// ---------------------------------------------------------------------------

function bindBevelEmboss(transport: TransportRouter): ToolDefinition {
  return {
    tool: {
      name: 'photoshop_add_bevel_emboss',
      description:
        'Add a Bevel & Emboss layer effect to the ACTIVE LAYER (3D edge highlight/shadow).\n\n' +
        'Users often say: bevel, emboss, make it 3D, give it depth.\n\n' +
        'Merges with existing effects; re-applying replaces only the bevel/emboss. One undo reverts it.\n' +
        'Requires an RGB document and a non-group active layer.\n\n' +
        'Returns: { ok, summary, details: { layer_name, style, depth, size, soften, angle, altitude } }.',
      inputSchema: {
        type: 'object',
        properties: {
          style: { type: 'string', description: 'Bevel style (default innerBevel)', enum: ['outerBevel', 'innerBevel', 'emboss', 'pillowEmboss', 'strokeEmboss'], default: 'innerBevel' },
          depth: { type: 'number', description: 'Depth 1-1000 percent (default 100)', minimum: 1, maximum: 1000, default: 100 },
          size: { type: 'number', description: 'Size in px (default 5)', minimum: 0, default: 5 },
          soften: { type: 'number', description: 'Soften in px (default 0)', minimum: 0, default: 0 },
          angle: { type: 'number', description: 'Light angle -180..180 (default 120)', minimum: -180, maximum: 180, default: 120 },
          altitude: { type: 'number', description: 'Light altitude 0-90 (default 30)', minimum: 0, maximum: 90, default: 30 },
          highlightRed: { type: 'number', minimum: 0, maximum: 255, default: 255, description: 'Highlight red (default 255)' },
          highlightGreen: { type: 'number', minimum: 0, maximum: 255, default: 255, description: 'Highlight green (default 255)' },
          highlightBlue: { type: 'number', minimum: 0, maximum: 255, default: 255, description: 'Highlight blue (default 255)' },
          highlightOpacity: { type: 'number', minimum: 0, maximum: 100, default: 75, description: 'Highlight opacity (default 75)' },
          highlightBlendMode: { type: 'string', enum: BLEND_MODES as unknown as string[], default: 'SCREEN', description: 'Highlight blend mode (default SCREEN)' },
          shadowRed: { type: 'number', minimum: 0, maximum: 255, default: 0, description: 'Shadow red (default 0)' },
          shadowGreen: { type: 'number', minimum: 0, maximum: 255, default: 0, description: 'Shadow green (default 0)' },
          shadowBlue: { type: 'number', minimum: 0, maximum: 255, default: 0, description: 'Shadow blue (default 0)' },
          shadowOpacity: { type: 'number', minimum: 0, maximum: 100, default: 75, description: 'Shadow opacity (default 75)' },
          shadowBlendMode: { type: 'string', enum: BLEND_MODES as unknown as string[], default: 'MULTIPLY', description: 'Shadow blend mode (default MULTIPLY)' },
        },
      },
    },
    handler: async (args) => {
      const style = ['outerBevel', 'innerBevel', 'emboss', 'pillowEmboss', 'strokeEmboss'].includes(String(args.style))
        ? String(args.style)
        : 'innerBevel';
      const depth = clampInt(args.depth, 1, 1000, 100);
      const size = clampInt(args.size, 0, 250, 5);
      const soften = clampInt(args.soften, 0, 16, 0);
      const angle = clampInt(args.angle, -180, 180, 120);
      const altitude = clampInt(args.altitude, 0, 90, 30);
      const hi = {
        r: clampInt(args.highlightRed, 0, 255, 255),
        g: clampInt(args.highlightGreen, 0, 255, 255),
        b: clampInt(args.highlightBlue, 0, 255, 255),
      };
      const hiOpacity = clampInt(args.highlightOpacity, 0, 100, 75);
      const hiMode = blendMode(args.highlightBlendMode, 'SCREEN');
      const sh = {
        r: clampInt(args.shadowRed, 0, 255, 0),
        g: clampInt(args.shadowGreen, 0, 255, 0),
        b: clampInt(args.shadowBlue, 0, 255, 0),
      };
      const shOpacity = clampInt(args.shadowOpacity, 0, 100, 75);
      const shMode = blendMode(args.shadowBlendMode, 'MULTIPLY');
      const body = `
        var __layerName = __mcp_applyLayerEffect('bevelEmboss', __mcp_buildBevelEmboss({
          style: '${style}', depth: ${depth}, size: ${size}, soften: ${soften},
          angle: ${angle}, altitude: ${altitude},
          highlightRed: ${hi.r}, highlightGreen: ${hi.g}, highlightBlue: ${hi.b},
          highlightOpacity: ${hiOpacity}, highlightBlendMode: '${hiMode}',
          shadowRed: ${sh.r}, shadowGreen: ${sh.g}, shadowBlue: ${sh.b},
          shadowOpacity: ${shOpacity}, shadowBlendMode: '${shMode}'
        }), ${angle});
        return {
          ok: true,
          summary: 'Bevel & emboss applied to ' + __layerName,
          undo_history_states_consumed: 1,
          next_suggested_tool: 'photoshop_get_preview',
          details: {
            layer_name: __layerName,
            style: '${style}', depth: ${depth}, size: ${size}, soften: ${soften},
            angle: ${angle}, altitude: ${altitude}
          }
        };
      `;
      return executeLayerStyle(transport, 'Add Bevel & Emboss', body);
    },
  };
}

// ---------------------------------------------------------------------------
// Gradient overlay
// ---------------------------------------------------------------------------

function bindGradientOverlay(transport: TransportRouter): ToolDefinition {
  return {
    tool: {
      name: 'photoshop_add_gradient_overlay',
      description:
        'Add a Gradient Overlay layer effect to the ACTIVE LAYER (two-color linear gradient from start color to end color).\n\n' +
        'Users often say: gradient fill on the text, two-tone overlay, fade the color.\n\n' +
        'Merges with existing effects; re-applying replaces only the gradient overlay. One undo reverts it.\n' +
        'Requires an RGB document and a non-group active layer.\n\n' +
        'Returns: { ok, summary, details: { layer_name, start_color, end_color, angle, scale, opacity, blend_mode } }.',
      inputSchema: {
        type: 'object',
        properties: {
          startRed: { type: 'number', minimum: 0, maximum: 255, default: 0, description: 'Start color red (default 0)' },
          startGreen: { type: 'number', minimum: 0, maximum: 255, default: 0, description: 'Start color green (default 0)' },
          startBlue: { type: 'number', minimum: 0, maximum: 255, default: 0, description: 'Start color blue (default 0)' },
          endRed: { type: 'number', minimum: 0, maximum: 255, default: 255, description: 'End color red (default 255)' },
          endGreen: { type: 'number', minimum: 0, maximum: 255, default: 255, description: 'End color green (default 255)' },
          endBlue: { type: 'number', minimum: 0, maximum: 255, default: 255, description: 'End color blue (default 255)' },
          angle: { type: 'number', description: 'Gradient angle -180..180 (default 90)', minimum: -180, maximum: 180, default: 90 },
          scale: { type: 'number', description: 'Gradient scale 10-150 percent (default 100)', minimum: 10, maximum: 150, default: 100 },
          opacity: { type: 'number', description: 'Overlay opacity 0-100 (default 100)', minimum: 0, maximum: 100, default: 100 },
          blendMode: { type: 'string', description: 'Blend mode (default NORMAL)', enum: BLEND_MODES as unknown as string[], default: 'NORMAL' },
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
      const angle = clampInt(args.angle, -180, 180, 90);
      const scale = clampInt(args.scale, 10, 150, 100);
      const opacity = clampInt(args.opacity, 0, 100, 100);
      const mode = blendMode(args.blendMode, 'NORMAL');
      const body = `
        var __layerName = __mcp_applyLayerEffect('gradientFill', __mcp_buildGradientOverlay({
          startRed: ${start.r}, startGreen: ${start.g}, startBlue: ${start.b},
          endRed: ${end.r}, endGreen: ${end.g}, endBlue: ${end.b},
          angle: ${angle}, scale: ${scale}, opacity: ${opacity}, blendMode: '${mode}'
        }));
        return {
          ok: true,
          summary: 'Gradient overlay applied to ' + __layerName,
          undo_history_states_consumed: 1,
          next_suggested_tool: 'photoshop_get_preview',
          details: {
            layer_name: __layerName,
            start_color: { red: ${start.r}, green: ${start.g}, blue: ${start.b} },
            end_color: { red: ${end.r}, green: ${end.g}, blue: ${end.b} },
            angle: ${angle}, scale: ${scale}, opacity: ${opacity}, blend_mode: '${mode}'
          }
        };
      `;
      return executeLayerStyle(transport, 'Add Gradient Overlay', body);
    },
  };
}
