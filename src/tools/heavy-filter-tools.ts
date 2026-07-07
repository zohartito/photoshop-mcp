import type { ToolDefinition, ToolResult } from '../core/tool-registry.js';
import type { TransportRouter } from '../transport/index.js';
import { MCP_HEAVY_FILTER_HELPERS } from '../api/extendscript.js';
import { executeRecipe } from './recipes/_shared.js';

/**
 * Tier-2 "heavy filter" tools: Camera Raw Filter, Lighting Effects, Lens Correction, Liquify.
 *
 * Each tool drives a heavy filter on the ACTIVE LAYER via the Action Manager, wrapped in a single
 * suspendHistory step (one-undo) and returning the standard
 * `{ ok, summary, undo_history_states_consumed, next_suggested_tool, details }` envelope.
 *
 * Raster-only: text/smart-object layers are auto-rasterized; layer groups throw a clear error
 * (via __mcp_ensureRasterActiveLayer). ACR and Lighting Effects additionally require RGB.
 *
 * SCRIPTABILITY (honest matrix — see docs/tools/heavy-filters.md):
 *  - Lens Correction: FULLY WORKING (documented AM keys).
 *  - Camera Raw Filter: WORKING invocation; per-adjustment keys are PV2012 recorded keys.
 *    Vibrance/Contrast confirmed; others flagged for live verification.
 *  - Liquify: saved-mesh apply + open-dialog only. The forward-warp brush is NOT scriptable;
 *    we do not fake it.
 *  - Lighting Effects: BEST-EFFORT. The modern GPU rewrite is not reliably recordable; the tool
 *    attempts the legacy event and returns a clear error if unavailable.
 */

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Prepend the heavy-filter helper block, then run through the shared recipe executor. */
function executeHeavyFilter(
  transport: TransportRouter,
  historyName: string,
  body: string
): Promise<ToolResult> {
  return executeRecipe(transport, historyName, `${MCP_HEAVY_FILTER_HELPERS}\n${body}`);
}

/** Serialize a flat object of already-validated params to an ExtendScript object literal. */
function toJsObjectLiteral(obj: Record<string, number | string | boolean>): string {
  const pairs = Object.entries(obj).map(([k, v]) => {
    const literal =
      typeof v === 'number' || typeof v === 'boolean' ? String(v) : JSON.stringify(v);
    return `${JSON.stringify(k)}: ${literal}`;
  });
  return `{ ${pairs.join(', ')} }`;
}

/** Coerce + clamp an optional number; returns undefined when absent so the descriptor omits it. */
function optNum(raw: unknown, min: number, max: number): number | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined;
  return Math.max(min, Math.min(max, raw));
}

/** Coerce an optional boolean; returns undefined when absent. */
function optBool(raw: unknown): boolean | undefined {
  return typeof raw === 'boolean' ? raw : undefined;
}

