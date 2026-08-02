import assert from 'node:assert/strict';
import { Script } from 'node:vm';

import { ExtendScriptSnippets } from '../src/api/extendscript.js';
import { bindSkyBlend } from '../src/tools/recipes/sky-blend.js';
import type { TransportRouter } from '../src/transport/index.js';

function expectedLiteral(value: string): string {
  return JSON.stringify(value)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function assertLiteralOccurrences(
  label: string,
  source: string,
  value: string,
  expectedCount: number
): void {
  const literal = expectedLiteral(value);
  const count = source.split(literal).length - 1;
  assert.equal(
    count,
    expectedCount,
    `${label} must emit each caller-controlled string as one complete JSX literal`
  );
  assert.doesNotThrow(
    () => new Script(`(function() {\n${source}\n})`),
    `${label} must remain syntactically valid with hostile string data`
  );
}

const hostile = `C:\\tmp\\quo"te's\nseparator\u2028next\u2029"); globalThis.__jsxInjected = true; //`;
const hostileDirection = `left'to"right\n\u2028); globalThis.__directionInjected = true; //`;

assertLiteralOccurrences('saveAsPSD', ExtendScriptSnippets.saveAsPSD(hostile), hostile, 1);
assertLiteralOccurrences('saveAsJPEG', ExtendScriptSnippets.saveAsJPEG(hostile), hostile, 1);
assertLiteralOccurrences('saveAsPNG', ExtendScriptSnippets.saveAsPNG(hostile), hostile, 1);
assertLiteralOccurrences(
  'createTextLayer font',
  ExtendScriptSnippets.createTextLayer('text', 10, 20, 24, hostile),
  hostile,
  2
);
assertLiteralOccurrences('placeImage', ExtendScriptSnippets.placeImage(hostile), hostile, 3);
assertLiteralOccurrences('openImage', ExtendScriptSnippets.openImage(hostile), hostile, 2);
assertLiteralOccurrences('setTextFont', ExtendScriptSnippets.setTextFont(hostile), hostile, 2);
assertLiteralOccurrences(
  'moveLayerToPosition',
  ExtendScriptSnippets.moveLayerToPosition(hostile, 'ABOVE'),
  hostile,
  2
);
assertLiteralOccurrences(
  'playAction action name',
  ExtendScriptSnippets.playAction(hostile, 'set'),
  hostile,
  2
);
assertLiteralOccurrences(
  'playAction action set',
  ExtendScriptSnippets.playAction('action', hostile),
  hostile,
  2
);
assertLiteralOccurrences(
  'generativeFill',
  ExtendScriptSnippets.generativeFill(hostile),
  hostile,
  4
);

const expand = ExtendScriptSnippets.generativeExpand(hostileDirection, hostile);
assertLiteralOccurrences('generativeExpand prompt', expand, hostile, 2);
assertLiteralOccurrences('generativeExpand direction', expand, hostileDirection, 2);
assertLiteralOccurrences(
  'skyReplacement',
  ExtendScriptSnippets.skyReplacement(hostile),
  hostile,
  2
);
assertLiteralOccurrences(
  'generateImage',
  ExtendScriptSnippets.generateImage(hostile, 512, 512),
  hostile,
  3
);

let recipeScript = '';
const recipeTransport = {
  getVersion: async () => '24.0',
  runOperation: async (_label: string, operations: Array<Record<string, unknown>>) => {
    const params = operations[0]?.params as { script?: string } | undefined;
    recipeScript = params?.script ?? '';
    return '{"ok":true,"summary":"captured"}';
  },
};
await bindSkyBlend(recipeTransport as unknown as TransportRouter).handler({
  sky_image_path: hostile,
  use_native_sky: false,
});
assertLiteralOccurrences('sky blend recipe', recipeScript, hostile, 3);

console.log('ExtendScript literal boundary checks passed.');
