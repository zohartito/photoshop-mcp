import type { ToolDefinition, ToolResult } from '../core/tool-registry.js';
import type { TransportRouter } from '../transport/index.js';
import { MCP_TRANSFORM_EXTRA_HELPER } from '../api/extendscript.js';
import { executeRecipe, toolFailure } from './recipes/_shared.js';

/**
 * Extra transform tools that the fork lacks: skew, free-distort (4 corners),
 * perspective, warp (preset styles), and a combined free transform.
 *
 * Existing basic transforms (scale / rotate / flip / move) live in
 * `layer-transform-tools.ts`. These add the missing ones, each driving the Action
 * Manager `transform` / `warp` event on the ACTIVE LAYER via executeAction.
 *
 * Every tool runs through the shared recipe executor, so each is a single one-undo
 * `suspendHistory` step returning the
 * `{ ok, summary, undo_history_states_consumed, next_suggested_tool, details }`
 * envelope. Text and smart-object layers are auto-rasterized (via the shared raster
 * guard); layer groups throw a clear error.
 */

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

/** Ensure the active layer is raster before the transform descriptor runs. */
const ENSURE_RASTER = `__mcp_ensureRasterActiveLayer();`;

export function createTransformExtraTools(transport: TransportRouter): ToolDefinition[] {
  return [
    bindSkew(transport),
    bindDistortCorners(transport),
    bindPerspective(transport),
    bindWarp(transport),
    bindFreeTransform(transport),
  ];
}

export const PHOTOSHOP_TRANSFORM_EXTRA_TOOL_NAMES = [
  'photoshop_skew',
  'photoshop_distort_corners',
  'photoshop_perspective',
  'photoshop_warp',
  'photoshop_free_transform',
] as const;

const WARP_STYLES = [
  'arc',
  'arc_lower',
  'arc_upper',
  'arch',
  'bulge',
  'shell_lower',
  'shell_upper',
  'flag',
  'wave',
  'fish',
  'rise',
  'fisheye',
  'inflate',
  'squeeze',
  'twist',
] as const;

// ---------------------------------------------------------------------------
// Skew
// ---------------------------------------------------------------------------

function bindSkew(transport: TransportRouter): ToolDefinition {
  return {
    tool: {
      name: 'photoshop_skew',
      description:
        'Skew (slant) the ACTIVE LAYER by horizontal and/or vertical angles, anchored at the layer center.\n\n' +
        'Users often say: slant this, italicize the shape, lean it over.\n\n' +
        'horizontalAngle slants along the X axis (top edge shifts right for positive values); ' +
        'verticalAngle slants along the Y axis. One undo reverts it. Raster-only (text/SO auto-rasterized).\n\n' +
        'Returns: { ok, summary, details: { layer_name, horizontal_angle, vertical_angle } }.',
      inputSchema: {
        type: 'object',
        properties: {
          horizontalAngle: {
            type: 'number',
            description: 'Horizontal skew angle in degrees (-89..89, default 0)',
            minimum: -89,
            maximum: 89,
            default: 0,
          },
          verticalAngle: {
            type: 'number',
            description: 'Vertical skew angle in degrees (-89..89, default 0)',
            minimum: -89,
            maximum: 89,
            default: 0,
          },
        },
      },
    },
    handler: async (args) => {
      const h = clampNumber(args.horizontalAngle, -89, 89, 0);
      const v = clampNumber(args.verticalAngle, -89, 89, 0);
      if (h === 0 && v === 0) {
        return toolFailure({
          ok: false,
          code: 'no_op',
          message: 'Provide a non-zero horizontalAngle or verticalAngle to skew.',
        });
      }
      const body = `
        ${ENSURE_RASTER}
        __mcp_skew(${h}, ${v});
        var __layerName = app.activeDocument.activeLayer.name;
        return {
          ok: true,
          summary: 'Skewed ' + __layerName,
          undo_history_states_consumed: 1,
          next_suggested_tool: 'photoshop_get_preview',
          details: { layer_name: __layerName, horizontal_angle: ${h}, vertical_angle: ${v} }
        };
      `;
      return executeTransform(transport, 'Skew Layer', body);
    },
  };
}

// ---------------------------------------------------------------------------
// Distort corners (free distort)
// ---------------------------------------------------------------------------

const POINT_SCHEMA = {
  type: 'object',
  properties: {
    x: { type: 'number', description: 'X in document pixels' },
    y: { type: 'number', description: 'Y in document pixels' },
  },
  required: ['x', 'y'],
} as const;