/** Collect only the defined entries from a spec of {key: value|undefined} into a params object. */
function collectDefined(
  entries: Record<string, number | string | boolean | undefined>
): Record<string, number | string | boolean> {
  const out: Record<string, number | string | boolean> = {};
  for (const [k, v] of Object.entries(entries)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

export function createHeavyFilterTools(transport: TransportRouter): ToolDefinition[] {
  return [
    bindCameraRawFilter(transport),
    bindLightingEffects(transport),
    bindLensCorrection(transport),
    bindLiquify(transport),
  ];
}

export const PHOTOSHOP_HEAVY_FILTER_TOOL_NAMES = [
  'photoshop_apply_camera_raw_filter',
  'photoshop_apply_lighting_effects',
  'photoshop_apply_lens_correction',
  'photoshop_apply_liquify',
] as const;

// ---------------------------------------------------------------------------
// Camera Raw Filter
// ---------------------------------------------------------------------------

function bindCameraRawFilter(transport: TransportRouter): ToolDefinition {
  return {
    tool: {
      name: 'photoshop_apply_camera_raw_filter',
      description:
        'Apply the Camera Raw Filter (Filter > Camera Raw Filter) to the ACTIVE LAYER — the ' +
        'photographer-grade tone + color engine (white balance, tone, presence, detail).\n\n' +
        'Users often say: warm it up, recover the highlights, lift the shadows, add clarity, ' +
        'dehaze, punch the contrast, make it pop like Lightroom.\n\n' +
        'Pass only the adjustments you want to change — every param is OPTIONAL and unset ones keep ' +
        'their neutral default. Process version is forced to PV2012.\n\n' +
        'PARAMS: temperature(-100..100), tint(-100..100), exposure(-5..5 stops), contrast(-100..100), ' +
        'highlights(-100..100), shadows(-100..100), whites(-100..100), blacks(-100..100), ' +
        'clarity(-100..100), dehaze(-100..100), vibrance(-100..100), saturation(-100..100), ' +
        'sharpenAmount(0..150).\n\n' +
        'Raster-only (text/smart objects auto-rasterized; groups error). Requires an RGB document. ' +
        'One undo reverts the whole filter. NOTE: applied destructively to pixels (bake). ' +
        'Vibrance/Contrast are confirmed-working keys; the remaining PV2012 keys are documented but ' +
        'flagged for live verification (see docs/tools/heavy-filters.md).\n\n' +
        'Returns: { ok, summary, undo_history_states_consumed, next_suggested_tool, details: ' +
        '{ layer_name, applied } }.',
      inputSchema: {
        type: 'object',
        properties: {
          temperature: { type: 'number', description: 'White-balance temperature (-100 cooler .. 100 warmer)', minimum: -100, maximum: 100 },
          tint: { type: 'number', description: 'White-balance tint (-100 green .. 100 magenta)', minimum: -100, maximum: 100 },
          exposure: { type: 'number', description: 'Exposure in stops (-5 .. 5)', minimum: -5, maximum: 5 },
          contrast: { type: 'number', description: 'Contrast (-100 .. 100)', minimum: -100, maximum: 100 },
          highlights: { type: 'number', description: 'Highlights (-100 recover .. 100 boost)', minimum: -100, maximum: 100 },
          shadows: { type: 'number', description: 'Shadows (-100 .. 100 lift)', minimum: -100, maximum: 100 },
          whites: { type: 'number', description: 'Whites (-100 .. 100)', minimum: -100, maximum: 100 },
          blacks: { type: 'number', description: 'Blacks (-100 .. 100)', minimum: -100, maximum: 100 },
          clarity: { type: 'number', description: 'Clarity / midtone contrast (-100 .. 100)', minimum: -100, maximum: 100 },
          dehaze: { type: 'number', description: 'Dehaze (-100 .. 100)', minimum: -100, maximum: 100 },
          vibrance: { type: 'number', description: 'Vibrance (-100 .. 100)', minimum: -100, maximum: 100 },
          saturation: { type: 'number', description: 'Saturation (-100 .. 100)', minimum: -100, maximum: 100 },
          sharpenAmount: { type: 'number', description: 'Sharpening amount (0 .. 150)', minimum: 0, maximum: 150 },
        },
      },
    },
    handler: async (args) => applyCameraRawFilter(transport, args),
  };
}

async function applyCameraRawFilter(
  transport: TransportRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const params = collectDefined({
    temperature: optNum(args.temperature, -100, 100),
    tint: optNum(args.tint, -100, 100),
    exposure: optNum(args.exposure, -5, 5),
    contrast: optNum(args.contrast, -100, 100),
    highlights: optNum(args.highlights, -100, 100),
    shadows: optNum(args.shadows, -100, 100),
    whites: optNum(args.whites, -100, 100),
    blacks: optNum(args.blacks, -100, 100),
    clarity: optNum(args.clarity, -100, 100),
    dehaze: optNum(args.dehaze, -100, 100),
    vibrance: optNum(args.vibrance, -100, 100),
    saturation: optNum(args.saturation, -100, 100),
    sharpenAmount: optNum(args.sharpenAmount, 0, 150),
  });

  const paramsLiteral = toJsObjectLiteral(params);
  const body = `
    var __params = ${paramsLiteral};
    var __layerName = __mcp_applyCameraRawFilter(__params);
    return {
      ok: true,
      summary: 'Camera Raw Filter applied to ' + __layerName,
      undo_history_states_consumed: 1,
      next_suggested_tool: 'photoshop_get_preview',
      details: { layer_name: __layerName, applied: __params }
    };
  `;
  return executeHeavyFilter(transport, 'Apply Camera Raw Filter', body);
}

// ---------------------------------------------------------------------------
// Lighting Effects (best-effort)
// ---------------------------------------------------------------------------

function bindLightingEffects(transport: TransportRouter): ToolDefinition {
  return {
    tool: {
      name: 'photoshop_apply_lighting_effects',
      description:
        'Apply Render > Lighting Effects to the ACTIVE LAYER (a single light: type, intensity, color).\n\n' +
        'BEST-EFFORT / MAY NOT WORK ON YOUR BUILD: the modern (CC 2015+) GPU Lighting Effects gallery ' +
        'is not reliably recordable via the Action Manager. This tool attempts the legacy lighting ' +
        'event; if that event is absent it returns a clear error telling you to run Filter > Render > ' +
        'Lighting Effects manually. It never reports a fake success.\n\n' +
        'PARAMS: lightType(spot|omni|directional, default spot), intensity(-100..100, default 35), ' +
        'red/green/blue(0..255, default white light 255/255/255).\n\n' +
        'Raster-only (text/smart objects auto-rasterized; groups error). Requires an RGB document. ' +
        'One undo reverts it.\n\n' +
        'Returns: { ok, summary, undo_history_states_consumed, next_suggested_tool, details } ' +
        'on success, or { ok:false, code, message } when the filter is not scriptable in this build.',
      inputSchema: {
        type: 'object',
        properties: {
          lightType: { type: 'string', description: 'Light type', enum: ['spot', 'omni', 'directional'] },
          intensity: { type: 'number', description: 'Light intensity (-100 .. 100)', minimum: -100, maximum: 100 },
          red: { type: 'number', description: 'Light color red (0 .. 255)', minimum: 0, maximum: 255 },
          green: { type: 'number', description: 'Light color green (0 .. 255)', minimum: 0, maximum: 255 },
          blue: { type: 'number', description: 'Light color blue (0 .. 255)', minimum: 0, maximum: 255 },
        },
      },
    },
    handler: async (args) => applyLightingEffects(transport, args),
  };
}

async function applyLightingEffects(
  transport: TransportRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const lightTypeRaw = typeof args.lightType === 'string' ? args.lightType : 'spot';
  const lightType = ['spot', 'omni', 'directional'].includes(lightTypeRaw) ? lightTypeRaw : 'spot';
  const params = {
    lightType,
    intensity: optNum(args.intensity, -100, 100) ?? 35,
    red: optNum(args.red, 0, 255) ?? 255,
    green: optNum(args.green, 0, 255) ?? 255,
    blue: optNum(args.blue, 0, 255) ?? 255,
  };

  const paramsLiteral = toJsObjectLiteral(params);
  const body = `
    var __params = ${paramsLiteral};
    var __layerName = __mcp_applyLightingEffects(__params);
    return {
      ok: true,
      summary: 'Lighting Effects applied to ' + __layerName,
      undo_history_states_consumed: 1,
      next_suggested_tool: 'photoshop_get_preview',
      details: { layer_name: __layerName, applied: __params }
    };
  `;
  return executeHeavyFilter(transport, 'Apply Lighting Effects', body);
}

// ---------------------------------------------------------------------------
// Lens Correction (fully working)
// ---------------------------------------------------------------------------

function bindLensCorrection(transport: TransportRouter): ToolDefinition {
  return {
    tool: {
      name: 'photoshop_apply_lens_correction',
      description:
        'Apply Filter > Lens Correction to the ACTIVE LAYER — geometric distortion, vignette, ' +
        'perspective and rotation correction.\n\n' +
        'Users often say: fix the barrel/pincushion distortion, remove the dark corners, ' +
        'straighten the perspective, de-fisheye.\n\n' +
        'Pass only what you want to change — every param is OPTIONAL. Combine auto toggles ' +
        '(autoDistortion etc.) with manual amounts.\n\n' +
        'PARAMS (manual): distortionAmount(-100 pincushion .. 100 barrel), vignetteAmount(-100 darken .. 100 lighten), ' +
        'vignetteMidpoint(0..100), verticalPerspective(-100..100), horizontalPerspective(-100..100), ' +
        'rotationAngle(-180..180), scale(0..200), edgeFill(edge_extension|transparency|black|white).\n' +
        'PARAMS (auto booleans): autoDistortion, autoChromaticAberration, autoVignette, autoScale.\n\n' +
        'Raster-only (text/smart objects auto-rasterized; groups error). One undo reverts it.\n\n' +
        'Returns: { ok, summary, undo_history_states_consumed, next_suggested_tool, details: ' +
        '{ layer_name, applied } }.',
      inputSchema: {
        type: 'object',
        properties: {
          distortionAmount: { type: 'number', description: 'Geometric distortion (-100 pincushion .. 100 barrel)', minimum: -100, maximum: 100 },
          vignetteAmount: { type: 'number', description: 'Vignette amount (-100 darken .. 100 lighten)', minimum: -100, maximum: 100 },
          vignetteMidpoint: { type: 'number', description: 'Vignette midpoint (0 .. 100)', minimum: 0, maximum: 100 },
          verticalPerspective: { type: 'number', description: 'Vertical perspective (-100 .. 100)', minimum: -100, maximum: 100 },
          horizontalPerspective: { type: 'number', description: 'Horizontal perspective (-100 .. 100)', minimum: -100, maximum: 100 },
          rotationAngle: { type: 'number', description: 'Rotation angle in degrees (-180 .. 180)', minimum: -180, maximum: 180 },
          scale: { type: 'number', description: 'Correction scale percent (0 .. 200)', minimum: 0, maximum: 200 },
          edgeFill: { type: 'string', description: 'How to fill revealed edges after correction', enum: ['edge_extension', 'transparency', 'black', 'white'] },
          autoDistortion: { type: 'boolean', description: 'Auto-correct geometric distortion from the lens profile' },
          autoChromaticAberration: { type: 'boolean', description: 'Auto-correct chromatic aberration' },
          autoVignette: { type: 'boolean', description: 'Auto-correct vignette' },
          autoScale: { type: 'boolean', description: 'Auto-scale the image after correction' },
        },
      },
    },
    handler: async (args) => applyLensCorrection(transport, args),
  };
}

async function applyLensCorrection(
  transport: TransportRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const params = collectDefined({
    distortionAmount: optNum(args.distortionAmount, -100, 100),
    vignetteAmount: optNum(args.vignetteAmount, -100, 100),
    vignetteMidpoint: optNum(args.vignetteMidpoint, 0, 100),
    verticalPerspective: optNum(args.verticalPerspective, -100, 100),
    horizontalPerspective: optNum(args.horizontalPerspective, -100, 100),
    rotationAngle: optNum(args.rotationAngle, -180, 180),
    scale: optNum(args.scale, 0, 200),
    edgeFill:
      typeof args.edgeFill === 'string' &&
      ['edge_extension', 'transparency', 'black', 'white'].includes(args.edgeFill)
        ? args.edgeFill
        : undefined,
    autoDistortion: optBool(args.autoDistortion),
    autoChromaticAberration: optBool(args.autoChromaticAberration),
    autoVignette: optBool(args.autoVignette),
    autoScale: optBool(args.autoScale),
  });

  const paramsLiteral = toJsObjectLiteral(params);
  const body = `
    var __params = ${paramsLiteral};
    var __layerName = __mcp_applyLensCorrection(__params);
    return {
      ok: true,
      summary: 'Lens Correction applied to ' + __layerName,
      undo_history_states_consumed: 1,
      next_suggested_tool: 'photoshop_get_preview',
      details: { layer_name: __layerName, applied: __params }
    };
  `;
  return executeHeavyFilter(transport, 'Apply Lens Correction', body);
}

// ---------------------------------------------------------------------------
// Liquify (saved-mesh apply + open-dialog only; forward-warp NOT scriptable)
// ---------------------------------------------------------------------------

function bindLiquify(transport: TransportRouter): ToolDefinition {
  return {
    tool: {
      name: 'photoshop_apply_liquify',
      description:
        'Liquify on the ACTIVE LAYER. IMPORTANT — the interactive forward-warp / push / bloat / ' +
        'pucker brushes are NOT scriptable in Photoshop; there is no Action Manager path to paint a ' +
        'warp headlessly. This tool exposes the two things that ARE reachable:\n\n' +
        '  mode="apply_mesh"  — apply a PREVIOUSLY SAVED Liquify mesh file (.msh/.psp) to the layer, ' +
        'fully headless. Requires meshPath to an existing file (save one via the Liquify dialog: ' +
        'Liquify > Save Mesh). This genuinely warps the pixels.\n' +
        '  mode="dialog"      — open the interactive Liquify dialog so a HUMAN can warp by hand. ' +
        'This is NOT automation — Photoshop blocks until the user clicks OK/Cancel.\n\n' +
        'There is deliberately no "warp with these brush strokes" mode because Photoshop does not ' +
        'support it — do not expect one.\n\n' +
        'PARAMS: mode(apply_mesh|dialog, default dialog), meshPath(absolute path, required for apply_mesh).\n\n' +
        'Raster-only (text/smart objects auto-rasterized; groups error). One undo reverts it.\n\n' +
        'Returns: { ok, summary, undo_history_states_consumed, next_suggested_tool, details } or ' +
        '{ ok:false, code, message } (e.g. mesh file missing).',
      inputSchema: {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            description: 'apply_mesh = apply a saved mesh file headlessly; dialog = open the interactive dialog for manual warping',
            enum: ['apply_mesh', 'dialog'],
          },
          meshPath: {
            type: 'string',
            description: 'Absolute path to a saved Liquify mesh file (.msh/.psp). Required when mode="apply_mesh".',
          },
        },
      },
    },
    handler: async (args) => applyLiquify(transport, args),
  };
}

