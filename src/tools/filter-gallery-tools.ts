import type { ToolDefinition, ToolResult } from '../core/tool-registry.js';
import type { TransportRouter } from '../transport/index.js';
import { MCP_FILTER_GALLERY_HELPER } from '../api/extendscript.js';
import { executeRecipe, toolFailure } from './recipes/_shared.js';

/**
 * Generic Filter Gallery tool: `photoshop_apply_filter`.
 *
 * One tool, a `filter` enum selecting the effect, plus per-filter numeric/string
 * params. Covers the Distort / Stylize / Pixelate / Render / Blur DOM `apply*`
 * methods (and a few AM-only filters) that have NO dedicated tool in this fork.
 *
 * Each filter is applied to the ACTIVE LAYER through the shared recipe executor,
 * so every call is a single one-undo `suspendHistory` step and returns the
 * `{ ok, summary, undo_history_states_consumed, next_suggested_tool, details }`
 * envelope. Raster-only: text/smart-object layers are auto-rasterized; layer
 * groups throw a clear error (same contract as the existing filter tools).
 */

// ---------------------------------------------------------------------------
// Per-filter parameter specs. Each entry lists its params with [min, max, default].
// A `null` default means the param is required (no default supplied).
// ---------------------------------------------------------------------------

type NumSpec = { kind: 'number'; min: number; max: number; default: number | null; description: string };
type EnumSpec = { kind: 'enum'; values: string[]; default: string; description: string };
type ParamSpec = NumSpec | EnumSpec;

function num(min: number, max: number, def: number | null, description: string): NumSpec {
  return { kind: 'number', min, max, default: def, description };
}
function enm(values: string[], def: string, description: string): EnumSpec {
  return { kind: 'enum', values, default: def, description };
}

interface FilterSpec {
  category: 'Distort' | 'Stylize' | 'Pixelate' | 'Render' | 'Blur';
  summary: string;
  params: Record<string, ParamSpec>;
}

