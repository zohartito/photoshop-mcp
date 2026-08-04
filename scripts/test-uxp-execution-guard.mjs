import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../uxp-plugin/execution-guard.js', import.meta.url), 'utf8');
const module = { exports: {} };
vm.runInNewContext(source, { module, Promise, setTimeout, clearTimeout });
const { ExecutionGuard } = module.exports;

const timers = [];
const events = [];
let firstExecutions = 0;
let secondExecutions = 0;
let resolveFirst;

const guard = new ExecutionGuard({
  onUncertain: async (id) => events.push({ type: 'uncertain', id }),
  onSettled: async (result) => events.push({ type: 'settled', result }),
  setTimer: (callback, ms) => {
    const timer = { callback, ms, cleared: false };
    timers.push(timer);
    return timer;
  },
  clearTimer: (timer) => {
    timer.cleared = true;
  },
});

const first = new Promise((resolve) => {
  resolveFirst = resolve;
});
assert.equal(
  guard.start(
    'first',
    () => {
      firstExecutions += 1;
      return first;
    },
    120_000
  ),
  true
);
await Promise.resolve();
assert.equal(firstExecutions, 1, 'the first batchPlay starts once');
assert.equal(timers.length, 1);

// Fake a never-settling operation at the watchdog boundary. It remains active,
// reports uncertainty only, and refuses to invoke a second mutation.
timers[0].callback();
await Promise.resolve();
assert.equal(guard.isBusy(), true, 'an expired underlying operation stays in flight');
assert.equal(guard.isQuarantined(), true, 'watchdog expiry quarantines the plugin session');
assert.deepEqual(events, [{ type: 'uncertain', id: 'first' }]);
assert.equal(
  guard.start(
    'second',
    () => {
      secondExecutions += 1;
      return Promise.resolve({ mutated: 'second' });
    },
    20_000
  ),
  false,
  'a quarantined guard refuses the next command'
);
await Promise.resolve();
assert.equal(secondExecutions, 0, 'the refused command never starts a second Photoshop mutation');

// A late real settlement posts the only terminal result, but cannot unquarantine
// this plugin instance. Bridge-process restart plus plugin reload and a fresh initial handshake is
// required before a new guard can execute work again.
resolveFirst({ mutated: 'first' });
await Promise.resolve();
await Promise.resolve();
assert.equal(guard.isBusy(), false, 'late settlement clears only the active marker');
assert.equal(guard.isQuarantined(), true, 'late settlement does not clear quarantine');
assert.deepEqual(JSON.parse(JSON.stringify(events)), [
  { type: 'uncertain', id: 'first' },
  { type: 'settled', result: { id: 'first', ok: true, data: { mutated: 'first' } } },
]);
assert.equal(
  guard.start(
    'third',
    () => {
      secondExecutions += 1;
      return Promise.resolve({ mutated: 'third' });
    },
    20_000
  ),
  false,
  'a late settled mutation still cannot permit a second execution before bridge restart, plugin reload, and handshake'
);
assert.equal(secondExecutions, 0);

console.log('UXP execution guard regression: quarantine and late-settlement assertions passed');
