/**
 * Offline static-trace checks for the §6.8 mutating-family port (transport-layer.md
 * §6.8, §14). Run: npx tsx scripts/test-mutport-static.ts
 *
 * No live Photoshop. These pin the two things the offline gate can prove without a
 * PS harness (the live confirmation is staged in scripts/parity-uxp.ts):
 *
 *  1. Backend A (ExtendScript) — every mutating snippet now (a) READS BACK the
 *     affected layer id (returns a top-level `layerId`) and (b) ACCEPTS an optional
 *     layerId that targets a specific layer by native id. The name/active-layer
 *     path stays free of id-targeting so the default route is behaviourally the
 *     same command it was before, only richer by one additive field.
 *  2. Backend B (UXP) — the mutating descriptor builders + normalizers produce the
 *     expected batchPlay shapes and surface the SAME top-level `layerId`, so
 *     tools/atomic-shared.ts `layerIdFrom` reads either backend identically.
 */
import assert from 'node:assert/strict';
import { ExtendScriptSnippets } from '../src/api/extendscript.js';
import { layerIdFrom } from '../src/tools/atomic-shared.js';
import {
  addLayerMaskDescriptor,
  duplicateLayerDescriptor,
  getActiveLayerIdDescriptor,
  selectLayerByIdDescriptor,
  setLayerPropertiesDescriptor,
} from '../src/transport/uxp-commands/descriptors.js';
import {
  blendModeToBatchPlayToken,
  layerIdFromDescriptor,
  normalizeCreateLayerMask,
  normalizeDuplicateLayer,
  normalizeSelectLayer,
  normalizeSetLayerProperties,
} from '../src/transport/uxp-commands/normalize.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  OK   ${name}`);
}

// =====================================================================
// Backend A — ExtendScript snippet read-back + optional id targeting
// =====================================================================

const ID_READBACK = '__mcp_layerIdSafe';

/**
 * The identity helper is DEFINED in every mutating snippet (that is expected —
 * MCP_LAYER_IDENTITY_HELPERS is always embedded). "Targets by id" means the snippet
 * CALLS it to resolve the working layer, which only the id-form does. Detect a call
 * site (assignment / target reassignment), not the function definition.
 */