const FILTERS: Record<string, FilterSpec> = {
  // --- Distort ---
  twirl: {
    category: 'Distort',
    summary: 'Twirl',
    params: { angle: num(-999, 999, 50, 'Twirl angle in degrees (-999..999)') },
  },
  wave: {
    category: 'Distort',
    summary: 'Wave',
    params: {
      generators: num(1, 999, 5, 'Number of wave generators'),
      minWavelength: num(1, 998, 10, 'Minimum wavelength'),
      maxWavelength: num(2, 999, 120, 'Maximum wavelength (>= minWavelength)'),
      minAmplitude: num(1, 998, 5, 'Minimum amplitude'),
      maxAmplitude: num(2, 999, 35, 'Maximum amplitude (>= minAmplitude)'),
      waveType: enm(['sine', 'triangle', 'square'], 'sine', 'Wave shape'),
    },
  },
  ripple: {
    category: 'Distort',
    summary: 'Ripple',
    params: {
      amount: num(-999, 999, 100, 'Ripple amount (-999..999)'),
      size: enm(['small', 'medium', 'large'], 'medium', 'Ripple size'),
    },
  },
  pinch: {
    category: 'Distort',
    summary: 'Pinch',
    params: { amount: num(-100, 100, 50, 'Pinch amount percent (-100 bulge .. 100 pinch)') },
  },
  spherize: {
    category: 'Distort',
    summary: 'Spherize',
    params: {
      amount: num(-100, 100, 100, 'Spherize amount percent (-100..100)'),
      mode: enm(['normal', 'horizontal', 'vertical'], 'normal', 'Spherize mode'),
    },
  },
  polar_coordinates: {
    category: 'Distort',
    summary: 'Polar Coordinates',
    params: {
      conversion: enm(['rect_to_polar', 'polar_to_rect'], 'rect_to_polar', 'Conversion direction'),
    },
  },
  zigzag: {
    category: 'Distort',
    summary: 'ZigZag',
    params: {
      amount: num(-100, 100, 10, 'ZigZag amount (-100..100)'),
      ridges: num(0, 20, 5, 'Number of ridges'),
      style: enm(['around_center', 'out_from_center', 'pond_ripples'], 'pond_ripples', 'ZigZag style'),
    },
  },
  ocean_ripple: {
    category: 'Distort',
    summary: 'Ocean Ripple',
    params: {
      size: num(1, 15, 9, 'Ripple size (1-15)'),
      magnitude: num(0, 20, 10, 'Ripple magnitude (0-20)'),
    },
  },
  glass: {
    category: 'Distort',
    summary: 'Glass',
    params: {
      distortion: num(0, 20, 5, 'Distortion (0-20)'),
      smoothness: num(1, 15, 3, 'Smoothness (1-15)'),
    },
  },
  shear: {
    category: 'Distort',
    summary: 'Shear',
    params: { offset: num(-255, 255, 30, 'Horizontal shear offset in px at the bottom edge (-255..255)') },
  },

  // --- Stylize ---
  glowing_edges: {
    category: 'Stylize',
    summary: 'Glowing Edges',
    params: {
      edgeWidth: num(1, 14, 2, 'Edge width (1-14)'),
      edgeBrightness: num(0, 20, 6, 'Edge brightness (0-20)'),
      smoothness: num(1, 15, 5, 'Smoothness (1-15)'),
    },
  },
  emboss: {
    category: 'Stylize',
    summary: 'Emboss',
    params: {
      angle: num(-360, 360, 135, 'Light angle in degrees (-360..360)'),
      height: num(1, 100, 3, 'Emboss height in px (1-100)'),
      amount: num(1, 500, 100, 'Amount percent (1-500)'),
    },
  },
  diffuse_glow: {
    category: 'Stylize',
    summary: 'Diffuse Glow',
    params: {
      graininess: num(0, 10, 6, 'Graininess (0-10)'),
      glowAmount: num(0, 20, 10, 'Glow amount (0-20)'),
      clearAmount: num(0, 20, 15, 'Clear amount (0-20)'),
    },
  },
  find_edges: { category: 'Stylize', summary: 'Find Edges', params: {} },
  solarize: { category: 'Stylize', summary: 'Solarize', params: {} },

  // --- Pixelate ---
  crystallize: {
    category: 'Pixelate',
    summary: 'Crystallize',
    params: { cellSize: num(3, 300, 10, 'Cell size (3-300)') },
  },
  mosaic: {
    category: 'Pixelate',
    summary: 'Mosaic',
    params: { cellSize: num(2, 200, 10, 'Cell size in px (2-200)') },
  },
  pointillize: {
    category: 'Pixelate',
    summary: 'Pointillize',
    params: { cellSize: num(3, 300, 5, 'Cell size (3-300)') },
  },
  facet: { category: 'Pixelate', summary: 'Facet', params: {} },

  // --- Render ---
  lens_flare: {
    category: 'Render',
    summary: 'Lens Flare',
    params: {
      brightness: num(10, 300, 100, 'Flare brightness percent (10-300)'),
      positionX: num(0, 100, 50, 'Flare center X as percent of layer width (0-100)'),
      positionY: num(0, 100, 50, 'Flare center Y as percent of layer height (0-100)'),
      lensType: enm(['zoom', 'prime35', 'prime105', 'movie'], 'zoom', 'Lens type'),
    },
  },
  difference_clouds: { category: 'Render', summary: 'Difference Clouds', params: {} },
  clouds: { category: 'Render', summary: 'Clouds', params: {} },

  // --- Blur (variants not already dedicated) ---
  smart_blur: {
    category: 'Blur',
    summary: 'Smart Blur',
    params: {
      radius: num(0.1, 100, 5, 'Radius in px (0.1-100)'),
      threshold: num(0.1, 100, 25, 'Threshold (0.1-100)'),
    },
  },
  radial_blur: {
    category: 'Blur',
    summary: 'Radial Blur',
    params: {
      amount: num(1, 100, 10, 'Amount (1-100)'),
      method: enm(['spin', 'zoom'], 'spin', 'Blur method'),
    },
  },
  lens_blur: {
    category: 'Blur',
    summary: 'Lens Blur',
    params: {
      radius: num(0, 100, 15, 'Iris radius in px (0-100)'),
      brightness: num(0, 100, 0, 'Specular highlight brightness (0-100)'),
      threshold: num(0, 255, 255, 'Specular highlight threshold (0-255)'),
    },
  },
  surface_blur: {
    category: 'Blur',
    summary: 'Surface Blur',
    params: {
      radius: num(1, 100, 5, 'Radius in px (1-100)'),
      threshold: num(1, 255, 15, 'Threshold (1-255)'),
    },
  },
  box_blur: {
    category: 'Blur',
    summary: 'Box Blur',
    params: { radius: num(1, 999, 10, 'Radius in px (1-999)') },
  },
  shape_blur: {
    category: 'Blur',
    summary: 'Shape Blur',
    params: { radius: num(1, 1000, 20, 'Radius in px (1-1000)') },
  },
};

const FILTER_NAMES = Object.keys(FILTERS);

/** Build the human-readable filter catalogue for the tool description. */
function buildFilterCatalogue(): string {
  const byCategory = new Map<string, string[]>();
  for (const [name, spec] of Object.entries(FILTERS)) {
    const paramList = Object.entries(spec.params)
      .map(([pName, p]) =>
        p.kind === 'enum' ? `${pName}(${p.values.join('|')})` : pName
      )
      .join(', ');
    const line = paramList ? `${name}: ${paramList}` : `${name}`;
    const arr = byCategory.get(spec.category) ?? [];
    arr.push(line);
    byCategory.set(spec.category, arr);
  }
  const order = ['Distort', 'Stylize', 'Pixelate', 'Render', 'Blur'];
  return order
    .map((cat) => `  ${cat}: ` + (byCategory.get(cat) ?? []).join('; '))
    .join('\n');
}

export function createFilterGalleryTools(transport: TransportRouter): ToolDefinition[] {
  return [bindApplyFilter(transport)];
}

export const PHOTOSHOP_FILTER_GALLERY_TOOL_NAMES = ['photoshop_apply_filter'] as const;

