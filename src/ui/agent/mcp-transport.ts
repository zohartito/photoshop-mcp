import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PHOTOSHOP_EXPORT_CHAT_ID_ENV } from '../../lib/export-paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const IS_DEV_SOURCE = __filename.endsWith('.ts');
const PHOTOSHOP_MCP_ENTRY = IS_DEV_SOURCE
  ? resolve(__dirname, '..', '..', 'index.ts')
  : resolve(__dirname, '..', '..', 'index.js');

export function buildSpawnArgs(): string[] {
  return IS_DEV_SOURCE
    ? ['--import', 'tsx', PHOTOSHOP_MCP_ENTRY]
    : [PHOTOSHOP_MCP_ENTRY];
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