function callsSelectById(snippet: string): boolean {
  // A call site is the helper name NOT immediately preceded by `function ` — i.e.
  // any invocation, whether assigned (var layer = ...) or a bare statement (mask).
  return /(?<!function )__mcp_selectLayerById\(/.test(snippet);
}

// duplicate_layer -----------------------------------------------------
check('ES duplicate_layer: returns layerId (read-back) in both forms', () => {
  const active = ExtendScriptSnippets.duplicateLayer('copy');
  const byId = ExtendScriptSnippets.duplicateLayer('copy', 4242);
  assert.match(active, /layerId: __mcp_layerIdSafe\(duplicated\)/);
  assert.match(byId, /layerId: __mcp_layerIdSafe\(duplicated\)/);
});
check('ES duplicate_layer: active-layer form does NOT target by id', () => {
  const active = ExtendScriptSnippets.duplicateLayer('copy');
  assert.ok(!callsSelectById(active), 'active form must not select-by-id');
  assert.match(active, /var layer = doc\.activeLayer;/);
});
check('ES duplicate_layer: id form targets the given id', () => {
  const byId = ExtendScriptSnippets.duplicateLayer(undefined, 4242);
  assert.match(byId, /var layer = __mcp_selectLayerById\(4242\)/);
});

// select_layer --------------------------------------------------------
check('ES select_layer: returns layerId in both forms', () => {
  const byName = ExtendScriptSnippets.selectLayerByName('Layer 1');
  const byId = ExtendScriptSnippets.selectLayerByName('Layer 1', 99);
  assert.match(byName, /layerId: __mcp_layerIdSafe\(target\)/);
  assert.match(byId, /layerId: __mcp_layerIdSafe\(target\)/);
});
check('ES select_layer: name form keeps the recursive findLayer path', () => {
  const byName = ExtendScriptSnippets.selectLayerByName('Layer 1');
  assert.match(byName, /function findLayer\(container, name\)/);
  assert.match(byName, /doc\.activeLayer = target;/);
  assert.ok(!callsSelectById(byName), 'name form must not select-by-id');
});
check('ES select_layer: id form targets by id and skips name search', () => {
  const byId = ExtendScriptSnippets.selectLayerByName('ignored', 99);
  assert.match(byId, /target = __mcp_selectLayerById\(99\);/);
  assert.ok(!byId.includes('function findLayer'), 'id form must not walk by name');
});

// create_layer_mask ---------------------------------------------------
check('ES create_layer_mask: returns layerId in both forms', () => {
  const active = ExtendScriptSnippets.createLayerMask();
  const byId = ExtendScriptSnippets.createLayerMask(7);
  assert.match(active, /layerId: __mcp_maskLayerId/);
  assert.match(byId, /layerId: __mcp_maskLayerId/);
});
check('ES create_layer_mask: active form does not select-by-id', () => {
  const active = ExtendScriptSnippets.createLayerMask();
  assert.ok(!callsSelectById(active), 'active form must not select-by-id');
});
check('ES create_layer_mask: id form binds to the layer BEFORE masking', () => {
  const byId = ExtendScriptSnippets.createLayerMask(7);
  const selectAt = byId.indexOf('__mcp_selectLayerById(7)');
  // The mask helper is DEFINED near the top; find its CALL site (the invocation
  // that actually runs), which must come after the select-by-id.
  const maskCallAt = byId.search(
    /__mcp_makeLayerMaskAtChannel\(hasSelection \? 'revealSelection' : 'revealAll'\)/
  );
  assert.ok(selectAt >= 0, 'id form must select the target layer');
  assert.ok(maskCallAt >= 0, 'id form must call the mask helper');
  assert.ok(selectAt < maskCallAt, 'must select the target before creating the mask');
});

// set_layer_properties (opacity / blend mode) -------------------------
check('ES set_layer_opacity: returns layerId; id form targets id', () => {
  const active = ExtendScriptSnippets.setLayerOpacity(50);
  const byId = ExtendScriptSnippets.setLayerOpacity(50, 12);
  assert.match(active, /layerId: __mcp_layerIdSafe\(layer\)/);
  assert.match(active, /var layer = doc\.activeLayer;/);
  assert.match(byId, /var layer = __mcp_selectLayerById\(12\)/);
});
check('ES set_layer_blend_mode: returns layerId; id form targets id', () => {
  const active = ExtendScriptSnippets.setLayerBlendMode('MULTIPLY');
  const byId = ExtendScriptSnippets.setLayerBlendMode('MULTIPLY', 12);
  assert.match(active, /layerId: __mcp_layerIdSafe\(layer\)/);
  assert.match(active, /var layer = doc\.activeLayer;/);
  assert.match(byId, /var layer = __mcp_selectLayerById\(12\)/);
});
check('ES all mutating snippets embed the id read-back helper', () => {
  for (const s of [
    ExtendScriptSnippets.duplicateLayer('c'),
    ExtendScriptSnippets.selectLayerByName('n'),
    ExtendScriptSnippets.createLayerMask(),
    ExtendScriptSnippets.setLayerOpacity(1),
    ExtendScriptSnippets.setLayerBlendMode('NORMAL'),
  ]) {
    assert.ok(s.includes('function ' + ID_READBACK), 'snippet must define __mcp_layerIdSafe');
  }
});

// layerIdFrom parses backend-A style parsed payloads --------------------
check('layerIdFrom: reads a top-level numeric layerId', () => {
  assert.equal(layerIdFrom({ ok: true, layerId: 815 }), 815);
  assert.equal(layerIdFrom({ ok: true, layerId: null }), undefined);
  assert.equal(layerIdFrom({ ok: true }), undefined);
  assert.equal(layerIdFrom('({maskCreated:true, layerId:9})'), 9); // toSource string
});

// =====================================================================
// Backend B — UXP descriptor shapes + read-back normalizers
// =====================================================================

check('UXP duplicateLayerDescriptor: active vs by-id target', () => {
  const active = duplicateLayerDescriptor(undefined, 'copy')[0];
  const byId = duplicateLayerDescriptor(4242, 'copy')[0];
  assert.equal(active._obj, 'duplicate');
  assert.deepEqual(active._target, [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }]);
  assert.deepEqual(byId._target, [{ _ref: 'layer', _id: 4242 }]);
  assert.equal(byId.name, 'copy');
});

