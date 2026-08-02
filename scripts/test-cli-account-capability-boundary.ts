import assert from 'node:assert/strict';
import { access, readFile, readdir, realpath, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildClaudeAccountSecurityOptions,
  buildGeminiChatCliInvocation,
  buildGeminiDenyAllPolicy,
  buildGeminiPhotoshopOnlyPolicy,
  buildGeminiProbeCliInvocation,
  type CliAccountWorkspace,
} from '../src/ui/agent/cli-account-security.js';
import {
  buildClaudeAccountQueryOptions,
  createClaudeAccountWorkspace,
} from '../src/ui/agent/claude-account.js';
import { createGeminiAccountWorkspace } from '../src/ui/agent/gemini-account.js';
import { createGoogleCliProbeWorkspace } from '../src/ui/providers/google.js';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = join(scriptDir, '..');
const callerCwd = await realpath(process.cwd());

const photoshopOnlyPolicy = `[[rule]]
toolName = "*"
decision = "deny"
priority = 900

[[rule]]
toolName = "*"
mcpName = "photoshop"
decision = "allow"
priority = 999
`;

const denyAllPolicy = `[[rule]]
toolName = "*"
decision = "deny"
priority = 999
`;

async function readSource(path: string): Promise<string> {
  return readFile(join(rootDir, path), 'utf8');
}

async function assertPrivateMode(path: string, expectedMode: number): Promise<void> {
  if (process.platform === 'win32') return;
  const mode = (await stat(path)).mode & 0o777;
  assert.equal(mode, expectedMode, `${path} must have mode ${expectedMode.toString(8)}`);
}

async function assertWorkspaceCleanup(workspace: CliAccountWorkspace): Promise<void> {
  const workspaceDir = workspace.workspaceDir;
  await workspace.cleanup();
  await assert.rejects(
    () => access(workspaceDir),
    { code: 'ENOENT' },
    `cleanup must remove ${workspaceDir}`
  );
}

async function verifyWorkspace<T extends CliAccountWorkspace>(
  workspace: T,
  verify: (workspace: T) => Promise<void>
): Promise<void> {
  try {
    await verify(workspace);
  } finally {
    await assertWorkspaceCleanup(workspace);
  }
}

function parsePolicy(policy: string): Array<Record<string, string | number>> {
  const rules: Array<Record<string, string | number>> = [];
  let currentRule: Record<string, string | number> | undefined;

  for (const line of policy.trimEnd().split('\n')) {
    if (line === '[[rule]]') {
      currentRule = {};
      rules.push(currentRule);
      continue;
    }
    if (line === '') continue;
    assert.ok(currentRule, `policy value must be inside a rule: ${line}`);
    const [key, value] = line.split(' = ');
    assert.ok(key && value, `policy value must use key = value syntax: ${line}`);
    currentRule[key] = value.startsWith('"') ? value.slice(1, -1) : Number(value);
  }

  return rules;
}

function collectTrustKeys(value: unknown, path = ''): string[] {
  if (typeof value !== 'object' || value === null) return [];
  const keys: string[] = [];
  for (const [key, nested] of Object.entries(value)) {
    const nestedPath = path ? `${path}.${key}` : key;
    if (key === 'trust') keys.push(nestedPath);
    keys.push(...collectTrustKeys(nested, nestedPath));
  }
  return keys;
}

function assertSafeGeminiArgs(args: string[]): void {
  for (const dangerousArg of [
    '--yolo',
    '--skip-trust',
    '--allowed-tools',
    'yolo',
    'auto_edit',
    'plan',
  ]) {
    assert.ok(!args.includes(dangerousArg), `Gemini invocation must not include ${dangerousArg}`);
  }
}

