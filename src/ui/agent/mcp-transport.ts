import { createRequire } from 'node:module';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PHOTOSHOP_EXPORT_CHAT_ID_ENV } from '../../lib/export-paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const IS_DEV_SOURCE = __filename.endsWith('.ts');
const PHOTOSHOP_MCP_ENTRY = IS_DEV_SOURCE
  ? resolve(__dirname, '..', '..', 'index.ts')
  : resolve(__dirname, '..', '..', 'index.js');

export function buildSpawnArgs(): string[] {
  return IS_DEV_SOURCE ? ['--import', 'tsx', PHOTOSHOP_MCP_ENTRY] : [PHOTOSHOP_MCP_ENTRY];
}

export function buildGeminiSpawnArgs(): string[] {
  if (!IS_DEV_SOURCE) {
    return buildGeminiSpawnArgsForMode({
      entryPath: PHOTOSHOP_MCP_ENTRY,
      sourceMode: false,
    });
  }

  return buildGeminiSpawnArgsForMode({
    entryPath: PHOTOSHOP_MCP_ENTRY,
    sourceMode: true,
    tsxLoaderPath: createRequire(import.meta.url).resolve('tsx'),
  });
}

export function buildGeminiSpawnArgsForMode({
  entryPath,
  sourceMode,
  tsxLoaderPath,
}: {
  entryPath: string;
  sourceMode: boolean;
  tsxLoaderPath?: string;
}): string[] {
  if (!isAbsolute(entryPath)) {
    throw new Error('Gemini MCP entry path must be absolute');
  }
  if (!sourceMode) return [entryPath];
  if (!tsxLoaderPath || !isAbsolute(tsxLoaderPath)) {
    throw new Error('Gemini TSX loader path must be absolute in source mode');
  }
  return ['--import', tsxLoaderPath, entryPath];
}

export function sanitizedEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

export function buildMcpServerConfig(chatId?: string): {
  command: string;
  args: string[];
  env: Record<string, string>;
} {
  return {
    command: process.execPath,
    args: buildSpawnArgs(),
    env: {
      ...sanitizedEnv(),
      LOG_LEVEL: process.env.LOG_LEVEL ?? '2',
      ...(chatId ? { [PHOTOSHOP_EXPORT_CHAT_ID_ENV]: chatId } : {}),
    },
  };
}

const GEMINI_MCP_RUNTIME_ENV_NAMES = [
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

export function buildGeminiMcpServerConfig(chatId?: string): {
  command: string;
  args: string[];
  env: Record<string, string>;
} {
  return {
    command: process.execPath,
    args: buildGeminiSpawnArgs(),
    env: buildGeminiMcpEnvironment(chatId),
  };
}

function buildGeminiMcpEnvironment(chatId?: string): Record<string, string> {
  const env: Record<string, string> = {
    LOG_LEVEL: buildGeminiEnvironmentReference('LOG_LEVEL') ?? '2',
  };

  for (const name of GEMINI_MCP_RUNTIME_ENV_NAMES) {
    if (name === 'LOG_LEVEL') continue;
    const reference = buildGeminiEnvironmentReference(name);
    if (reference) env[name] = reference;
  }

  if (chatId) env[PHOTOSHOP_EXPORT_CHAT_ID_ENV] = chatId;
  return env;
}

function buildGeminiEnvironmentReference(name: string): string | undefined {
  return typeof process.env[name] === 'string' ? '${' + name + '}' : undefined;
}
