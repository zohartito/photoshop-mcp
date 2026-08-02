import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { Options as ClaudeQueryOptions } from '@anthropic-ai/claude-agent-sdk';

type CliAccountWorkspacePurpose = 'claude-account' | 'gemini-account' | 'gemini-probe';

export interface CliAccountWorkspace {
  workspaceDir: string;
  cleanup(): Promise<void>;
}

export interface CliAccountMcpServerConfig {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface GeminiCliWorkspaceFiles {
  policyPath: string;
  trustedFoldersPath: string;
}

export interface GeminiChatWorkspaceFiles extends GeminiCliWorkspaceFiles {
  settingsPath: string;
}

export interface GeminiCliInvocation {
  args: string[];
  cwd: string;
  env: Record<string, string>;
}

type ClaudeMcpServerConfig = NonNullable<ClaudeQueryOptions['mcpServers']>[string];

export type ClaudeAccountSecurityOptions = Pick<
  ClaudeQueryOptions,
  | 'allowedTools'
  | 'cwd'
  | 'mcpServers'
  | 'permissionMode'
  | 'settingSources'
  | 'settings'
  | 'strictMcpConfig'
  | 'tools'
>;

export async function createCliAccountWorkspace(
  purpose: CliAccountWorkspacePurpose
): Promise<CliAccountWorkspace> {
  const realTempDir = await realpath(tmpdir());
  const prefix = join(realTempDir, `photoshop-mcp-${purpose}-`);
  let createdWorkspaceDir: string | undefined;

  try {
    createdWorkspaceDir = await mkdtemp(prefix);
    await setPrivateMode(createdWorkspaceDir, 0o700);

    const realWorkspaceDir = await realpath(createdWorkspaceDir);
    if (
      dirname(realWorkspaceDir) !== realTempDir ||
      !basename(realWorkspaceDir).startsWith(`photoshop-mcp-${purpose}-`)
    ) {
      throw new Error('Failed to create an isolated CLI account workspace');
    }

    return {
      workspaceDir: realWorkspaceDir,
      cleanup: async () => {
        await rm(realWorkspaceDir, {
          force: true,
          maxRetries: 3,
          recursive: true,
          retryDelay: 100,
        });
      },
    };
  } catch (error) {
    if (createdWorkspaceDir) {
      await rm(createdWorkspaceDir, {
        force: true,
        maxRetries: 3,
        recursive: true,
        retryDelay: 100,
      }).catch(() => undefined);
    }
    throw error;
  }
}

export function buildClaudeAccountSecurityOptions({
  workspaceDir,
  photoshopMcpServer,
}: {
  workspaceDir: string;
  photoshopMcpServer: ClaudeMcpServerConfig;
}): ClaudeAccountSecurityOptions {
  return {
    cwd: workspaceDir,
    tools: [],
    allowedTools: ['mcp__photoshop__*'],
    permissionMode: 'dontAsk',
    settingSources: [],
    strictMcpConfig: true,
    mcpServers: { photoshop: photoshopMcpServer },
    settings: {
      sandbox: {
        enabled: true,
        failIfUnavailable: true,
        allowUnsandboxedCommands: false,
      },
    },
  };
}

export async function writeGeminiChatWorkspaceFiles(
  workspace: CliAccountWorkspace,
  photoshopMcpServer: CliAccountMcpServerConfig
): Promise<GeminiChatWorkspaceFiles> {
  const workspaceDir = await realpath(workspace.workspaceDir);
  const geminiDir = join(workspaceDir, '.gemini');
  const settingsPath = join(geminiDir, 'settings.json');
  const policyPath = join(geminiDir, 'photoshop-only-policy.toml');
  const trustedFoldersPath = join(geminiDir, 'trustedFolders.json');

  await createPrivateDirectory(geminiDir);
  await Promise.all([
    writePrivateFile(
      settingsPath,
      JSON.stringify(
        {
          mcpServers: {
            photoshop: {
              command: photoshopMcpServer.command,
              args: photoshopMcpServer.args,
              env: photoshopMcpServer.env,
              trust: true,
              timeout: 120_000,
            },
          },
        },
        null,
        2
      )
    ),
    writePrivateFile(policyPath, buildGeminiPhotoshopOnlyPolicy()),
    writePrivateFile(
      trustedFoldersPath,
      JSON.stringify({ [workspaceDir]: 'TRUST_FOLDER' }, null, 2)
    ),
  ]);

  return { settingsPath, policyPath, trustedFoldersPath };
}

export async function writeGeminiProbeWorkspaceFiles(
  workspace: CliAccountWorkspace
): Promise<GeminiCliWorkspaceFiles> {
  const workspaceDir = await realpath(workspace.workspaceDir);
  const policyPath = join(workspaceDir, 'deny-all-policy.toml');
  const trustedFoldersPath = join(workspaceDir, 'trustedFolders.json');

  await Promise.all([
    writePrivateFile(policyPath, buildGeminiDenyAllPolicy()),
    writePrivateFile(
      trustedFoldersPath,
      JSON.stringify({ [workspaceDir]: 'TRUST_FOLDER' }, null, 2)
    ),
  ]);

  return { policyPath, trustedFoldersPath };
}

export function buildGeminiChatCliInvocation({
  fullPrompt,
  modelId,
  workspace,
}: {
  fullPrompt: string;
  modelId: string;
  workspace: CliAccountWorkspace & GeminiCliWorkspaceFiles;
}): GeminiCliInvocation {
  return {
    args: [
      '-p',
      fullPrompt,
      '-m',
      modelId,
      '--output-format',
      'stream-json',
      '--approval-mode',
      'default',
      '--sandbox',
      '--allowed-mcp-server-names',
      'photoshop',
      '--policy',
      workspace.policyPath,
    ],
    cwd: workspace.workspaceDir,
    env: buildGeminiCliTrustEnvironment(workspace.trustedFoldersPath),
  };
}

export function buildGeminiProbeCliInvocation(
  workspace: CliAccountWorkspace & GeminiCliWorkspaceFiles
): GeminiCliInvocation {
  return {
    args: [
      '-p',
      'ping',
      '--output-format',
      'json',
      '--approval-mode',
      'default',
      '--sandbox',
      // Gemini parses this as an allowlist with no valid server names, preventing
      // global MCP discovery from starting host-configured MCP servers.
      '--allowed-mcp-server-names',
      '',
      '--policy',
      workspace.policyPath,
    ],
    cwd: workspace.workspaceDir,
    env: buildGeminiCliTrustEnvironment(workspace.trustedFoldersPath),
  };
}

export function buildGeminiCliTrustEnvironment(trustedFoldersPath: string): Record<string, string> {
  return {
    GEMINI_CLI_TRUSTED_FOLDERS_PATH: trustedFoldersPath,
    GEMINI_CLI_TRUST_WORKSPACE: 'false',
  };
}

export function buildGeminiPhotoshopOnlyPolicy(): string {
  return [
    '[[rule]]',
    'toolName = "*"',
    'decision = "deny"',
    'priority = 900',
    '',
    '[[rule]]',
    'toolName = "*"',
    'mcpName = "photoshop"',
    'decision = "allow"',
    'priority = 999',
    '',
  ].join('\n');
}

export function buildGeminiDenyAllPolicy(): string {
  return ['[[rule]]', 'toolName = "*"', 'decision = "deny"', 'priority = 999', ''].join('\n');
}

async function createPrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { mode: 0o700, recursive: true });
  await setPrivateMode(path, 0o700);
}

async function writePrivateFile(path: string, contents: string): Promise<void> {
  await writeFile(path, contents, { encoding: 'utf8', mode: 0o600 });
  await setPrivateMode(path, 0o600);
}

async function setPrivateMode(path: string, mode: number): Promise<void> {
  try {
    await chmod(path, mode);
  } catch (error) {
    // Windows does not provide POSIX permissions. On POSIX platforms, a failure
    // to tighten the workspace is a security failure and must stop execution.
    if (process.platform !== 'win32') throw error;
  }
}
