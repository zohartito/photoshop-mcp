/**
 * Normalize raw batchPlay `get` results to the SAME result envelopes the
 * ExtendScript twins emit (docs/design/transport-layer.md §4.2 normalization note).
 *
 * Backend A returns friendly shapes built by getContextInfo / getLayerNames in
 * src/api/extendscript.ts:
 *   - get_state / get_document_info → getContextInfo():
 *       { hasDocument, document:{ name,width,height,resolution,colorMode,
 *         layerCount,hasSelection }, activeLayer:{ name,kind,opacity,blendMode,
 *         visible,locked,isBackground,bounds:{left,top,right,bottom} } }
 *   - get_layers → { layerCount, layers:[{ name,kind,visible,opacity,blendMode,
 *       hasMask }], context: <getContextInfo> }
 *
 * batchPlay returns Adobe's internal ActionDescriptor JSON instead (unit-wrapped
 * numbers, enum tokens, integer layerKind). These functions translate one to the
 * other so an MCP client cannot tell which backend answered.
 *
 * LIVE-VERIFIED 2026-07-05 on PS 27.8 (parity 3/3 CLEAN, transport-layer.md §12).
 * The value-level mappings here were corrected against live diffs: AM opacity is
 * raw 0–255 (DOM: percent), locked ⇔ layerLocking.protectAll, and numberOfLayers
 * excludes a Background layer.
 */

/** ExtendScript exposes layer.kind as e.g. "LayerKind.NORMAL". */
type LayerKindString = string;

/**
 * Adobe's integer `layerKind` (from a batchPlay layer `get`) → the ExtendScript
 * `String(layer.kind)` token. Values per the Photoshop Action Manager layerKind
 * enumeration; unknown ints fall back to NORMAL (the ExtendScript default for a
 * plain pixel layer).
 */
const LAYER_KIND_BY_INT: Record<number, LayerKindString> = {
  1: 'LayerKind.NORMAL',
  2: 'LayerKind.TEXT',
  3: 'LayerKind.SOLIDFILL',
  4: 'LayerKind.GRADIENTFILL',
  5: 'LayerKind.PATTERNFILL',
  6: 'LayerKind.HUESATURATION',
  7: 'LayerKind.COLORBALANCE',
  8: 'LayerKind.BRIGHTNESSCONTRAST',
  9: 'LayerKind.CURVES',
  10: 'LayerKind.LEVELS',
  11: 'LayerKind.SMARTOBJECT',
  12: 'LayerKind.NORMAL',
  13: 'LayerKind.NORMAL',
};

/**
 * Adobe's blendMode enum token (e.g. "multiply", "passThrough") → the ExtendScript
 * `String(layer.blendMode)` token (e.g. "BlendMode.MULTIPLY", "BlendMode.PASSTHROUGH").
 * Only the mappings that differ non-trivially from an uppercase are listed; the
 * default path uppercases and strips separators.
 */
const BLEND_MODE_TOKEN: Record<string, string> = {
  normal: 'NORMAL',
  dissolve: 'DISSOLVE',
  darken: 'DARKEN',
  multiply: 'MULTIPLY',
  colorBurn: 'COLORBURN',
  linearBurn: 'LINEARBURN',
  darkerColor: 'DARKERCOLOR',
  lighten: 'LIGHTEN',
  screen: 'SCREEN',
  colorDodge: 'COLORDODGE',
  linearDodge: 'LINEARDODGE',
  lighterColor: 'LIGHTERCOLOR',
  overlay: 'OVERLAY',
  softLight: 'SOFTLIGHT',
  hardLight: 'HARDLIGHT',
  vividLight: 'VIVIDLIGHT',
  linearLight: 'LINEARLIGHT',
  pinLight: 'PINLIGHT',
  hardMix: 'HARDMIX',
  difference: 'DIFFERENCE',
  exclusion: 'EXCLUSION',
  subtract: 'SUBTRACT',
  divide: 'DIVIDE',
  hue: 'HUE',
  saturation: 'SATURATION',
  color: 'COLOR',
  luminosity: 'LUMINOSITY',
  passThrough: 'PASSTHROUGH',
};

/** Adobe document `mode` enum token → ExtendScript String(doc.mode) form. */
const DOCUMENT_MODE_TOKEN: Record<string, string> = {
  RGBColor: 'DocumentMode.RGB',
  CMYKColorEnum: 'DocumentMode.CMYK',
  CMYKColor: 'DocumentMode.CMYK',
  grayScale: 'DocumentMode.GRAYSCALE',
  labColor: 'DocumentMode.LAB',
  bitmap: 'DocumentMode.BITMAP',
  indexedColor: 'DocumentMode.INDEXEDCOLOR',
  duotone: 'DocumentMode.DUOTONE',
  multichannel: 'DocumentMode.MULTICHANNEL',
};

type Descriptor = Record<string, unknown>;

/** Read a unit-wrapped number ({ _unit, _value }) or a plain number. */
function unitValue(v: unknown): number | undefined {
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object' && '_value' in v) {
    const n = (v as { _value?: unknown })._value;
    if (typeof n === 'number') return n;
  }
  return undefined;
}

/** Read an enum-wrapped token ({ _enum, _value }) or a plain string. */
function enumValue(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && '_value' in v) {
    const s = (v as { _value?: unknown })._value;
    if (typeof s === 'string') return s;
  }
  return undefined;
}

/**
 * AM layer `opacity` is raw 0–255; the DOM (and backend A) speak percent 0–100.
 * Live-verified on PS 27.8: raw 255 ↔ DOM 100.
 */
