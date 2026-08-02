import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

import { PhotoshopAPIFactory } from '../src/api/photoshop-api.js';
import { parseExtendScriptPayload } from '../src/utils/extendscript-result.js';

const marker = '__photoshopMcpResultEvalMarker';
const globalRecord = globalThis as Record<string, unknown>;
globalRecord[marker] = false;

const executablePayload = `({ok:(globalThis.${marker}=true)})`;
const parsed = parseExtendScriptPayload(executablePayload);

assert.equal(parsed, executablePayload, 'non-JSON result text must remain inert data');
assert.equal(globalRecord[marker], false, 'result parsing must never execute returned text');
const executableArrayPayload = `[globalThis.${marker}=true]`;
assert.equal(parseExtendScriptPayload(executableArrayPayload), executableArrayPayload);
assert.equal(globalRecord[marker], false, 'array-shaped result text must also remain inert');
assert.deepEqual(parseExtendScriptPayload('{"ok":true,"count":2}'), { ok: true, count: 2 });
assert.equal(parseExtendScriptPayload('plain text'), 'plain text');

const wrapperSource = readFileSync(new URL('../src/api/photoshop-api.ts', import.meta.url), 'utf8');
assert.match(wrapperSource, /__mcpJsonStringify/);
assert.doesNotMatch(wrapperSource, /\.toSource\s*\(/);

let wrappedScript = '';
const connection = {
  getPhotoshopInfo: () => ({ version: '25.0' }),
  executeScript: async (script: string) => {
    wrappedScript = script;
    return '';
  },
};
const api = await new PhotoshopAPIFactory(
  connection as unknown as ConstructorParameters<typeof PhotoshopAPIFactory>[0]
).createAPI();
const expectedObject = {
  ok: true,
  summary: 'quote " slash \\ line\nseparator\u2028',
  nested: [1, null, false],
};
await api.executeScript(`return (${JSON.stringify(expectedObject)});`);
const serialized = runInNewContext(wrappedScript, {
  app: {
    preferences: { rulerUnits: 'pixels', typeUnits: 'points' },
    displayDialogs: 'all',
  },
  Units: { PIXELS: 'pixels' },
  TypeUnits: { POINTS: 'points' },
  DialogModes: { NO: 'none' },
});
assert.deepEqual(parseExtendScriptPayload(serialized), expectedObject);

delete globalRecord[marker];
console.log('ExtendScript result parser safety checks passed.');
