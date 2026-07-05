/**
 * Unit checks for the UXP → ExtendScript result normalizer (transport-layer.md §4.2).
 * Run: npx tsx scripts/test-uxp-normalize.ts
 *
 * These verify — without a live plugin — that raw batchPlay `get` descriptors are
 * translated to the SAME envelope shapes the ExtendScript twins (getContextInfo /
 * getLayerNames) emit. Live value-parity diffing against a connected plugin is a
 * separate, deferred follow-up; this pins the translation logic in the meantime.
 */
import assert from 'node:assert/strict';
import {
  normalizeBlendMode,
  normalizeContextInfo,
  normalizeDocumentMode,
  normalizeGetLayers,
  normalizeLayerKind,
} from '../src/transport/uxp-commands/normalize.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  OK   ${name}`);
}

// --- enum / kind mapping ---
check('blendMode: multiply → BlendMode.MULTIPLY', () => {
  assert.equal(normalizeBlendMode('multiply'), 'BlendMode.MULTIPLY');
});
check('blendMode: passThrough → BlendMode.PASSTHROUGH', () => {
  assert.equal(normalizeBlendMode('passThrough'), 'BlendMode.PASSTHROUGH');
});
check('blendMode: undefined → BlendMode.NORMAL', () => {
  assert.equal(normalizeBlendMode(undefined), 'BlendMode.NORMAL');
});
check('layerKind: 2 → LayerKind.TEXT', () => {
  assert.equal(normalizeLayerKind(2), 'LayerKind.TEXT');
});
check('layerKind: unknown int → LayerKind.NORMAL', () => {
  assert.equal(normalizeLayerKind(99), 'LayerKind.NORMAL');
});
check('documentMode: RGBColor → DocumentMode.RGB', () => {
  assert.equal(normalizeDocumentMode('RGBColor'), 'DocumentMode.RGB');
});

// --- getContextInfo envelope (get_state / get_document_info twins) ---
check('context: no document → { hasDocument:false }', () => {
  const ctx = normalizeContextInfo(null, null, false);
  assert.deepEqual(ctx, { hasDocument: false });
});

check('context: document + active layer maps to getContextInfo shape', () => {
  const docDesc = {
    title: 'Untitled-1',
    width: { _unit: 'pixelsUnit', _value: 800 },
    height: { _unit: 'pixelsUnit', _value: 600 },
    resolution: { _unit: 'densityUnit', _value: 72 },
    mode: { _enum: 'documentMode', _value: 'RGBColor' },
    numberOfLayers: 3,
  };
  const layerDesc = {
    name: 'MCP_Paint',
    layerKind: 1,
    opacity: { _unit: 'percentUnit', _value: 85 },
    mode: { _enum: 'blendMode', _value: 'multiply' },
    visible: true,
    background: false,
    bounds: {
      left: { _unit: 'pixelsUnit', _value: 10 },
      top: { _unit: 'pixelsUnit', _value: 20 },
      right: { _unit: 'pixelsUnit', _value: 110 },
      bottom: { _unit: 'pixelsUnit', _value: 120 },
    },
  };
  const ctx = normalizeContextInfo(docDesc, layerDesc, true);

  assert.equal(ctx.hasDocument, true);
  assert.equal(ctx.document?.name, 'Untitled-1');
  assert.equal(ctx.document?.width, 800);
  assert.equal(ctx.document?.height, 600);
  assert.equal(ctx.document?.resolution, 72);
  assert.equal(ctx.document?.colorMode, 'DocumentMode.RGB');
  assert.equal(ctx.document?.layerCount, 3);
  assert.equal(ctx.document?.hasSelection, true);

  const al = ctx.activeLayer as Record<string, unknown>;
  assert.equal(al.name, 'MCP_Paint');
  assert.equal(al.kind, 'LayerKind.NORMAL');
  assert.equal(al.opacity, 85);
  assert.equal(al.blendMode, 'BlendMode.MULTIPLY');
  assert.equal(al.visible, true);
  assert.equal(al.isBackground, false);
  assert.deepEqual(al.bounds, { left: 10, top: 20, right: 110, bottom: 120 });
});

// --- getLayerNames envelope, including §6.6 hasMask ---
check('getLayers: maps layers + embeds hasMask (§6.6)', () => {
  const context = normalizeContextInfo(
    { title: 'D', width: { _value: 1 }, height: { _value: 1 }, mode: { _value: 'RGBColor' } },
    null,
    false
  );
  const out = normalizeGetLayers(
    [
      { name: 'A', layerKind: 1, visible: true, opacity: { _value: 100 }, mode: { _value: 'normal' }, hasUserMask: true },
      { name: 'B', layerKind: 2, visible: false, opacity: { _value: 50 }, mode: { _value: 'screen' }, hasUserMask: false },
    ],
    context
  );

  assert.equal(out.layerCount, 2);
  assert.equal(out.layers[0].name, 'A');
  assert.equal(out.layers[0].kind, 'LayerKind.NORMAL');
  assert.equal(out.layers[0].hasMask, true);
  assert.equal(out.layers[1].kind, 'LayerKind.TEXT');
  assert.equal(out.layers[1].blendMode, 'BlendMode.SCREEN');
  assert.equal(out.layers[1].hasMask, false);
  // The getLayerNames envelope embeds the getContextInfo context.
  assert.equal((out.context as { hasDocument: boolean }).hasDocument, true);
});

console.log(`\n${passed} normalization checks passed.`);