function bindDistortCorners(transport: TransportRouter): ToolDefinition {
  return {
    tool: {
      name: 'photoshop_distort_corners',
      description:
        'Free-distort the ACTIVE LAYER by moving its four corners to absolute document pixel positions.\n\n' +
        'Users often say: warp it into this quad, match this perspective, corner-pin.\n\n' +
        'Corners are given as { x, y } objects in the order topLeft, topRight, bottomRight, bottomLeft. ' +
        'The layer\'s current bounding box is mapped onto the quadrilateral you specify. One undo reverts it. ' +
        'Raster-only (text/SO auto-rasterized).\n\n' +
        'Returns: { ok, summary, details: { layer_name, corners } }.',
      inputSchema: {
        type: 'object',
        properties: {
          topLeft: POINT_SCHEMA,
          topRight: POINT_SCHEMA,
          bottomRight: POINT_SCHEMA,
          bottomLeft: POINT_SCHEMA,
        },
        required: ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'],
      },
    },
    handler: async (args) => {
      const corners = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'].map((k) =>
        readPoint(args[k])
      );
      if (corners.some((c) => c === null)) {
        return toolFailure({
          ok: false,
          code: 'invalid_corners',
          message: 'All four corners (topLeft, topRight, bottomRight, bottomLeft) must be { x, y } objects with numeric x and y.',
        });
      }
      const [tl, tr, br, bl] = corners as Array<{ x: number; y: number }>;
      if (quadIsDegenerate(tl, tr, br, bl)) {
        return toolFailure({
          ok: false,
          code: 'degenerate_quad',
          message:
            'The four corners form a degenerate quad (near-zero area or duplicate points). ' +
            'Provide corners in topLeft, topRight, bottomRight, bottomLeft order that enclose a real area.',
        });
      }
      const body = `
        ${ENSURE_RASTER}
        __mcp_transformCorners(
          { x: ${tl.x}, y: ${tl.y} }, { x: ${tr.x}, y: ${tr.y} },
          { x: ${br.x}, y: ${br.y} }, { x: ${bl.x}, y: ${bl.y} }
        );
        var __layerName = app.activeDocument.activeLayer.name;
        return {
          ok: true,
          summary: 'Distorted ' + __layerName + ' to a custom quad',
          undo_history_states_consumed: 1,
          next_suggested_tool: 'photoshop_get_preview',
          details: {
            layer_name: __layerName,
            corners: {
              topLeft: { x: ${tl.x}, y: ${tl.y} }, topRight: { x: ${tr.x}, y: ${tr.y} },
              bottomRight: { x: ${br.x}, y: ${br.y} }, bottomLeft: { x: ${bl.x}, y: ${bl.y} }
            }
          }
        };
      `;
      return executeTransform(transport, 'Distort Corners', body);
    },
  };
}

// ---------------------------------------------------------------------------
// Perspective
// ---------------------------------------------------------------------------

function bindPerspective(transport: TransportRouter): ToolDefinition {
  return {
    tool: {
      name: 'photoshop_perspective',
      description:
        'Apply a symmetric perspective transform to the ACTIVE LAYER.\n\n' +
        'Users often say: add perspective, make it recede, keystone correction.\n\n' +
        'axis "horizontal" narrows the TOP edge; axis "vertical" narrows the RIGHT edge. ' +
        '`amount` is the percent of the layer width/height to inset that edge (positive narrows, negative widens). ' +
        'One undo reverts it. Raster-only (text/SO auto-rasterized).\n\n' +
        'Returns: { ok, summary, details: { layer_name, axis, amount } }.',
      inputSchema: {
        type: 'object',
        properties: {
          axis: {
            type: 'string',
            description: 'Which pair of edges to converge',
            enum: ['horizontal', 'vertical'],
            default: 'horizontal',
          },
          amount: {
            type: 'number',
            description: 'Edge inset as percent of width/height (-90..90, positive narrows the top/right edge)',
            minimum: -90,
            maximum: 90,
            default: 25,
          },
        },
        required: ['amount'],
      },
    },
    handler: async (args) => {
      const axis = args.axis === 'vertical' ? 'vertical' : 'horizontal';
      const amount = clampNumber(args.amount, -90, 90, 25);
      if (amount === 0) {
        return toolFailure({ ok: false, code: 'no_op', message: 'Provide a non-zero amount to apply perspective.' });
      }
      const body = `
        ${ENSURE_RASTER}
        __mcp_perspective(${JSON.stringify(axis)}, ${amount});
        var __layerName = app.activeDocument.activeLayer.name;
        return {
          ok: true,
          summary: 'Perspective applied to ' + __layerName,
          undo_history_states_consumed: 1,
          next_suggested_tool: 'photoshop_get_preview',
          details: { layer_name: __layerName, axis: ${JSON.stringify(axis)}, amount: ${amount} }
        };
      `;
      return executeTransform(transport, 'Perspective Transform', body);
    },
  };
}