async function verifyClaudeBoundary(): Promise<void> {
  const workspace = await createClaudeAccountWorkspace();
  await verifyWorkspace(workspace, async (claudeWorkspace) => {
    await assertPrivateMode(claudeWorkspace.workspaceDir, 0o700);
    assert.notEqual(claudeWorkspace.workspaceDir, callerCwd, 'Claude must not use the caller cwd');

    const directSecurityOptions = buildClaudeAccountSecurityOptions({
      workspaceDir: claudeWorkspace.workspaceDir,
      photoshopMcpServer: {
        command: process.execPath,
        args: ['photoshop-mcp-test'],
        env: { PSM_BOUNDARY_TEST: '1' },
      },
    });
    assert.deepEqual(directSecurityOptions.tools, []);
    assert.deepEqual(directSecurityOptions.allowedTools, ['mcp__photoshop__*']);
    assert.equal(directSecurityOptions.permissionMode, 'dontAsk');
    assert.deepEqual(directSecurityOptions.settingSources, []);
    assert.equal(directSecurityOptions.strictMcpConfig, true);
    assert.deepEqual(Object.keys(directSecurityOptions.mcpServers ?? {}), ['photoshop']);
    assert.deepEqual(directSecurityOptions.settings, {
      sandbox: {
        enabled: true,
        failIfUnavailable: true,
        allowUnsandboxedCommands: false,
      },
    });

    const options = buildClaudeAccountQueryOptions({
      modelId: 'claude-test-model',
      systemPrompt: 'boundary test',
      chatId: 'boundary-chat',
      workspaceDir: claudeWorkspace.workspaceDir,
      abortController: new AbortController(),
    });
    assert.equal(options.cwd, claudeWorkspace.workspaceDir);
    assert.deepEqual(options.tools, []);
    assert.deepEqual(options.allowedTools, ['mcp__photoshop__*']);
    assert.equal(options.permissionMode, 'dontAsk');
    assert.deepEqual(options.settingSources, []);
    assert.equal(options.strictMcpConfig, true);
    assert.deepEqual(Object.keys(options.mcpServers ?? {}), ['photoshop']);
    assert.equal(Object.hasOwn(options, 'sandbox'), false, 'sandbox must be supplied as settings');
    assert.deepEqual(options.settings, directSecurityOptions.settings);
  });
}

async function verifyGeminiChatBoundary(): Promise<void> {
  const workspace = await createGeminiAccountWorkspace('boundary-chat');
  await verifyWorkspace(workspace, async (geminiWorkspace) => {
    const realWorkspaceDir = await realpath(geminiWorkspace.workspaceDir);
    const geminiDir = dirname(geminiWorkspace.settingsPath);
    await Promise.all([
      assertPrivateMode(geminiWorkspace.workspaceDir, 0o700),
      assertPrivateMode(geminiDir, 0o700),
      assertPrivateMode(geminiWorkspace.settingsPath, 0o600),
      assertPrivateMode(geminiWorkspace.policyPath, 0o600),
      assertPrivateMode(geminiWorkspace.trustedFoldersPath, 0o600),
    ]);
    assert.notEqual(
      geminiWorkspace.workspaceDir,
      callerCwd,
      'Gemini chat must not use the caller cwd'
    );

    const settings = JSON.parse(await readFile(geminiWorkspace.settingsPath, 'utf8')) as Record<
      string,
      unknown
    >;
    assert.deepEqual(Object.keys(settings), ['mcpServers']);
    const mcpServers = settings.mcpServers as Record<string, Record<string, unknown>>;
    assert.deepEqual(Object.keys(mcpServers), ['photoshop']);
    assert.equal(mcpServers.photoshop.trust, true);
    assert.deepEqual(collectTrustKeys(settings), ['mcpServers.photoshop.trust']);

    const policy = await readFile(geminiWorkspace.policyPath, 'utf8');
    assert.equal(policy, photoshopOnlyPolicy);
    assert.equal(buildGeminiPhotoshopOnlyPolicy(), photoshopOnlyPolicy);
    assert.deepEqual(parsePolicy(policy), [
      { toolName: '*', decision: 'deny', priority: 900 },
      { toolName: '*', mcpName: 'photoshop', decision: 'allow', priority: 999 },
    ]);
    assert.deepEqual(JSON.parse(await readFile(geminiWorkspace.trustedFoldersPath, 'utf8')), {
      [realWorkspaceDir]: 'TRUST_FOLDER',
    });

    const invocation = buildGeminiChatCliInvocation({
      fullPrompt: 'boundary prompt',
      modelId: 'gemini-test-model',
      workspace: geminiWorkspace,
    });
    assert.deepEqual(invocation.args, [
      '-p',
      'boundary prompt',
      '-m',
      'gemini-test-model',
      '--output-format',
      'stream-json',
      '--approval-mode',
      'default',
      '--sandbox',
      '--allowed-mcp-server-names',
      'photoshop',
      '--policy',
      geminiWorkspace.policyPath,
    ]);
    assert.equal(invocation.cwd, geminiWorkspace.workspaceDir);
    assert.notEqual(invocation.cwd, callerCwd);
    assert.deepEqual(invocation.env, {
      GEMINI_CLI_TRUSTED_FOLDERS_PATH: geminiWorkspace.trustedFoldersPath,
      GEMINI_CLI_TRUST_WORKSPACE: 'false',
    });
    assertSafeGeminiArgs(invocation.args);
  });
}

