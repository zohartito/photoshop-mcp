/**
 * batchPlay descriptor builders for the UXP backend (backend B).
 * See docs/design/transport-layer.md §4.2, §6.4, §6.5, §6.8.
 *
 * These build the ActionDescriptor arrays the generic `batch_play` plugin action
 * runs. They are the `uxp` implementations of commands whose `extendscript` twins
 * live in src/api/extendscript.ts. Descriptor shapes are cribbed from the proven
 * adb-mcp reference catalog (~/adb-mcp/uxp/ps/commands/*) and the Action Manager
 * `get`/`make`/`delete` idioms; per §6.4 every unit value carries an explicit
 * `_unit` so pixel semantics are part of the command contract.
 *
 * NOT LIVE-VERIFIED in the M3 code-half run — the UXP plugin is not loaded. Live
 * parity diffing (PHOTOSHOP_MCP_TRANSPORT=uxp vs extendscript) is deferred to a
 * follow-up session where the plugin is connected via UXP Developer Tool.
 */
import type { ActionDescriptor } from '../../api/batch-play.js';

/** Target the active document by ordinal (targetEnum). */
const ACTIVE_DOCUMENT = { _ref: 'document', _enum: 'ordinal', _value: 'targetEnum' } as const;

/** Target the active (front) layer by ordinal (targetEnum). */
const ACTIVE_LAYER = { _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' } as const;

/** Target a layer by its native id (§6.8 target identity). */
function layerById(layerId: number): Record<string, unknown> {
  return { _ref: 'layer', _id: layerId };
}

/**
 * A batchPlay `get` of the whole active-document descriptor. Returns keys the
 * normalizer maps to the getContextInfo envelope: `width`, `height`, `resolution`,
 * `mode`, `title`, `numberOfLayers`, `documentID`, plus selection presence.
 */
export function getDocumentDescriptor(): ActionDescriptor[] {
  return [{ _obj: 'get', _target: [ACTIVE_DOCUMENT] }];
}

/**
 * A batchPlay `get` of the whole active-layer descriptor. Returns `name`,
 * `layerID`, `opacity`, `mode`, `visible`, `background`, `hasUserMask`,
 * `layerKind`, `bounds`. Used to fill the activeLayer branch of getContextInfo.
 */
export function getActiveLayerDescriptor(): ActionDescriptor[] {
  return [{ _obj: 'get', _target: [ACTIVE_LAYER] }];
}

/**
 * §6.8 groundwork — select (target) a layer by native id and make it the active
 * layer. This is the UXP equivalent of ExtendScript `doc.activeLayer = target`,
 * letting layer-targeting commands bind to the layer they mean instead of whatever
 * happens to be active. `makeVisible:false` keeps it a pure selection.
 */
export function selectLayerByIdDescriptor(layerId: number): ActionDescriptor[] {
  return [
    {
      _obj: 'select',
      _target: [layerById(layerId)],
      makeVisible: false,
    },
  ];
}

/**
 * §6.8 — duplicate a layer by id and (optionally) name the copy. batchPlay returns
 * the new layer's `layerID` so the mutating command can report the affected
 * `layerId` (contract: mutating layer commands return layerId). When `layerId` is
 * omitted the active layer is duplicated.
 */
export function duplicateLayerDescriptor(layerId?: number, newName?: string): ActionDescriptor[] {
  const target = typeof layerId === 'number' ? layerById(layerId) : ACTIVE_LAYER;
  const dupe: ActionDescriptor = {
    _obj: 'duplicate',
    _target: [target],
  };
  if (typeof newName === 'string' && newName.length > 0) {
    dupe.name = newName;
  }
  return [dupe];
}

/**
 * §6.8 — create a reveal-all (or reveal-selection) layer mask on a target layer.
 * Mirrors adb-mcp addLayerMask (make channel/mask). Selects the layer by id first
 * when provided so the mask lands on the intended layer, not the active one.
 */
export function addLayerMaskDescriptor(
  layerId?: number,
  reveal: 'revealAll' | 'revealSelection' = 'revealAll'
): ActionDescriptor[] {
  const descriptors: ActionDescriptor[] = [];
  if (typeof layerId === 'number') {
    descriptors.push(...selectLayerByIdDescriptor(layerId));
  }
  descriptors.push({
    _obj: 'make',
    at: { _ref: 'channel', _enum: 'channel', _value: 'mask' },
    new: { _class: 'channel' },
    using: { _enum: 'userMaskEnabled', _value: reveal },
  });
  return descriptors;
}

/**
 * §6.8 — set opacity / blend mode on a target layer. Opacity carries the explicit
 * percentUnit per §6.4. Selects the layer by id first when provided.
 */
export function setLayerPropertiesDescriptor(params: {
  layerId?: number;
  opacity?: number;
  blendMode?: string;
}): ActionDescriptor[] {
  const descriptors: ActionDescriptor[] = [];
  if (typeof params.layerId === 'number') {
    descriptors.push(...selectLayerByIdDescriptor(params.layerId));
  }
  const to: Record<string, unknown> = { _obj: 'layer' };
  if (typeof params.opacity === 'number') {
    to.opacity = { _unit: 'percentUnit', _value: params.opacity };
  }
  if (typeof params.blendMode === 'string') {
    to.mode = { _enum: 'blendMode', _value: params.blendMode };
  }
  descriptors.push({
    _obj: 'set',
    _target: [ACTIVE_LAYER],
    to,
  });
  return descriptors;
}