// ---------------------------------------------------------------------------
// Warp (preset styles)
// ---------------------------------------------------------------------------

function bindWarp(transport: TransportRouter): ToolDefinition {
  return {
    tool: {
      name: 'photoshop_warp',
      description:
        'Warp the ACTIVE LAYER with a preset warp style (arc, bulge, flag, wave, twist, …).\n\n' +
        'Users often say: bend the text, wave it, arc this banner, inflate the shape.\n\n' +
        '`style` picks the preset; `bend` (-100..100) sets its strength; `horizontalDistortion` and ' +
        '`verticalDistortion` (-100..100) add perspective distortion. `orientation` flips the warp axis. ' +
        'One undo reverts it. Raster-only (text/SO auto-rasterized).\n\n' +
        `Styles: ${WARP_STYLES.join(', ')}.\n\n` +
        'Returns: { ok, summary, details: { layer_name, style, bend, horizontal_distortion, vertical_distortion, orientation } }.',
      inputSchema: {
        type: 'object',
        properties: {
          style: {
            type: 'string',
            description: 'Warp preset style',
            enum: WARP_STYLES as unknown as string[],
            default: 'arc',
          },
          bend: {
            type: 'number',
            description: 'Bend strength percent (-100..100, default 50)',
            minimum: -100,
            maximum: 100,
            default: 50,
          },
          horizontalDistortion: {
            type: 'number',
            description: 'Horizontal (perspective) distortion (-100..100, default 0)',
            minimum: -100,
            maximum: 100,
            default: 0,
          },
          verticalDistortion: {
            type: 'number',
            description: 'Vertical (perspective) distortion (-100..100, default 0)',
            minimum: -100,
            maximum: 100,
            default: 0,
          },
          orientation: {
            type: 'string',
            description: 'Warp axis orientation',
            enum: ['horizontal', 'vertical'],
            default: 'horizontal',
          },
        },
        required: ['style'],
      },
    },
    handler: async (args) => {
      const style = (WARP_STYLES as readonly string[]).includes(String(args.style))
        ? String(args.style)
        : 'arc';
      const bend = clampNumber(args.bend, -100, 100, 50);
      const hDistort = clampNumber(args.horizontalDistortion, -100, 100, 0);
      const vDistort = clampNumber(args.verticalDistortion, -100, 100, 0);
      const orientation = args.orientation === 'vertical' ? 'vertical' : 'horizontal';
      const body = `
        ${ENSURE_RASTER}
        __mcp_warp(${JSON.stringify(style)}, ${bend}, ${hDistort}, ${vDistort}, ${JSON.stringify(orientation)});
        var __layerName = app.activeDocument.activeLayer.name;
        return {
          ok: true,
          summary: 'Warp (${style}) applied to ' + __layerName,
          undo_history_states_consumed: 1,
          next_suggested_tool: 'photoshop_get_preview',
          details: {
            layer_name: __layerName, style: ${JSON.stringify(style)}, bend: ${bend},
            horizontal_distortion: ${hDistort}, vertical_distortion: ${vDistort},
            orientation: ${JSON.stringify(orientation)}
          }
        };
      `;
      return executeTransform(transport, 'Warp Layer', body);
    },
  };
}

// ---------------------------------------------------------------------------
// Free transform (combined scale / rotate / skew)
// ---------------------------------------------------------------------------

