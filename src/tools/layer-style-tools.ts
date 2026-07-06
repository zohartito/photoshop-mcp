import type { ToolDefinition, ToolResult } from '../core/tool-registry.js';
import type { TransportRouter } from '../transport/index.js';
import { MCP_LAYER_STYLE_HELPERS } from '../api/extendscript.js';
import { clampInt, executeRecipe } from './recipes/_shared.js';

/**
 * Dedicated, parameterized layer-style / FX tools.
 *
 * Each tool applies one Photoshop layer effect (drop shadow, stroke, ...) to the
 * ACTIVE LAYER by building a `layerEffects` ActionDescriptor and running
 * executeAction('set', ...). The transport runs ExtendScript (not UXP); descriptor
 * key structure is cribbed from the UXP batchPlay reference
 * (add_drop_shadow_layer_style / add_stroke_layer_style).
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
  return [bindDropShadow(transport), bindStroke(transport)];
}

export const PHOTOSHOP_LAYER_STYLE_TOOL_NAMES = [
  'photoshop_add_drop_shadow',
  'photoshop_add_stroke',
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