function bindApplyFilter(transport: TransportRouter): ToolDefinition {
  return {
    tool: {
      name: 'photoshop_apply_filter',
      description:
        'Apply one Photoshop filter (Distort / Stylize / Pixelate / Render / Blur) to the ACTIVE LAYER.\n\n' +
        'Pick the effect with `filter`, then pass that filter\'s params (extra params for other filters are ignored). ' +
        'Only these filters — the ones with no dedicated tool — are covered here; Gaussian Blur, Motion Blur, ' +
        'Unsharp Mask and Add Noise have their own `photoshop_apply_*` tools.\n\n' +
        'Raster-only: text and smart-object layers are auto-rasterized first; layer groups throw a clear error. ' +
        'One undo reverts the whole filter.\n\n' +
        'FILTERS AND THEIR PARAMS:\n' +
        buildFilterCatalogue() +
        '\n\nAll numeric params are clamped to their valid range. Returns: ' +
        '{ ok, summary, undo_history_states_consumed, next_suggested_tool, details: { filter, category, layer_name, params } }.',
      inputSchema: {
        type: 'object',
        properties: buildInputSchemaProperties(),
        required: ['filter'],
      },
    },
    handler: async (args) => applyFilter(transport, args),
  };
}

/** Union all per-filter params into one flat schema (JSON Schema has no clean discriminated union). */
function buildInputSchemaProperties(): Record<string, object> {
  const props: Record<string, object> = {
    filter: {
      type: 'string',
      description: 'Which filter to apply',
      enum: FILTER_NAMES,
    },
  };
  for (const spec of Object.values(FILTERS)) {
    for (const [pName, p] of Object.entries(spec.params)) {
      if (props[pName]) continue; // first definition wins; ranges are per-filter re-validated in the handler
      if (p.kind === 'number') {
        const schema: Record<string, unknown> = { type: 'number', description: p.description };
        if (Number.isFinite(p.min)) schema.minimum = p.min;
        if (Number.isFinite(p.max)) schema.maximum = p.max;
        props[pName] = schema;
      } else {
        props[pName] = { type: 'string', description: p.description, enum: p.values };
      }
    }
  }
  return props;
}

/** Coerce and clamp one param per its spec; returns the JS-literal-safe resolved value. */
function resolveParam(spec: ParamSpec, raw: unknown): number | string {
  if (spec.kind === 'number') {
    const fallback = spec.default ?? spec.min;
    return clampNumber(raw, spec.min, spec.max, fallback);
  }
  const value = typeof raw === 'string' && spec.values.includes(raw) ? raw : spec.default;
  return value;
}

/** Like clampInt but keeps fractional precision (needed for blur radii, thresholds). */
function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

async function applyFilter(
  transport: TransportRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const filter = String(args.filter ?? '');
  const spec = FILTERS[filter];
  if (!spec) {
    return toolFailure({
      ok: false,
      code: 'unknown_filter',
      message: `Unknown filter "${filter}". Valid filters: ${FILTER_NAMES.join(', ')}`,
    });
  }

  // Resolve every param this filter needs, clamping to its per-filter range.
  const resolved: Record<string, number | string> = {};
  for (const [pName, pSpec] of Object.entries(spec.params)) {
    resolved[pName] = resolveParam(pSpec, args[pName]);
  }

  // Enforce ordered wavelength/amplitude pairs for Wave so the descriptor never inverts.
  if (filter === 'wave') {
    if ((resolved.maxWavelength as number) < (resolved.minWavelength as number)) {
      resolved.maxWavelength = resolved.minWavelength;
    }
    if ((resolved.maxAmplitude as number) < (resolved.minAmplitude as number)) {
      resolved.maxAmplitude = resolved.minAmplitude;
    }
  }

  const paramsLiteral = toJsObjectLiteral(resolved);
  const detailsLiteral = toJsObjectLiteral(resolved);
  const summaryLabel = spec.summary;

  const body = `
    var __params = ${paramsLiteral};
    var __layerName = __mcp_applyFilter(${JSON.stringify(filter)}, __params);
    return {
      ok: true,
      summary: '${summaryLabel.replace(/'/g, "\\'")} applied to ' + __layerName,
      undo_history_states_consumed: 1,
      next_suggested_tool: 'photoshop_get_preview',
      details: {
        filter: ${JSON.stringify(filter)},
        category: ${JSON.stringify(spec.category)},
        layer_name: __layerName,
        params: ${detailsLiteral}
      }
    };
  `;

  return executeRecipe(transport, `Apply Filter: ${summaryLabel}`, `${MCP_FILTER_GALLERY_HELPER}\n${body}`);
}

/** Serialize a flat {string|number} object to an ExtendScript object literal. */
function toJsObjectLiteral(obj: Record<string, number | string>): string {
  const pairs = Object.entries(obj).map(([k, v]) =>
    `${JSON.stringify(k)}: ${typeof v === 'number' ? v : JSON.stringify(v)}`
  );
  return `{ ${pairs.join(', ')} }`;
}