function bindFreeTransform(transport: TransportRouter): ToolDefinition {
  return {
    tool: {
      name: 'photoshop_free_transform',
      description:
        'Combined free transform of the ACTIVE LAYER: scale (percent), rotate (degrees), and skew (h/v degrees) ' +
        'in ONE call, anchored at the layer center.\n\n' +
        'Users often say: scale to 80% and rotate 15, resize and tilt in one step.\n\n' +
        'scaleX/scaleY are percentages (100 = unchanged). angle rotates clockwise. skewHorizontal/skewVertical ' +
        'slant the layer. One undo reverts the whole transform. Raster-only (text/SO auto-rasterized).\n\n' +
        'Returns: { ok, summary, details: { layer_name, scale_x, scale_y, angle, skew_horizontal, skew_vertical } }.',
      inputSchema: {
        type: 'object',
        properties: {
          scaleX: {
            type: 'number',
            description: 'Horizontal scale percent (1-10000, default 100)',
            minimum: 1,
            maximum: 10000,
            default: 100,
          },
          scaleY: {
            type: 'number',
            description: 'Vertical scale percent (1-10000, default 100)',
            minimum: 1,
            maximum: 10000,
            default: 100,
          },
          angle: {
            type: 'number',
            description: 'Rotation in degrees (-360..360, default 0)',
            minimum: -360,
            maximum: 360,
            default: 0,
          },
          skewHorizontal: {
            type: 'number',
            description: 'Horizontal skew in degrees (-89..89, default 0)',
            minimum: -89,
            maximum: 89,
            default: 0,
          },
          skewVertical: {
            type: 'number',
            description: 'Vertical skew in degrees (-89..89, default 0)',
            minimum: -89,
            maximum: 89,
            default: 0,
          },
        },
      },
    },
    handler: async (args) => {
      const scaleX = clampNumber(args.scaleX, 1, 10000, 100);
      const scaleY = clampNumber(args.scaleY, 1, 10000, 100);
      const angle = clampNumber(args.angle, -360, 360, 0);
      const skewH = clampNumber(args.skewHorizontal, -89, 89, 0);
      const skewV = clampNumber(args.skewVertical, -89, 89, 0);
      if (scaleX === 100 && scaleY === 100 && angle === 0 && skewH === 0 && skewV === 0) {
        return toolFailure({
          ok: false,
          code: 'no_op',
          message: 'Provide at least one non-identity value (scale != 100, angle != 0, or a skew).',
        });
      }
      const body = `
        ${ENSURE_RASTER}
        __mcp_freeTransform(${scaleX}, ${scaleY}, ${angle}, ${skewH}, ${skewV});
        var __layerName = app.activeDocument.activeLayer.name;
        return {
          ok: true,
          summary: 'Free transform applied to ' + __layerName,
          undo_history_states_consumed: 1,
          next_suggested_tool: 'photoshop_get_preview',
          details: {
            layer_name: __layerName, scale_x: ${scaleX}, scale_y: ${scaleY},
            angle: ${angle}, skew_horizontal: ${skewH}, skew_vertical: ${skewV}
          }
        };
      `;
      return executeTransform(transport, 'Free Transform', body);
    },
  };
}

// ---------------------------------------------------------------------------
// Shared execution
// ---------------------------------------------------------------------------

/** Prepend the transform helper block, then run through the shared recipe executor. */
function executeTransform(
  transport: TransportRouter,
  historyName: string,
  body: string
): Promise<ToolResult> {
  return executeRecipe(transport, historyName, `${MCP_TRANSFORM_EXTRA_HELPER}\n${body}`);
}

/** Parse a { x, y } point object; returns null if malformed. */
function readPoint(value: unknown): { x: number; y: number } | null {
  if (!value || typeof value !== 'object') return null;
  const rec = value as Record<string, unknown>;
  if (typeof rec.x !== 'number' || typeof rec.y !== 'number') return null;
  if (!Number.isFinite(rec.x) || !Number.isFinite(rec.y)) return null;
  return { x: rec.x, y: rec.y };
}

type Pt = { x: number; y: number };

/**
 * Reject a corner quad that Photoshop can't distort onto: duplicate corners, or a polygon
 * whose area is negligible relative to its bounding box (collinear / collapsed). Ordered
 * TL, TR, BR, BL; area via the shoelace formula.
 */
function quadIsDegenerate(tl: Pt, tr: Pt, br: Pt, bl: Pt): boolean {
  const pts = [tl, tr, br, bl];
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      if (pts[i].x === pts[j].x && pts[i].y === pts[j].y) return true;
    }
  }
  const area =
    Math.abs(
      tl.x * tr.y - tr.x * tl.y +
      tr.x * br.y - br.x * tr.y +
      br.x * bl.y - bl.x * br.y +
      bl.x * tl.y - tl.x * bl.y
    ) / 2;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const bboxArea = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
  // Collapsed if the polygon covers < 1% of its bounding box (near-collinear corners).
  return bboxArea <= 0 || area < bboxArea * 0.01;
}
