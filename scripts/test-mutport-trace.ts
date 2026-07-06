/**
 * Offline routing trace for the mutating-family flip (transport-layer.md §14).
 * Run: npx tsx scripts/test-mutport-trace.ts   (no live Photoshop)
 *
 * Proves the ONE invariant the offline gate must establish for the default path:
 * on the default `auto` preference, a flipped tool's
 *   transport.run({ name, params: { script } })
 * reaches Photoshop as the SAME PsCommand → script → executeScript(script) call the
 * old transport.runScript(script) made — byte-identical script, same one call. The
 * only intended change is the script's CONTENT (the additive §6.8 layerId read-back),
 * which the static test already pins; here we pin the DELIVERY.
 *
 * Method: construct a TransportRouter over a fake PhotoshopConnection that records
 * every executeScript() argument instead of talking to PS. Because
 * ExtendScriptTransport builds a fresh PhotoshopAPIFactory(connection).createAPI()
 * per call and createAPI() hardcodes ExtendScript, the fake connection is the only
 * seam we need — nothing hits AppleScript/osascript/PS.
 */
import assert from 'node:assert/strict';
import { TransportRouter } from '../src/transport/index.js';
import { ExtendScriptSnippets } from '../src/api/extendscript.js';
import type { PhotoshopConnection } from '../src/platform/connection.js';

const calls: Array<{ script: string; timeoutMs?: number }> = [];

// A minimal PhotoshopConnection stand-in. ExtendScriptTransport only ever calls
// createAPI().executeScript() (via runScript) plus ping()/getVersion(); the
// ExtendScriptPhotoshopAPI it builds delegates executeScript to connection.execute-
// Script, so recording there captures exactly what would reach PS.
const fakeConnection = {
  async executeScript(script: string, timeoutMs?: number): Promise<unknown> {
    calls.push({ script, timeoutMs });
    // Return a benign already-parsed payload so the tool layer is happy; the macOS
    // executor would normally parse the "ERROR:"/toSource() string here.
    return { updated: true, layerId: 4242 };
  },
  async ping(): Promise<boolean> {
    return true;
  },
  async getVersion(): Promise<string> {
    return '27.8.0';
  },
  getPhotoshopInfo(): { version: string; path: string; isRunning: boolean } {
    // Non-null so PhotoshopAPIFactory.createAPI() builds the ExtendScript API
    // (determineAPIType always returns ExtendScript for external scripting).
    return { version: '27.8.0', path: '/Applications/Adobe Photoshop 2026', isRunning: true };
  },
} as unknown as PhotoshopConnection;

let passed = 0;
function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve(fn()).then(() => {
    passed += 1;
    console.log(`  OK   ${name}`);
  });
}

async function main(): Promise<void> {
  // Force the default path explicitly (auto → ExtendScript when PS is available).
  delete process.env.PHOTOSHOP_MCP_TRANSPORT;
  const router = new TransportRouter(fakeConnection);

  // The ExtendScriptPhotoshopAPI error-wrapper runs one layer deeper (inside
  // createAPI().executeScript) and prepends DialogModes/shims IDENTICALLY for both
  // the pre-flip runScript(script) path and the new run({name,params:{script}})
  // path. So the byte-identity proof is: for the same input script, run(...) and
  // runScript(...) deliver the EXACT SAME wrapped string in the EXACT SAME number of
  // calls. We capture both and compare — no assumption about the wrapper's content.
  const cases: Array<{ name: string; script: string }> = [
    { name: 'duplicate_layer', script: ExtendScriptSnippets.duplicateLayer('copy') },
    { name: 'select_layer', script: ExtendScriptSnippets.selectLayerByName('L') },
    { name: 'create_layer_mask', script: ExtendScriptSnippets.createLayerMask() },
    { name: 'set_layer_properties', script: ExtendScriptSnippets.setLayerOpacity(50) },
  ];

  for (const c of cases) {
    await check(`${c.name}: run() delivery === legacy runScript() delivery`, async () => {
      calls.length = 0;
      await router.run({ name: c.name, params: { script: c.script } });
      const viaRun = calls.map((x) => x.script);

      calls.length = 0;
      await router.runScript(c.script);
      const viaRunScript = calls.map((x) => x.script);

      assert.equal(viaRun.length, 1, 'run() makes exactly one executeScript call');
      assert.equal(viaRunScript.length, 1, 'runScript() makes exactly one executeScript call');
      assert.deepEqual(viaRun, viaRunScript, 'flipped path must deliver the identical wrapped script');
      // And the tool's script is embedded verbatim inside whatever wrapping applies.
      assert.ok(viaRun[0].includes(c.script), 'the exact tool script is present in the delivered payload');
    });
  }

  // The id-targeted variant still routes to ExtendScript on the default path (no pin
  // steals it to UXP) — one call, carrying the id-form script.
  await check('duplicate_layer(byId): still routes to ExtendScript on default path', async () => {
    calls.length = 0;
    const script = ExtendScriptSnippets.duplicateLayer('copy', 999);
    await router.run({ name: 'duplicate_layer', params: { script, layerId: 999 } });
    assert.equal(calls.length, 1);
    assert.ok(calls[0].script.includes(script));
    assert.match(calls[0].script, /__mcp_selectLayerById\(999\)/);
  });

  console.log(`\n${passed} routing-trace checks passed (default auto→ExtendScript path).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
