import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { Server } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = fileURLToPath(new URL('.', import.meta.url));
const rootDir = join(scriptDir, '..');

function runCliFlag(flag: '--help' | '--version') {
  return spawnSync(process.execPath, ['--import', 'tsx', 'src/ui/cli.ts', flag], {
    cwd: rootDir,
    encoding: 'utf8',
  });
}

for (const flag of ['--help', '--version'] as const) {
  const result = runCliFlag(flag);
  assert.equal(result.status, 0, `${flag} must remain an offline CLI control: ${result.stderr}`);
  assert.equal(result.stderr, '', `${flag} must not report a startup failure`);
  assert.match(result.stdout, /photoshop-mcp-ui/);
  if (flag === '--help') {
    assert.match(result.stdout, /security-disabled/i);
  }
}

const originalListen = Server.prototype.listen;
let listenCalls = 0;
const originalNodeEnv = process.env.NODE_ENV;
const originalUnsafeUiFlag = process.env.PHOTOSHOP_MCP_UI_ALLOW_UNSAFE;

Server.prototype.listen = function blockedListen(this: Server, ...args: unknown[]): Server {
  listenCalls += 1;
  throw new Error(`unexpected listener attempt with ${args.length} arguments`);
} as typeof Server.prototype.listen;
process.env.NODE_ENV = 'development';
process.env.PHOTOSHOP_MCP_UI_ALLOW_UNSAFE = '1';

try {
  const { startUIServer, UI_SECURITY_DISABLED_MESSAGE } = await import('../src/ui/server.js');
  const attempts = [
    { host: '127.0.0.1', port: 5174 },
    {
      host: '0.0.0.0',
      port: 5174,
      devOrigin: 'http://127.0.0.1:5173',
      // Extra JavaScript options must not become an escape hatch either.
      authenticated: true,
      tls: true,
    },
  ];

  for (const options of attempts) {
    let thrown: unknown;
    try {
      await startUIServer(options);
    } catch (error) {
      thrown = error;
    }
    assert.ok(thrown instanceof Error, `startUIServer(${options.host}) must reject`);
    assert.equal(thrown.message, UI_SECURITY_DISABLED_MESSAGE);
  }

  assert.equal(listenCalls, 0, 'security-disabled startup must never create a listener');
} finally {
  Server.prototype.listen = originalListen;
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  if (originalUnsafeUiFlag === undefined) delete process.env.PHOTOSHOP_MCP_UI_ALLOW_UNSAFE;
  else process.env.PHOTOSHOP_MCP_UI_ALLOW_UNSAFE = originalUnsafeUiFlag;
}

console.log('UI security-disablement regression: all assertions passed');
