/**
 * Offline checks for photoshop_rename_layers_batch across the tool boundary,
 * ExtendScript backend, and UXP descriptor/normalizer backend.
 * Run: npx tsx scripts/test-rename-layers-batch.ts
 */
import assert from 'node:assert/strict';
import { ExtendScriptSnippets } from '../src/api/extendscript.js';
import { enrichErrorResult } from '../src/errors/envelope.js';
import { createLayerPropertiesTools } from '../src/tools/layer-properties-tools.js';
import type { TransportRouter } from '../src/transport/index.js';
import type { PsCommand } from '../src/transport/types.js';
import {
  getLayerByNameDescriptor,
  renameLayersBatchDescriptor,
} from '../src/transport/uxp-commands/descriptors.js';
import { normalizeRenameLayersBatch } from '../src/transport/uxp-commands/normalize.js';

interface LayerRename {
  oldName: string;
  newName: string;
}

interface MockLayer {
  name: string;
}

interface MockContainer extends MockLayer {
  layers: MockLayer[];
  layerSets: MockContainer[];
}

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  OK   ${name}`);
}

function executeExtendScript(
  renames: LayerRename[],
  document?: MockContainer
): Record<string, unknown> {
  const app = {
    documents: document ? [document] : [],
    activeDocument: document,
  };
  const execute = new Function('app', ExtendScriptSnippets.renameLayersBatch(renames));
  return execute(app) as Record<string, unknown>;
}

function documentWith(layers: MockLayer[], layerSets: MockContainer[] = []): MockContainer {
  return { name: 'Document', layers, layerSets };
}

const SAMPLE: LayerRename[] = [
  { oldName: 'Hero', newName: 'Subject' },
  { oldName: 'Caption', newName: 'Headline' },
];

await check('tool: registers the batch schema beside layer-property tools', () => {
  const transport = { run: async () => ({}) } as unknown as TransportRouter;
  const definition = createLayerPropertiesTools(transport).find(
    ({ tool }) => tool.name === 'photoshop_rename_layers_batch'
  );
  assert.ok(definition);

  const schema = definition.tool.inputSchema as {
    required?: string[];
    properties?: { renames?: { minItems?: number; items?: { required?: string[] } } };
  };
  assert.deepEqual(schema.required, ['renames']);
  assert.equal(schema.properties?.renames?.minItems, 1);
  assert.deepEqual(schema.properties?.renames?.items?.required, ['oldName', 'newName']);
});

await check(
  'tool: sends one transport-neutral command with script and structured params',
  async () => {
    const commands: PsCommand[] = [];
    const transport = {
      run: async (command: PsCommand) => {
        commands.push(command);
        return normalizeRenameLayersBatch(SAMPLE);
      },
    } as unknown as TransportRouter;
    const definition = createLayerPropertiesTools(transport).find(
      ({ tool }) => tool.name === 'photoshop_rename_layers_batch'
    );
    assert.ok(definition);

    const result = await definition.handler({ renames: SAMPLE });
    assert.equal(result.isError, undefined);
    assert.equal(commands.length, 1);
    assert.equal(commands[0].name, 'rename_layers_batch');
    assert.deepEqual(commands[0].params.renames, SAMPLE);
    assert.equal(typeof commands[0].params.script, 'string');

    const body = JSON.parse(result.content[0].type === 'text' ? result.content[0].text : '{}');
    assert.equal(body.ok, true);
    assert.equal(body.details.renamedCount, 2);
    assert.deepEqual(body.details.renames, SAMPLE);
  }
);

await check('tool: invalid and duplicate sources fail before transport', async () => {
  let calls = 0;
  const transport = {
    run: async () => {
      calls += 1;
      return {};
    },
  } as unknown as TransportRouter;
  const definition = createLayerPropertiesTools(transport).find(
    ({ tool }) => tool.name === 'photoshop_rename_layers_batch'
  );
  assert.ok(definition);

  const empty = await definition.handler({ renames: [] });
  const duplicate = await definition.handler({
    renames: [
      { oldName: 'Same', newName: 'One' },
      { oldName: 'Same', newName: 'Two' },
    ],
  });
  assert.equal(empty.isError, true);
  assert.equal(duplicate.isError, true);
  assert.equal(calls, 0);
});

await check('tool: missing layers use the canonical layer_not_found envelope', async () => {
  const transport = {
    run: async () => {
      throw new Error('Layer not found: Missing');
    },
  } as unknown as TransportRouter;
  const definition = createLayerPropertiesTools(transport).find(
    ({ tool }) => tool.name === 'photoshop_rename_layers_batch'
  );
  assert.ok(definition);

  const raw = await definition.handler({
    renames: [{ oldName: 'Missing', newName: 'Found' }],
  });
  const enriched = enrichErrorResult(raw);
  const body = JSON.parse(enriched.content[0].type === 'text' ? enriched.content[0].text : '{}');
  assert.equal(enriched.isError, true);
  assert.equal(body.ok, false);
  assert.equal(body.code, 'layer_not_found');
  assert.equal(body.suggested_next_tool, 'photoshop_get_layers');
});

await check('ExtendScript: renames top-level and nested layers with parity envelope', () => {
  const hero = { name: 'Hero' };
  const caption = { name: 'Caption' };
  const group = documentWith([caption]);
  group.name = 'Typography';
  const doc = documentWith([hero, group], [group]);

  const result = executeExtendScript(SAMPLE, doc);
  assert.equal(hero.name, 'Subject');
  assert.equal(caption.name, 'Headline');
  assert.deepEqual(result, normalizeRenameLayersBatch(SAMPLE));
});

await check('ExtendScript: escapes quotes, slashes, newlines, and Unicode names', () => {
  const oldName = 'Old "quote" \\ path\n日本語';
  const newName = 'New "quote" \\ path\nレイヤー';
  const layer = { name: oldName };
  const result = executeExtendScript([{ oldName, newName }], documentWith([layer]));
  assert.equal(layer.name, newName);
  assert.deepEqual(result, normalizeRenameLayersBatch([{ oldName, newName }]));
});

await check('ExtendScript: missing preflight target leaves every layer unchanged', () => {
  const hero = { name: 'Hero' };
  const doc = documentWith([hero]);
  assert.throws(
    () =>
      executeExtendScript(
        [
          { oldName: 'Hero', newName: 'Changed' },
          { oldName: 'Missing', newName: 'Never' },
        ],
        doc
      ),
    /Layer not found: Missing/
  );
  assert.equal(hero.name, 'Hero');
});

await check('ExtendScript: no document uses the standard precondition error', () => {
  assert.throws(() => executeExtendScript(SAMPLE), /No active document/);
});

await check('UXP: builds preflight get and id-targeted batch rename descriptors', () => {
  assert.deepEqual(getLayerByNameDescriptor('Hero'), {
    _obj: 'get',
    _target: [{ _ref: 'layer', _name: 'Hero' }],
  });

  const descriptors = renameLayersBatchDescriptor([
    { oldName: 'Hero', newName: 'Subject', layerId: 17 },
    { oldName: 'Caption', newName: 'Headline', layerId: 23 },
  ]);
  assert.deepEqual(descriptors, [
    {
      _obj: 'set',
      _target: [{ _ref: 'layer', _id: 17 }],
      to: { _obj: 'layer', name: 'Subject' },
    },
    {
      _obj: 'set',
      _target: [{ _ref: 'layer', _id: 23 }],
      to: { _obj: 'layer', name: 'Headline' },
    },
  ]);
});

await check('UXP: normalizer matches the ExtendScript result envelope', () => {
  assert.deepEqual(normalizeRenameLayersBatch(SAMPLE), {
    renamedCount: 2,
    renames: SAMPLE,
  });
});

console.log(`\n${passed} rename_layers_batch checks passed.`);
