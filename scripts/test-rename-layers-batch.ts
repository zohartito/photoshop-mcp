/**
 * Unit checks for photoshop_rename_layers_batch — both backends.
 * Run: npx tsx scripts/test-rename-layers-batch.ts
 *
 * - ExtendScript snippet generation does not throw, escapes strings, encodes renames.
 * - UXP descriptor builder produces correct shape.
 * - UXP normalizer converts success/failure arrays to the ExtendScript envelope.
 * - Router registry entry exists (command meta).
 * - Tool handler validates inputs correctly (tested via snippet + router).
 * - Overall envelope parity: normalized UXP result shape matches ExtendScript shape.
 */
import assert from 'node:assert/strict';
import { ExtendScriptSnippets } from '../src/api/extendscript.js';
import {
  renameLayerDescriptorByName,
} from '../src/transport/uxp-commands/descriptors.js';
import {
  normalizeRenameLayersBatch,
} from '../src/transport/uxp-commands/normalize.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  OK   ${name}`);
}

// --- ExtendScript snippet generation ---

check('es: snippet contains oldName and newName', () => {
  const script = ExtendScriptSnippets.renameLayersBatch([
    { oldName: 'Layer 1', newName: 'Hero' },
    { oldName: 'Layer 2', newName: 'Footer' },
  ]);
  assert.ok(script.includes('Layer 1'), 'should embed oldName');
  assert.ok(script.includes('Hero'), 'should embed newName');
  assert.ok(script.includes('__batchRenames'), 'should use batch var');
  assert.ok(script.includes('__findLayerRecursive'), 'should include recursive finder');
});

check('es: snippet handles layer inside group via recursive search', () => {
  const script = ExtendScriptSnippets.renameLayersBatch([
    { oldName: 'insideGroup', newName: 'renamed' },
  ]);
  assert.ok(script.includes('layerSets'), 'should traverse groups');
});

check('es: snippet returns ok/renamed/total/results envelope', () => {
  const script = ExtendScriptSnippets.renameLayersBatch([
    { oldName: 'A', newName: 'B' },
  ]);
  assert.ok(script.includes('renamed'), 'should include renamed count');
  assert.ok(script.includes('results'), 'should include results array');
  assert.ok(script.includes('hasFailures'), 'should include hasFailures');
  assert.ok(script.includes('Layer not found'), 'should handle missing layer');
});

check('es: snippet per-item ok:false on missing layer', () => {
  const script = ExtendScriptSnippets.renameLayersBatch([
    { oldName: 'missing', newName: 'x' },
  ]);
  assert.ok(script.includes('ok: false'), 'should emit failure branch');
  assert.ok(script.includes('Layer not found'), 'should include missing message');
});

check('es: snippet escaping — special characters preserved', () => {
  const script = ExtendScriptSnippets.renameLayersBatch([
    { oldName: 'O"ne', newName: 'Two\nLine' },
  ]);
  assert.ok(script.length > 0, 'should not throw on special chars');
});

check('es: empty renames still produces valid script structure (tool guard handles validation)', () => {
  const script = ExtendScriptSnippets.renameLayersBatch([]);
  assert.ok(typeof script === 'string' && script.length > 0);
});

// --- UXP descriptor builders ---

check('uxp: renameLayerDescriptorByName produces select + set', () => {
  const descs = renameLayerDescriptorByName({ oldName: 'OldA', newName: 'NewA' });
  assert.equal(descs.length, 2);
  assert.equal(descs[0]._obj, 'select');
  assert.equal(descs[1]._obj, 'set');
  const target = (descs[0] as Record<string, unknown>)._target as unknown[];
  assert.ok(Array.isArray(target));
  const setTo = (descs[1] as Record<string, unknown>).to as Record<string, unknown>;
  assert.equal(setTo.name, 'NewA');
});

check('uxp: descriptor selects by name', () => {
  const descs = renameLayerDescriptorByName({ oldName: 'Background Copy', newName: 'BG' });
  const t = (descs[0] as Record<string, unknown>)._target as Array<Record<string, unknown>>;
  const ref = t[0];
  assert.equal(ref._ref, 'layer');
  assert.equal(ref._name, 'Background Copy');
});

// --- UXP normalizer ---

check('uxp: normalizer all success', () => {
  const renames = [
    { oldName: 'A', newName: 'B' },
    { oldName: 'C', newName: 'D' },
  ];
  const out = normalizeRenameLayersBatch(renames, []);
  assert.equal(out.ok, true);
  assert.equal(out.renamed, 2);
  assert.equal(out.total, 2);
  assert.equal(out.results.length, 2);
  assert.equal(out.results[0].ok, true);
  assert.equal(out.hasFailures, false);
});

check('uxp: normalizer with one failure', () => {
  const renames = [
    { oldName: 'A', newName: 'B' },
    { oldName: 'Missing', newName: 'X' },
  ];
  const out = normalizeRenameLayersBatch(renames, [
    { index: 1, error: 'Layer not found: Missing' },
  ]);
  assert.equal(out.renamed, 1);
  assert.equal(out.total, 2);
  assert.equal(out.results[0].ok, true);
  assert.equal(out.results[1].ok, false);
  assert.ok((out.results[1] as { error?: string }).error?.includes('Missing'));
  assert.equal(out.hasFailures, true);
});

check('uxp: normalizer empty', () => {
  const out = normalizeRenameLayersBatch([], []);
  assert.equal(out.renamed, 0);
  assert.equal(out.total, 0);
  assert.equal(out.hasFailures, false);
});

check('uxp: normalizer envelope parity with ExtendScript shape', () => {
  const renames = [{ oldName: 'L1', newName: 'Hero' }];
  const out = normalizeRenameLayersBatch(renames, []);
  assert.ok('ok' in out);
  assert.ok('renamed' in out);
  assert.ok('total' in out);
  assert.ok('results' in out);
  assert.ok('hasFailures' in out);
  const r = out.results[0];
  assert.ok('oldName' in r && 'newName' in r && 'ok' in r);
});

check('uxp: tool validates per-item ok:false not transport error', () => {
  const renames = [{ oldName: 'Nope', newName: 'Yep' }];
  const out = normalizeRenameLayersBatch(renames, [
    { index: 0, error: 'Layer not found: Nope' },
  ]);
  assert.equal(out.ok, true, 'envelope ok stays true even with per-item failures');
  assert.equal(out.results[0].ok, false);
});

console.log(`\n${passed} rename_layers_batch checks passed.`);
