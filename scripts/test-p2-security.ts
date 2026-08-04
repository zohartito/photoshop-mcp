import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getPhotoshopExportsWorkingDir, resolveExportPath } from '../src/lib/export-paths.js';
import {
  MAX_DOCUMENT_DIMENSION_PX,
  validatePixelDimensions,
} from '../src/tools/resource-limits.js';
import { CUSTOM_PROVIDER_DISABLED_MESSAGE, saveCustomProvider } from '../src/ui/config.js';
import { customAdapter } from '../src/ui/providers/custom.js';
import { createDocumentTools } from '../src/tools/document-tools.js';
import { createStateTools } from '../src/tools/state-tools.js';
import type { TransportRouter } from '../src/transport/index.js';

// Pixel resource controls are runtime controls, not just advertised schema limits.
assert.equal(validatePixelDimensions(1, 1), null);
assert.match(validatePixelDimensions(MAX_DOCUMENT_DIMENSION_PX + 1, 1) ?? '', /must not exceed/);
assert.match(
  validatePixelDimensions(MAX_DOCUMENT_DIMENSION_PX, MAX_DOCUMENT_DIMENSION_PX) ?? '',
  /total pixels/
);
assert.match(validatePixelDimensions(Number.NaN, 1) ?? '', /positive integer/);

// Export recipes only receive the exports-root capability. Relative paths remain
// supported, while model-selected absolute paths and traversal fail closed.
const exportsDir = getPhotoshopExportsWorkingDir();
assert.equal(resolveExportPath('safe/output.jpg', 'jpg'), join(exportsDir, 'safe/output.jpg'));
assert.throws(() => resolveExportPath('/tmp/escape.jpg', 'jpg'), /Absolute export paths/);
assert.throws(() => resolveExportPath('../escape.jpg', 'jpg'), /escapes Photoshop MCP exports/);

// The retired UI cannot make authenticated requests to arbitrary custom endpoints.
assert.equal(customAdapter.validateApiKeyFormat('any-key'), false);
assert.deepEqual(await customAdapter.validateApiKey('any-key'), {
  ok: false,
  error: CUSTOM_PROVIDER_DISABLED_MESSAGE,
});
assert.throws(
  () =>
    saveCustomProvider({
      name: 'test',
      websiteUrl: 'https://example.test',
      apiKey: 'secret',
      baseUrl: 'http://127.0.0.1:1',
      apiFormat: 'openai',
      models: [],
      defaultModel: '',
    }),
  new RegExp(CUSTOM_PROVIDER_DISABLED_MESSAGE)
);

// Handler-level checks remain in force even when a caller bypasses the MCP
// registry's P1 schema validator.
let transportCalls = 0;
const transport = {
  runScript: async () => {
    transportCalls += 1;
    return {};
  },
} as unknown as TransportRouter;
const documentTools = createDocumentTools(transport);
const createDocument = documentTools.find(
  (definition) => definition.tool.name === 'photoshop_create_document'
);
const saveDocument = documentTools.find(
  (definition) => definition.tool.name === 'photoshop_save_document'
);
const preview = createStateTools(transport).find(
  (definition) => definition.tool.name === 'photoshop_get_preview'
);
assert.ok(createDocument && saveDocument && preview);
assert.equal(
  (await createDocument.handler({ width: 100, height: 100, resolution: Number.POSITIVE_INFINITY }))
    .isError,
  true
);
assert.equal(
  (await saveDocument.handler({ path: '/tmp/out.jpg', format: 'JPEG', quality: 13 })).isError,
  true
);
assert.equal((await preview.handler({ quality: 13 })).isError, true);
assert.equal((await preview.handler({ max_dimension_px: 0 })).isError, true);
assert.equal(transportCalls, 0, 'invalid numeric values must not reach JSX transport');

