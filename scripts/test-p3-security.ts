import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MAX_CLI_OUTPUT_BYTES,
  runCommand,
  runWindowsTreeTerminationSequence,
} from '../src/ui/providers/cli-utils.js';

const root =
  process.env.P3_SECURITY_PROJECT_ROOT ?? dirname(dirname(fileURLToPath(import.meta.url)));

// The CLI helper keeps a combined byte budget across stdout and stderr. This
// child is entirely local/offline and intentionally never reaches a provider.
const small = await runCommand(process.execPath, ['-e', "process.stdout.write('ok')"], {
  maxOutputBytes: 8,
});
assert.equal(small.exitCode, 0);
assert.equal(small.stdout, 'ok');
assert.equal(small.outputLimitExceeded, false);

const oversized = await runCommand(
  process.execPath,
  ['-e', "process.stdout.write('x'.repeat(256 * 1024)); setInterval(() => {}, 1_000)"],
  { maxOutputBytes: 1_024, timeoutMs: 5_000 }
);
assert.equal(oversized.outputLimitExceeded, true);
assert.ok(
  Buffer.byteLength(oversized.stdout) + Buffer.byteLength(oversized.stderr) <= 1_024,
  'captured child output must stay within the combined byte cap'
);
assert.equal(MAX_CLI_OUTPUT_BYTES, 64 * 1024);
assert.ok(
  process.env.P3_SECURITY_TOOL_MODE === 'tsx' || process.env.P3_SECURITY_TOOL_MODE === 'tsc',
  'the runner must execute the resolved JavaScript entrypoint through Node'
);

async function modelWindowsTreeTermination(
  initialOutcome: 'success' | 'error' | 'timeout',
  forceResult: boolean
) {
  const events: string[] = [];
  await runWindowsTreeTerminationSequence({
    runTreeKill: async (force) => {
      events.push(force ? 'tree:force' : `tree:initial:${initialOutcome}`);
      return force ? forceResult : initialOutcome === 'success';
    },
    wait: async () => {
      events.push('wait');
    },
    killLeader: () => events.push('leader:fallback'),
  });
  return events;
}

// An initial taskkill error or timeout cannot kill the leader before the force
// tree attempt. Only an unsuccessful forced attempt permits the fallback.
const initialTaskkillError = await modelWindowsTreeTermination('error', true);
const initialTaskkillTimeout = await modelWindowsTreeTermination('timeout', true);
assert.deepEqual(initialTaskkillError, ['tree:initial:error', 'wait', 'tree:force']);
assert.deepEqual(initialTaskkillTimeout, ['tree:initial:timeout', 'wait', 'tree:force']);
assert.deepEqual(await modelWindowsTreeTermination('error', false), [
  'tree:initial:error',
  'wait',
  'tree:force',
  'leader:fallback',
]);

// The timeout must cover the complete process group, not just its immediate
// leader. The descendant inherits the leader's stdout pipe and would otherwise
// keep Node waiting after the parent exits. This is local/offline only.
const descendantStartedAt = performance.now();
const descendant = await runCommand(
  process.execPath,
  [
    '-e',
    [
      "const { spawn } = require('node:child_process');",
      "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1_000)'], { stdio: ['ignore', 'inherit', 'inherit'] });",
      'process.stdout.write(`${child.pid}\\n`);',
      'setInterval(() => {}, 1_000);',
    ].join(' '),
  ],
  { timeoutMs: 100, maxOutputBytes: 1_024 }
);
const descendantElapsedMs = performance.now() - descendantStartedAt;
const descendantPid = Number.parseInt(descendant.stdout, 10);
assert.equal(descendant.timedOut, true);
assert.ok(Number.isSafeInteger(descendantPid) && descendantPid > 0, 'expected descendant PID');
assert.ok(
  descendantElapsedMs < 500,
  `100ms timeout must settle after a tight bounded margin (got ${descendantElapsedMs}ms)`
);
if (process.platform !== 'win32') {
  assert.throws(
    () => process.kill(descendantPid, 0),
    (error: NodeJS.ErrnoException) => error.code === 'ESRCH',
    'the POSIX process-group kill must leave no descendant running'
  );
} else {
  // Windows runs the same inherited-pipe descendant fixture. A successful
  // taskkill /T followed by /F /T must leave the recorded descendant dead.
  assert.throws(
    () => process.kill(descendantPid, 0),
    (error: NodeJS.ErrnoException) => error.code === 'ESRCH',
    'the Windows taskkill tree sequence must leave no descendant running'
  );
}

// Curves now has a bounded API: callers select one of two static presets rather
// than supplying an arbitrary point array to sort and serialize.
const adjustmentTools = await readFile(join(root, 'src/tools/adjustment-tools.ts'), 'utf8');
assert.match(
  adjustmentTools,
  /const CURVES_PRESETS: CurvesPreset\[\] = \['auto_tone', 'neutral'\]/
);
assert.match(adjustmentTools, /enum: CURVES_PRESETS/);
assert.doesNotMatch(adjustmentTools, /\bpoints\b/);

// P2 established the P3 UXP fail-closed controls. Keep explicit source-level
// regression checks here without starting the bridge or a Photoshop plugin.
const [bridge, guard, cliUtils, workflows] = await Promise.all([
  readFile(join(root, 'src/platform/uxp-bridge-server.ts'), 'utf8'),
  readFile(join(root, 'uxp-plugin/execution-guard.js'), 'utf8'),
  readFile(join(root, 'src/ui/providers/cli-utils.ts'), 'utf8'),
  Promise.all(
    ['release.yml', 'refresh-release-notes.yml'].map((file) =>
      readFile(join(root, '.github/workflows', file), 'utf8')
    )
  ),
]);
assert.match(bridge, /never redeliver it and quarantine all subsequent commands/);
assert.match(bridge, /markExecutionUncertain\(id, 'lease_deadline_exceeded'\)/);
assert.match(guard, /this\.quarantined = true/);
assert.match(guard, /this\.quarantined\) return false/);
assert.match(cliUtils, /resolvePath\(systemRoot, 'System32', 'taskkill\.exe'\)/);
assert.match(cliUtils, /\['\/pid', String\(child\.pid\), '\/t'/);
assert.match(cliUtils, /TREE_KILL_COMMAND_TIMEOUT_MS/);
const runner = await readFile(join(root, 'scripts/run-p3-security.mjs'), 'utf8');
assert.doesNotMatch(runner, /\.cmd/);
assert.match(runner, /execFileSync\(process\.execPath, \[tsx\.entrypoint, testFile\]/);
assert.match(runner, /resolveJavaScriptTool\('typescript', 'tsc'\)/);
for (const workflow of workflows) {
  for (const action of workflow.matchAll(/^\s*- uses: [^@\s]+@([^\s#]+)/gm)) {
    assert.match(action[1], /^[0-9a-f]{40}$/i, 'workflow actions must use immutable commit IDs');
  }
}

console.log('P3 security regression: all assertions passed');
