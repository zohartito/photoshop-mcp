#!/usr/bin/env node

import { getAppVersion } from '../analytics/app-version.js';
import { startUIServer } from './server.js';

interface CliFlags {
  port?: number;
  host: string;
  devOrigin?: string;
  noOpen: boolean;
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = { host: '127.0.0.1', noOpen: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--port' || arg === '-p') {
      const val = Number(argv[++i]);
      if (Number.isFinite(val) && val > 0) flags.port = val;
    } else if (arg === '--host') {
      flags.host = argv[++i] ?? flags.host;
    } else if (arg === '--dev-origin') {
      flags.devOrigin = argv[++i] ?? '';
    } else if (arg === '--no-open') {
      flags.noOpen = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (arg === '--version' || arg === '-v') {
      printVersion();
      process.exit(0);
    }
  }
  return flags;
}

function printHelp(): void {
  process.stdout.write(
    [
      'photoshop-mcp-ui — Browser UI compatibility command',
      '',
      'Usage: photoshop-mcp-ui [options]',
      '',
      'Normal standalone browser UI startup is security-disabled until authenticated',
      'pairing and TLS are implemented. No option can bypass this refusal.',
      '',
      'Options:',
      '  -p, --port <number>   Retained for compatibility (ignored)',
      '      --host <host>     Retained for compatibility (ignored)',
      '      --dev-origin <origin>  Retained for compatibility (ignored)',
      '      --no-open         Retained for compatibility (ignored)',
      '  -h, --help            Show this help',
      '  -v, --version         Show version',
      '',
    ].join('\n')
  );
}

function printVersion(): void {
  process.stdout.write(`photoshop-mcp-ui ${getAppVersion()}\n`);
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  await startUIServer({
    host: flags.host,
    port: flags.port ?? 0,
    devOrigin: flags.devOrigin,
  });
}

main().catch((err) => {
  process.stderr.write(`Failed to start Photoshop MCP UI: ${(err as Error).message}\n`);
  process.exit(1);
});