async function applyLiquify(
  transport: TransportRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const mode = args.mode === 'apply_mesh' ? 'apply_mesh' : 'dialog';

  if (mode === 'apply_mesh') {
    const meshPath = typeof args.meshPath === 'string' ? args.meshPath.trim() : '';
    if (!meshPath) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                ok: false,
                code: 'missing_mesh_path',
                message:
                  'mode="apply_mesh" requires meshPath pointing to a saved Liquify mesh file. ' +
                  'Save one from the Liquify dialog (Liquify > Save Mesh), or use mode="dialog" to warp interactively.',
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }
    const body = `
      var __meshPath = ${JSON.stringify(meshPath)};
      var __layerName = __mcp_applyLiquifyMesh(__meshPath);
      return {
        ok: true,
        summary: 'Liquify mesh applied to ' + __layerName,
        undo_history_states_consumed: 1,
        next_suggested_tool: 'photoshop_get_preview',
        details: { layer_name: __layerName, mode: 'apply_mesh', mesh_path: __meshPath }
      };
    `;
    return executeHeavyFilter(transport, 'Apply Liquify Mesh', body);
  }

  // dialog mode — opens interactive Liquify; blocks on the user.
  const body = `
    var __layerName = __mcp_openLiquifyDialog();
    return {
      ok: true,
      summary: 'Opened the Liquify dialog on ' + __layerName + ' for manual warping',
      undo_history_states_consumed: 1,
      next_suggested_tool: 'photoshop_get_preview',
      details: { layer_name: __layerName, mode: 'dialog' }
    };
  `;
  return executeHeavyFilter(transport, 'Open Liquify Dialog', body);
}