function opacityPercent(v: unknown): number | undefined {
  const raw = unitValue(v);
  return raw === undefined ? undefined : Math.round((raw / 255) * 100);
}

/**
 * AM `layerLocking` is an object that ALWAYS exists ({ protectNone: true } on an
 * unlocked layer) — its mere presence means nothing. Backend A reports DOM
 * `allLocked`, whose AM twin is `protectAll`.
 */
function lockedFromLayerLocking(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false;
  return (v as Descriptor).protectAll === true;
}

export function normalizeBlendMode(token: string | undefined): string {
  if (!token) return 'BlendMode.NORMAL';
  const mapped = BLEND_MODE_TOKEN[token];
  const suffix = mapped ?? token.replace(/[^a-zA-Z]/g, '').toUpperCase();
  return `BlendMode.${suffix}`;
}

export function normalizeLayerKind(kindInt: number | undefined): LayerKindString {
  if (typeof kindInt !== 'number') return 'LayerKind.NORMAL';
  return LAYER_KIND_BY_INT[kindInt] ?? 'LayerKind.NORMAL';
}

export function normalizeDocumentMode(token: string | undefined): string {
  if (!token) return 'DocumentMode.RGB';
  return DOCUMENT_MODE_TOKEN[token] ?? `DocumentMode.${token.replace(/[^a-zA-Z]/g, '').toUpperCase()}`;
}

interface ContextInfo {
  hasDocument: boolean;
  document?: Record<string, unknown>;
  activeLayer?: Record<string, unknown> | null;
}

/**
 * Build the getContextInfo envelope from a document `get` descriptor and an
 * (optional) active-layer `get` descriptor. `hasSelection` cannot be read from the
 * document descriptor alone, so it is passed in (the caller runs a selection
 * probe, or defaults to false on the no-document path).
 */
export function normalizeContextInfo(
  docDesc: Descriptor | null,
  layerDesc: Descriptor | null,
  hasSelection: boolean
): ContextInfo {
  if (!docDesc) {
    return { hasDocument: false };
  }

  const document: Record<string, unknown> = {};
  if (typeof docDesc.title === 'string') document.name = docDesc.title;
  const width = unitValue(docDesc.width);
  const height = unitValue(docDesc.height);
  if (width !== undefined) document.width = width;
  if (height !== undefined) document.height = height;
  const resolution = unitValue(docDesc.resolution);
  if (resolution !== undefined) document.resolution = resolution;
  document.colorMode = normalizeDocumentMode(enumValue(docDesc.mode));
  // AM numberOfLayers EXCLUDES a Background layer; the DOM layerCount includes it.
  if (typeof docDesc.numberOfLayers === 'number') {
    document.layerCount =
      docDesc.numberOfLayers + (docDesc.hasBackgroundLayer === true ? 1 : 0);
  }
  document.hasSelection = hasSelection;

  const context: ContextInfo = { hasDocument: true, document };

  if (layerDesc) {
    const activeLayer: Record<string, unknown> = {
      name: typeof layerDesc.name === 'string' ? layerDesc.name : undefined,
      kind: normalizeLayerKind(
        typeof layerDesc.layerKind === 'number' ? layerDesc.layerKind : undefined
      ),
      opacity: opacityPercent(layerDesc.opacity),
      blendMode: normalizeBlendMode(enumValue(layerDesc.mode)),
      visible: typeof layerDesc.visible === 'boolean' ? layerDesc.visible : undefined,
      locked: lockedFromLayerLocking(layerDesc.layerLocking),
      isBackground: typeof layerDesc.background === 'boolean' ? layerDesc.background : false,
    };
    const bounds = layerDesc.bounds as Descriptor | undefined;
    if (bounds) {
      activeLayer.bounds = {
        left: unitValue(bounds.left),
        top: unitValue(bounds.top),
        right: unitValue(bounds.right),
        bottom: unitValue(bounds.bottom),
      };
    }
    context.activeLayer = activeLayer;
  } else {
    context.activeLayer = null;
  }

  return context;
}

/** get_state and get_document_info share the getContextInfo envelope exactly. */
export const normalizeGetState = normalizeContextInfo;
export const normalizeGetDocumentInfo = normalizeContextInfo;

interface NormalizedLayer {
  name: unknown;
  kind: string;
  visible: unknown;
  opacity: number | undefined;
  blendMode: string;
  hasMask: boolean;
}

/**
 * Normalize a batchPlay multi-get of layers to the getLayerNames envelope
 * (§6.6 — includes hasMask). `layerDescs` is the array of per-layer `get`
 * descriptors (one per layer, recursion flattened by the caller); `context` is the
 * already-normalized getContextInfo envelope to embed.
 */
export function normalizeGetLayers(
  layerDescs: Descriptor[],
  context: ContextInfo
): { layerCount: number; layers: NormalizedLayer[]; context: ContextInfo } {
  const layers: NormalizedLayer[] = layerDescs.map((d) => ({
    name: d.name,
    kind: normalizeLayerKind(typeof d.layerKind === 'number' ? d.layerKind : undefined),
    visible: typeof d.visible === 'boolean' ? d.visible : undefined,
    opacity: opacityPercent(d.opacity),
    blendMode: normalizeBlendMode(enumValue(d.mode)),
    hasMask: typeof d.hasUserMask === 'boolean' ? d.hasUserMask : false,
  }));

  return { layerCount: layers.length, layers, context };
}