// Keep structural proof for dormant platform code without starting Photoshop,
// the UXP listener, a provider, or any external process.
const root = join(new URL('.', import.meta.url).pathname, '..');
const [
  macDetector,
  macExecutor,
  bridge,
  plugin,
  executionGuard,
  sessionAuthority,
  replayTombstones,
  router,
  prompts,
  recipeRegistry,
  documentToolSource,
  neuralTools,
  portraitRecipe,
] = await Promise.all([
  readFile(join(root, 'src/platform/macos-detector.ts'), 'utf8'),
  readFile(join(root, 'src/platform/macos-executor.ts'), 'utf8'),
  readFile(join(root, 'src/platform/uxp-bridge-server.ts'), 'utf8'),
  readFile(join(root, 'uxp-plugin/main.js'), 'utf8'),
  readFile(join(root, 'uxp-plugin/execution-guard.js'), 'utf8'),
  readFile(join(root, 'src/platform/uxp-bridge-session.ts'), 'utf8'),
  readFile(join(root, 'src/platform/uxp-replay-tombstones.ts'), 'utf8'),
  readFile(join(root, 'src/transport/router.ts'), 'utf8'),
  readFile(join(root, 'src/prompts/instructions.ts'), 'utf8'),
  readFile(join(root, 'src/tools/recipes/index.ts'), 'utf8'),
  readFile(join(root, 'src/tools/document-tools.ts'), 'utf8'),
  readFile(join(root, 'src/tools/neural-tools.ts'), 'utf8'),
  readFile(join(root, 'src/tools/recipes/enhance-portrait.ts'), 'utf8'),
]);
assert.doesNotMatch(macDetector, /execAsync|exec\(/);
assert.match(macDetector, /execFileAsync\('\/usr\/libexec\/PlistBuddy'/);
assert.doesNotMatch(macExecutor, /from 'child_process'|execFile\(/);
assert.match(macExecutor, /MACOS_EXECUTOR_DISABLED_MESSAGE/);
assert.match(bridge, /UXP_BRIDGE_PROTOCOL_VERSION = 4/);
assert.match(bridge, /MAX_COMMANDS = 32/);
assert.match(bridge, /MAX_EXECUTION_MS = 120_000/);
assert.match(bridge, /ACK_MARGIN_MS = 5_000/);
assert.match(bridge, /MAX_PENDING_LEASED_BYTES/);
assert.match(bridge, /JSON\.stringify\(command\)/);
assert.match(bridge, /MAX_RESULT_BYTES/);
assert.match(bridge, /isAuthenticated\(req\)/);
assert.match(bridge, /bridgeExecutionUncertain = true/);
assert.match(bridge, /url\.pathname === '\/uncertain'/);
assert.match(bridge, /url\.pathname === '\/handshake'/);
assert.match(bridge, /x-photoshop-mcp-session/);
assert.match(bridge, /sessionAuthority\.isCurrent\(requestedSession\)/);
assert.match(bridge, /lease\.ownerSession !== session/);
assert.match(bridge, /lease\.uncertain/);
assert.match(bridge, /replayTombstones\.add\(body\.id\)/);
assert.doesNotMatch(bridge, /const uncertain = new Set/);
assert.match(plugin, /Authorization: `Bearer \$\{bridgeToken\}`/);
assert.match(plugin, /BRIDGE_PROTOCOL_VERSION = 4/);
assert.match(plugin, /ack\.id !== payload\.id/);
assert.match(plugin, /X-Photoshop-MCP-Session/);
assert.match(plugin, /await establishSession\(\)/);
assert.match(plugin, /executionGuard\.isBusy\(\) \|\| executionGuard\.isQuarantined\(\)/);
assert.doesNotMatch(plugin, /function withWatchdog/);
assert.match(executionGuard, /this\.quarantined = true/);
assert.match(executionGuard, /Promise\.resolve\(\)\s*\.then\(execute\)/);
assert.match(executionGuard, /this\.onSettled\(result\)/);
assert.match(sessionAuthority, /establishInitial\(session: string, executionUncertain: boolean\)/);
assert.match(sessionAuthority, /this\.owner === session/);
assert.match(sessionAuthority, /this\.owner !== null \|\| executionUncertain/);
assert.match(replayTombstones, /maxEntries/);
assert.match(replayTombstones, /maxBytes/);
assert.match(replayTombstones, /ttlMs/);
assert.match(router, /task: \(remainingMs: number\) => Promise<T>/);
assert.match(router, /transport\.run\(\{ \.\.\.command, timeoutMs: remainingMs \}\)/);
assert.doesNotMatch(router, /Promise\.race/);
assert.match(router, /MAX_COMMAND_DEADLINE_MS = 120_000/);
assert.match(router, /isUxpBridgeExecutionUncertain\(\)/);
assert.doesNotMatch(prompts, /prepare_for_web/);
assert.doesNotMatch(recipeRegistry, /prepare-for-web/);
assert.match(documentToolSource, /MAX_DOCUMENT_RESOLUTION_DPI/);
assert.match(documentToolSource, /validateIntegerInRange\(quality, 1, 12/);
assert.match(neuralTools, /timeoutMs: 120_000/);
assert.match(portraitRecipe, /timeoutMs: 120_000/);
assert.doesNotMatch(neuralTools, /90_000/);
assert.doesNotMatch(portraitRecipe, /90_000/);

const stateTools = await readFile(join(root, 'src/tools/state-tools.ts'), 'utf8');
const prepareForWeb = await readFile(join(root, 'src/tools/recipes/prepare-for-web.ts'), 'utf8');
assert.match(stateTools, /constants\.O_RDONLY \| constants\.O_NOFOLLOW/);
assert.match(stateTools, /handle\.createReadStream/);
assert.match(stateTools, /mkdtemp\(join\(tmpdir\(\), 'photoshop-mcp-preview-'/);
assert.match(prepareForWeb, /feature_disabled/);
assert.doesNotMatch(prepareForWeb, /saveAs\(/);

console.log('P2 security regression: all assertions passed');
