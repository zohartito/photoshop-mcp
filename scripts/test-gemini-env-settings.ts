import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access, readFile, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGeminiAccountWorkspace } from '../src/ui/agent/gemini-account.js';
import {
  buildGeminiSpawnArgs,
  buildGeminiSpawnArgsForMode,
  IS_DEV_SOURCE,
} from '../src/ui/agent/mcp-transport.js';

const sentinelSecretName = 'PSM_GEMINI_ENV_REGRESSION_SECRET';
const sentinelSecretValue = 'psm-gemini-unrelated-secret-sentinel';
const supportedEnvironmentNames = [
  'LOG_LEVEL',
  'PHOTOSHOP_MCP_HOME',
  'PHOTOSHOP_PATH',
  'PHOTOSHOP_MCP_TRANSPORT',
  'PHOTOSHOP_UXP_BRIDGE_PORT',
  'ANALYTICS_DISABLED',
  'POSTHOG_DISABLED',
  'ANALYTICS_PROVIDER',
  'MIXPANEL_TOKEN',
  'MIXPANEL_API_HOST',
  'MIXPANEL_NODE_HOST',
  'POSTHOG_KEY',
  'POSTHOG_API_HOST',
  'POSTHOG_UI_HOST',
] as const;
const savedEnvironment = new Map(
  [...supportedEnvironmentNames, sentinelSecretName].map((name) => [name, process.env[name]])
);
const scriptDir = fileURLToPath(new URL('.', import.meta.url));
const rootDir = join(scriptDir, '..');
const geminiAccountPath = join(rootDir, 'src', 'ui', 'agent', 'gemini-account.ts');

function setControlledEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function assertExactEnvironment(
  actual: Record<string, unknown>,
  expected: Record<string, string>
): void {
  assert.equal(
    Object.keys(actual).length,
    Object.keys(expected).length,
    'Gemini MCP environment must contain only expected keys'
  );
  for (const [name, value] of Object.entries(expected)) {
    assert.ok(Object.hasOwn(actual, name), `Gemini MCP environment must include ${name}`);
    assert.ok(
      actual[name] === value,
      `Gemini MCP environment must use the exact literal or variable reference for ${name}`
    );
  }
}

async function readGeminiMcpEnvironment(
  workspace: Awaited<ReturnType<typeof createGeminiAccountWorkspace>>
): Promise<{ settingsText: string; env: Record<string, unknown>; command: unknown }> {
  const settingsText = await readFile(workspace.settingsPath, 'utf8');
  const settings = JSON.parse(settingsText) as {
    mcpServers?: Record<string, { command?: unknown; env?: unknown }>;
  };
  const photoshopConfig = settings.mcpServers?.photoshop;
  assert.ok(photoshopConfig, 'Gemini settings must contain the Photoshop MCP configuration');
  assert.ok(
    typeof photoshopConfig.env === 'object' && photoshopConfig.env !== null,
    'Gemini Photoshop MCP configuration must contain an environment object'
  );
  return {
    settingsText,
    env: photoshopConfig.env as Record<string, unknown>,
    command: photoshopConfig.command,
  };
}

async function assertPrivateSettingsAndCleanup(
  workspace: Awaited<ReturnType<typeof createGeminiAccountWorkspace>>
): Promise<void> {
  if (process.platform !== 'win32') {
    assert.equal(
      (await stat(workspace.settingsPath)).mode & 0o777,
      0o600,
      'Gemini settings must have POSIX mode 0600'
    );
  }
  const settingsPath = workspace.settingsPath;
  await workspace.cleanup();
  await assert.rejects(
    () => access(settingsPath),
    { code: 'ENOENT' },
    'Gemini workspace cleanup must remove settings.json'
  );
}

function expectedEnvironment(chatId: string, includeReferences: boolean): Record<string, string> {
  const env: Record<string, string> = {
    LOG_LEVEL: includeReferences ? '${LOG_LEVEL}' : '2',
  };
  if (includeReferences) {
    for (const name of supportedEnvironmentNames) {
      if (name !== 'LOG_LEVEL') env[name] = '${' + name + '}';
    }
  }
  env.PHOTOSHOP_EXPORT_CHAT_ID = chatId;
  return env;
}

