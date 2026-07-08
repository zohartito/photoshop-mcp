/**
 * Offline static checks for photoshop_rename_layers_batch (ES snippet + UXP
 * descriptors + normalizer + router delivery). Run:
 *   npx tsx scripts/test-rename-layers-batch.ts
 *
 * No live Photoshop. Pins the dual-backend contract so tools get the same
 * envelope from either transport (transport-layer.md §4.2).
 */
import assert from 'node:assert/strict';
import { ExtendScriptSnippets } from '../src/api/extendscript.js';
import { renameLayersBatchDescriptor } from '../src/transport/uxp-commands/descriptors.js';
import { normalizeRenameLayersBatch } from '../src/transport/uxp-commands/normalize.js';
import { TransportRouter } from '../src/transport/index.js';
import type { PhotoshopConnection } from '../src/platform/connection.js';

let passed = 0;
function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve(fn()).then(() => {
    passed += 1;
    console.log(`  OK   ${name}`);
  });
}

const SAMPLE = [
  { currentName: 'Layer 1', newName: 'Background' },
  { layerId: 42, newName: 'Hero' },
];

// =====================================================================
// Backend A — ExtendScript snippet
// =====================================================================

await check('ES renameLayersBatch: embeds renames JSON + fail-fast finders', () => {
  const script = ExtendScriptSnippets.renameLayersBatch(SAMPLE);
  assert.match(script, /var renames = /);
  assert.ok(script.includes('"Layer 1"'), 'must embed currentName');
  assert.ok(script.includes('"Background"'), 'must embed newName');
  assert.ok(script.includes('"layerId":42') || script.includes('"layerId": 42'), 'must embed layerId');
  assert.match(script, /function findLayerByName/);
  assert.match(script, /function findLayerById/);
  assert.match(script, /renamedCount:\s*applied\.length/);
  assert.match(script, /Layer not found/);
});

await check('ES renameLayersBatch: empty array still produces a runnable guard', () => {
  const script = ExtendScriptSnippets.renameLayersBatch([]);
  assert.match(script, /renames array is empty/);
});

// =====================================================================
// Backend B — UXP descriptors + normalizer
// =====================================================================

await check('UXP renameLayersBatchDescriptor: one set per entry, by name + by id', () => {
  const d = renameLayersBatchDescriptor(SAMPLE);
  assert.equal(d.length, 2);
  assert.equal(d[0]._obj, 'set');
  assert.deepEqual(d[0]._target, [{ _ref: 'layer', _name: 'Layer 1' }]);
  assert.deepEqual(d[0].to, { _obj: 'layer', name: 'Background' });
  assert.deepEqual(d[1]._target, [{ _ref: 'layer', _id: 42 }]);
  assert.deepEqual(d[1].to, { _obj: 'layer', name: 'Hero' });
});

await check('UXP renameLayersBatchDescriptor: rejects entry without target', () => {
  assert.throws(
    () => renameLayersBatchDescriptor([{ newName: 'x' }]),
    /currentName or layerId/
  );
});

await check('UXP normalizeRenameLayersBatch: same envelope as ES twin', () => {
  const out = normalizeRenameLayersBatch(SAMPLE);
  assert.equal(out.renamedCount, 2);
  assert.equal(out.renames[0].oldName, 'Layer 1');
  assert.equal(out.renames[0].newName, 'Background');
  assert.equal(out.renames[0].layerId, undefined);
  assert.equal(out.renames[1].newName, 'Hero');
  assert.equal(out.renames[1].layerId, 42);
});

// =====================================================================
// Router delivery — auto path reaches ExtendScript with params.script
// =====================================================================

const calls: Array<{ script: string }> = [];
const fakeConnection = {
  async executeScript(script: string): Promise<unknown> {
    calls.push({ script });
    return { renamedCount: 2, renames: SAMPLE };
  },
  async ping(): Promise<boolean> {
    return true;
  },
  async getVersion(): Promise<string> {
    return '27.8.0';
  },
  getPhotoshopInfo(): { version: string; path: string; isRunning: boolean } {
    return { version: '27.8.0', path: '/Applications/Adobe Photoshop 2026', isRunning: true };
  },
} as unknown as PhotoshopConnection;

await check('router: rename_layers_batch delivers ES script on auto path', async () => {
  delete process.env.PHOTOSHOP_MCP_TRANSPORT;
  const router = new TransportRouter(fakeConnection);
  const script = ExtendScriptSnippets.renameLayersBatch(SAMPLE);
  calls.length = 0;
  const result = await router.run({
    name: 'rename_layers_batch',
    params: { script, renames: SAMPLE },
  });
  assert.equal(calls.length, 1);
  // createAPI wraps the script; the original body must still be present.
  assert.ok(calls[0].script.includes('findLayerByName'), 'wrapped script must contain snippet body');
  assert.ok(calls[0].script.includes('Background'));
  assert.deepEqual(result, { renamedCount: 2, renames: SAMPLE });
});

console.log(`\n${passed} rename_layers_batch checks passed.`);