async function verifyGoogleProbeBoundary(): Promise<void> {
  const workspace = await createGoogleCliProbeWorkspace();
  await verifyWorkspace(workspace, async (probeWorkspace) => {
    const realWorkspaceDir = await realpath(probeWorkspace.workspaceDir);
    await Promise.all([
      assertPrivateMode(probeWorkspace.workspaceDir, 0o700),
      assertPrivateMode(probeWorkspace.policyPath, 0o600),
      assertPrivateMode(probeWorkspace.trustedFoldersPath, 0o600),
    ]);
    assert.notEqual(
      probeWorkspace.workspaceDir,
      callerCwd,
      'Google probe must not use the caller cwd'
    );
    assert.deepEqual((await readdir(probeWorkspace.workspaceDir)).sort(), [
      'deny-all-policy.toml',
      'trustedFolders.json',
    ]);
    await assert.rejects(() =>
      access(join(probeWorkspace.workspaceDir, '.gemini', 'settings.json'))
    );

    const policy = await readFile(probeWorkspace.policyPath, 'utf8');
    assert.equal(policy, denyAllPolicy);
    assert.equal(buildGeminiDenyAllPolicy(), denyAllPolicy);
    assert.deepEqual(parsePolicy(policy), [{ toolName: '*', decision: 'deny', priority: 999 }]);
    assert.deepEqual(JSON.parse(await readFile(probeWorkspace.trustedFoldersPath, 'utf8')), {
      [realWorkspaceDir]: 'TRUST_FOLDER',
    });

    const invocation = buildGeminiProbeCliInvocation(probeWorkspace);
    assert.deepEqual(invocation.args, [
      '-p',
      'ping',
      '--output-format',
      'json',
      '--approval-mode',
      'default',
      '--sandbox',
      '--allowed-mcp-server-names',
      '',
      '--policy',
      probeWorkspace.policyPath,
    ]);
    assert.equal(invocation.cwd, probeWorkspace.workspaceDir);
    assert.notEqual(invocation.cwd, callerCwd);
    assert.deepEqual(invocation.env, {
      GEMINI_CLI_TRUSTED_FOLDERS_PATH: probeWorkspace.trustedFoldersPath,
      GEMINI_CLI_TRUST_WORKSPACE: 'false',
    });
    assertSafeGeminiArgs(invocation.args);
  });
}

async function verifyNoDangerousProductionFallbacks(): Promise<void> {
  const [claudeSource, geminiSource, googleSource, securitySource] = await Promise.all([
    readSource('src/ui/agent/claude-account.ts'),
    readSource('src/ui/agent/gemini-account.ts'),
    readSource('src/ui/providers/google.ts'),
    readSource('src/ui/agent/cli-account-security.ts'),
  ]);
  const productionSources = [claudeSource, geminiSource, googleSource, securitySource].join('\n');

  assert.doesNotMatch(productionSources, /bypassPermissions/);
  assert.doesNotMatch(productionSources, /allowDangerouslySkipPermissions/);
  assert.doesNotMatch(productionSources, /--skip-trust/);
  assert.doesNotMatch(productionSources, /(?:--approval-mode['",\s]+)(?:yolo|auto_edit|plan)/);
  assert.doesNotMatch(productionSources, /--allowed-tools/);
  assert.doesNotMatch(productionSources, /GEMINI_CLI_TRUST_WORKSPACE:\s*['"]true['"]/);
  assert.match(claudeSource, /buildClaudeAccountSecurityOptions/);
  assert.match(geminiSource, /buildGeminiChatCliInvocation/);
  assert.match(googleSource, /buildGeminiProbeCliInvocation/);
  assert.match(claudeSource, /q\?\.close\(\);[\s\S]*await workspace\.cleanup\(\)/);
  assert.match(geminiSource, /await childClose;[\s\S]*await workspace\.cleanup\(\)/);
  assert.match(googleSource, /finally\s*{[\s\S]*await workspace\.cleanup\(\)/);
}

await verifyClaudeBoundary();
await verifyGeminiChatBoundary();
await verifyGoogleProbeBoundary();
await verifyNoDangerousProductionFallbacks();

console.log('CLI account capability boundary regression: all assertions passed');