check('UXP selectLayerByIdDescriptor: select by _id, makeVisible false', () => {
  const d = selectLayerByIdDescriptor(99)[0];
  assert.equal(d._obj, 'select');
  assert.deepEqual(d._target, [{ _ref: 'layer', _id: 99 }]);
  assert.equal(d.makeVisible, false);
});

check('UXP addLayerMaskDescriptor: id form selects BEFORE the make', () => {
  const withId = addLayerMaskDescriptor(7, 'revealSelection');
  assert.equal(withId.length, 2);
  assert.equal(withId[0]._obj, 'select');
  assert.deepEqual(withId[0]._target, [{ _ref: 'layer', _id: 7 }]);
  assert.equal(withId[1]._obj, 'make');
  assert.equal((withId[1].using as { _value: string })._value, 'revealSelection');
  // No id → just the make, no pre-select.
  const noId = addLayerMaskDescriptor(undefined, 'revealAll');
  assert.equal(noId.length, 1);
  assert.equal(noId[0]._obj, 'make');
});

check('UXP setLayerPropertiesDescriptor: percentUnit opacity + mapped blend token', () => {
  const d = setLayerPropertiesDescriptor({ layerId: 5, opacity: 80, blendMode: 'MULTIPLY' });
  // select-by-id first, then the set
  assert.equal(d[0]._obj, 'select');
  const set = d[d.length - 1];
  const to = set.to as Record<string, unknown>;
  assert.deepEqual(to.opacity, { _unit: 'percentUnit', _value: 80 });
  assert.deepEqual(to.mode, { _enum: 'blendMode', _value: 'multiply' });
});

check('UXP blendModeToBatchPlayToken: ES token → batchPlay enum token', () => {
  assert.equal(blendModeToBatchPlayToken('MULTIPLY'), 'multiply');
  assert.equal(blendModeToBatchPlayToken('BlendMode.PASSTHROUGH'), 'passThrough');
  assert.equal(blendModeToBatchPlayToken('NORMAL'), 'normal');
});

check('UXP getActiveLayerIdDescriptor: gets the layerID property', () => {
  const d = getActiveLayerIdDescriptor();
  assert.equal(d._obj, 'get');
  assert.deepEqual(d._target, [
    { _property: 'layerID' },
    { _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' },
  ]);
});

check('UXP layerIdFromDescriptor: reads layerID (plain or wrapped)', () => {
  assert.equal(layerIdFromDescriptor({ layerID: 321 }), 321);
  assert.equal(layerIdFromDescriptor({ layerID: { _value: 321 } }), 321);
  assert.equal(layerIdFromDescriptor({ layerId: 7 }), 7);
  assert.equal(layerIdFromDescriptor(null), undefined);
  assert.equal(layerIdFromDescriptor({}), undefined);
});

check('UXP mutating normalizers surface the SAME top-level layerId as backend A', () => {
  // Each takes the appended `get layerID` descriptor result as its last element.
  const dup = normalizeDuplicateLayer({ layerID: 900, name: 'copy' });
  assert.equal(layerIdFrom(dup), 900);
  assert.equal(dup.newName, 'copy');
  // Fallback: read-back missing the id → use the duplicate action's own result.
  const dupFallback = normalizeDuplicateLayer({}, { layerID: 901, name: 'copy2' });
  assert.equal(layerIdFrom(dupFallback), 901);
  assert.equal(dupFallback.newName, 'copy2');

  const sel = normalizeSelectLayer({ layerID: 901, name: 'L' });
  assert.equal(layerIdFrom(sel), 901);
  assert.equal(sel.selected, true);

  const mask = normalizeCreateLayerMask({ layerID: 902 }, true);
  assert.equal(layerIdFrom(mask), 902);
  assert.equal(mask.maskCreated, true);
  assert.equal(mask.fromSelection, true);

  const set = normalizeSetLayerProperties({ layerID: 903 }, { opacity: 80 });
  assert.equal(layerIdFrom(set), 903);
  assert.equal(set.updated, true);
  assert.equal(set.opacity, 80);
});

console.log(`\n${passed} static mutating-port checks passed.`);