for (const name of supportedEnvironmentNames) setControlledEnvironment(name, undefined);
setControlledEnvironment(sentinelSecretName, sentinelSecretValue);

let defaultWorkspace: Awaited<ReturnType<typeof createGeminiAccountWorkspace>> | undefined;
let referenceWorkspace: Awaited<ReturnType<typeof createGeminiAccountWorkspace>> | undefined;
try {
  const defaultChatId = `gemini-env-default-${randomUUID()}`;
  defaultWorkspace = await createGeminiAccountWorkspace(defaultChatId);
  const defaultConfig = await readGeminiMcpEnvironment(defaultWorkspace);
  assert.ok(
    defaultConfig.command === process.execPath && isAbsolute(defaultConfig.command),
    'Gemini MCP command must be the absolute Node executable path'
  );
  assertExactEnvironment(defaultConfig.env, expectedEnvironment(defaultChatId, false));
  assert.ok(
    !defaultConfig.settingsText.includes(sentinelSecretName) &&
      !defaultConfig.settingsText.includes(sentinelSecretValue),
    'Gemini settings must never contain an unrelated secret key or literal'
  );
  await assertPrivateSettingsAndCleanup(defaultWorkspace);
  defaultWorkspace = undefined;

  const supportedValues = new Map<string, string>();
  for (const name of supportedEnvironmentNames) {
    const value = `gemini-env-supported-value-${name.toLowerCase()}`;
    supportedValues.set(name, value);
    setControlledEnvironment(name, value);
  }

  const referenceChatId = `gemini-env-reference-${randomUUID()}`;
  referenceWorkspace = await createGeminiAccountWorkspace(referenceChatId);
  const referenceConfig = await readGeminiMcpEnvironment(referenceWorkspace);
  assertExactEnvironment(referenceConfig.env, expectedEnvironment(referenceChatId, true));
  assert.ok(
    !referenceConfig.settingsText.includes(sentinelSecretName) &&
      !referenceConfig.settingsText.includes(sentinelSecretValue),
    'Gemini settings must never contain an unrelated secret key or literal'
  );
  for (const value of supportedValues.values()) {
    assert.ok(
      !referenceConfig.settingsText.includes(value),
      'Gemini settings must retain supported runtime values as variable references, not literals'
    );
  }
  await assertPrivateSettingsAndCleanup(referenceWorkspace);
  referenceWorkspace = undefined;

  assert.equal(IS_DEV_SOURCE, true, 'this regression must exercise the source-mode launcher');
  const sourceArgs = buildGeminiSpawnArgs();
  assert.equal(sourceArgs.length, 3, 'source-mode Gemini launch must include a loader and entry');
  assert.equal(sourceArgs[0], '--import');
  assert.ok(isAbsolute(sourceArgs[1]), 'source-mode Gemini loader must be absolute');
  assert.ok(isAbsolute(sourceArgs[2]), 'source-mode Gemini entry must be absolute');
  await Promise.all([access(sourceArgs[1]), access(sourceArgs[2])]);

  const packagedEntry = join(rootDir, 'dist', 'index.js');
  const packagedArgs = buildGeminiSpawnArgsForMode({
    entryPath: packagedEntry,
    sourceMode: false,
  });
  assert.equal(packagedArgs.length, 1, 'packaged Gemini launch must not add a loader');
  assert.ok(packagedArgs[0] === packagedEntry && isAbsolute(packagedArgs[0]));
  assert.ok(!packagedArgs.includes('--import'), 'packaged Gemini launch must be loader-free');

  const geminiAccountSource = await readFile(geminiAccountPath, 'utf8');
  assert.match(geminiAccountSource, /buildGeminiMcpServerConfig/);
  assert.doesNotMatch(geminiAccountSource, /buildMcpServerConfig/);
  assert.match(
    geminiAccountSource,
    /env:\s*{\s*\.\.\.process\.env,\s*\.\.\.invocation\.env,?\s*}/,
    'Gemini CLI process spawning must preserve its parent environment'
  );
} finally {
  try {
    if (referenceWorkspace) await referenceWorkspace.cleanup();
    if (defaultWorkspace) await defaultWorkspace.cleanup();
  } finally {
    for (const [name, value] of savedEnvironment) setControlledEnvironment(name, value);
  }
}

console.log('Gemini environment settings regression: all assertions passed');
