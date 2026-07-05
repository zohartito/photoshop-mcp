/**
 * M3 backend-B parity harness (docs/design/transport-layer.md §5, §12).
 *
 * Drives BOTH transports directly — bypassing the MCP tool layer on purpose: the
 * tool handlers still call runScript() and only flip to router.run() after this
 * harness proves the ported commands return identical payloads.
 *
 *   backend A: ExtendScriptTransport.run({ name, params: { script } })  (snippets)
 *   backend B: UxpTransport.run({ name })                               (descriptors)
 *
 * The harness hosts the UXP bridge in-process and BLOCKS until the plugin's first
 * poll (load uxp-plugin/ via UXP Developer Tools and OPEN its panel once —
 * Plugins menu → Photoshop MCP UXP Bridge → MCP Bridge; the poll loop is bound to
 * the panel's show() lifecycle). It then builds its OWN fixture document via
 * backend A (never touching the user's open document), runs each ported read-only
 * command on both backends against the identical fixture state, deep-diffs the
 * payloads, closes the fixture without saving, and writes a JSON report.
 *
 * Fixture (Task 2): a fresh uniquely-named RGB doc → one filled non-background
 * pixel layer → a rectangular selection consumed into a layer MASK (positive
 * hasMask case) → a fresh rectangular selection left active (positive hasSelection
 * case). So at read time: 2 layers (Background + masked pixel layer), the active
 * layer has a mask, and a selection exists.
 *
 * Usage: npx tsx scripts/parity-uxp.ts [--wait-min 20]
 * Exit codes: 0 = all commands parity-clean, 1 = diffs found, 2 = setup failure.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ExtendScriptSnippets } from '../src/api/extendscript.js';
import { PhotoshopConnection } from '../src/platform/connection.js';
import { ExtendScriptTransport } from '../src/transport/extendscript-transport.js';
import { UxpTransport } from '../src/transport/uxp-transport.js';

const argv = process.argv.slice(2);
function argValue(flag: string, fallback: string): string {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}

const WAIT_MINUTES = Number.parseFloat(argValue('--wait-min', '20'));
const FIXTURE_NAME = `mcp-parity-${Date.now()}`;
const REPORT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  'output',
  'parity-uxp-report.json'
);

/** The M3 ported read-only commands and their backend-A snippet builders. */
const PORTED_COMMANDS: Array<{ name: string; snippet: () => string }> = [
  { name: 'get_state', snippet: () => ExtendScriptSnippets.getState() },
  { name: 'get_document_info', snippet: () => ExtendScriptSnippets.getDocumentInfo() },
  { name: 'get_layers', snippet: () => ExtendScriptSnippets.getLayerNames() },
];

function log(message: string): void {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${message}`);
}

/**
 * Recursive structural diff. Reports every path where the two payloads disagree —
 * value mismatches, missing keys, array-length differences. Key order is ignored
 * (objects are compared by key set), which is the only tolerated difference:
 * parity means same keys, same values, same types.
 */
function deepDiff(a: unknown, b: unknown, path = '$'): string[] {
  if (Object.is(a, b)) return [];
  if (a === null || b === null || typeof a !== typeof b) {
    return [`${path}: A=${JSON.stringify(a)} B=${JSON.stringify(b)}`];
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) {
      return [`${path}: array/non-array mismatch`];
    }
    const diffs: string[] = [];
    if (a.length !== b.length) {
      diffs.push(`${path}.length: A=${a.length} B=${b.length}`);
    }
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) diffs.push(...deepDiff(a[i], b[i], `${path}[${i}]`));
    return diffs;
  }
  if (typeof a === 'object') {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
    const diffs: string[] = [];
    for (const key of keys) {
      if (!(key in ao)) {
        diffs.push(`${path}.${key}: missing on A (B=${JSON.stringify(bo[key])})`);
      } else if (!(key in bo)) {
        diffs.push(`${path}.${key}: missing on B (A=${JSON.stringify(ao[key])})`);
      } else {
        diffs.push(...deepDiff(ao[key], bo[key], `${path}.${key}`));
      }
    }
    return diffs;
  }
  return [`${path}: A=${JSON.stringify(a)} B=${JSON.stringify(b)}`];
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

/** Build the parity fixture via backend A. Returns nothing; leaves it active. */
async function buildFixture(backendA: ExtendScriptTransport): Promise<void> {
  const runA = (name: string, script: string) =>
    backendA.run({ name, params: { script } });

  log(`Building fixture doc "${FIXTURE_NAME}" (backend A only — user's doc untouched)…`);
  // 1024x768 RGB @72dpi. newDocument names it 'New Document'; rename so the doc
  // name field is unique and identifiable in the parity payloads.
  await runA('new_document', ExtendScriptSnippets.newDocument(1024, 768));
  await runA('rename_document', `app.activeDocument.name = "${FIXTURE_NAME}"; return { renamed: true };`);
  // A non-background pixel layer (createLayerMask needs a non-background layer).
  await runA('new_layer', ExtendScriptSnippets.newLayer('parity-layer'));
  await runA('fill_layer', ExtendScriptSnippets.fillLayer(128, 128, 128));
  // Selection → mask: createLayerMask reads the live selection and does
  // revealSelection, giving the active layer a user mask (positive hasMask).
  await runA('select_rectangle', ExtendScriptSnippets.selectRectangle(100, 100, 500, 400));
  await runA('create_layer_mask', ExtendScriptSnippets.createLayerMask());
  // Fresh selection left active so hasSelection is true at read time (the mask
  // step consumed the previous one).
  await runA('select_rectangle', ExtendScriptSnippets.selectRectangle(200, 200, 600, 500));
  log('Fixture ready: 2 layers (Background + masked pixel layer), selection active.');
}

async function main(): Promise<void> {
  const connection = new PhotoshopConnection();
  const backendA = new ExtendScriptTransport(connection);
  const backendB = new UxpTransport();

  if (!(await backendA.isAvailable())) {
    log('FATAL: Photoshop not detected — launch Photoshop 2026 first.');
    process.exit(2);
  }
  log('Backend A (ExtendScript): Photoshop detected.');

  // Bind the bridge and wait for the plugin's first poll (§4.1 truthful liveness).
  log(`Waiting up to ${WAIT_MINUTES} min for the UXP plugin to start polling…`);
  log('(Load uxp-plugin/ in UXP Developer Tools, then OPEN its panel once:');
  log(' Plugins menu → Photoshop MCP UXP Bridge → MCP Bridge. Polling starts on panel show.)');
  const deadline = Date.now() + WAIT_MINUTES * 60_000;
  let lastHeartbeat = 0;
  while (!(await backendB.isAvailable())) {
    if (Date.now() > deadline) {
      log('FATAL: plugin never polled the bridge — is it loaded in UDT and its panel open? Is PS Developer Mode on?');
      process.exit(2);
    }
    if (Date.now() - lastHeartbeat > 15_000) {
      lastHeartbeat = Date.now();
      log(`…still waiting (${Math.round((deadline - Date.now()) / 60_000)} min left)`);
    }
    await sleep(1_000);
  }
  log('Backend B (UXP): plugin is polling — bridge is live.');

  await buildFixture(backendA);

  const results: Array<{
    command: string;
    clean: boolean;
    diffs: string[];
    a: unknown;
    b: unknown;
  }> = [];

  try {
    for (const cmd of PORTED_COMMANDS) {
      // Per-command isolation: one backend failure is recorded as a dirty result
      // and the run continues — a single hang must not abort the whole matrix.
      let a: unknown = null;
      try {
        log(`— ${cmd.name}: backend A…`);
        a = await backendA.run({ name: cmd.name, params: { script: cmd.snippet() } });
      } catch (err) {
        results.push({
          command: cmd.name,
          clean: false,
          diffs: [`backend A error: ${String(err)}`],
          a: null,
          b: null,
        });
        log(`   ${cmd.name}: BACKEND A ERROR — ${String(err)}`);
        continue;
      }
      let b: unknown = null;
      try {
        log(`— ${cmd.name}: backend B…`);
        b = await backendB.run({ name: cmd.name, params: {}, timeoutMs: 30_000 });
      } catch (err) {
        // Liveness at the moment of failure discriminates a hung/unloaded plugin
        // (polls stopped) from a protocol/descriptor failure (still polling).
        const stillPolling = await backendB.isAvailable();
        results.push({
          command: cmd.name,
          clean: false,
          diffs: [`backend B error: ${String(err)} (plugin still polling: ${stillPolling})`],
          a,
          b: null,
        });
        log(`   ${cmd.name}: BACKEND B ERROR — ${String(err)} | plugin still polling: ${stillPolling}`);
        continue;
      }
      const diffs = deepDiff(a, b);
      results.push({ command: cmd.name, clean: diffs.length === 0, diffs, a, b });
      log(
        diffs.length === 0
          ? `   ${cmd.name}: CLEAN`
          : `   ${cmd.name}: ${diffs.length} diff(s)\n     ${diffs.join('\n     ')}`
      );
    }
  } finally {
    log('Closing fixture document (no save)…');
    await backendA
      .run({ name: 'close_document', params: { script: ExtendScriptSnippets.closeDocument(false) } })
      .catch((err) => log(`WARN: close failed: ${String(err)}`));
  }

  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  writeFileSync(
    REPORT_PATH,
    JSON.stringify(
      {
        ranAt: new Date().toISOString(),
        fixture: FIXTURE_NAME,
        photoshop: await backendA.getVersion().catch(() => 'unknown'),
        results,
      },
      null,
      2
    )
  );
  log(`Report written: ${REPORT_PATH}`);

  const dirty = results.filter((r) => !r.clean);
  if (dirty.length === 0) {
    log(`PARITY CLEAN — ${results.length}/${results.length} commands identical across backends.`);
    process.exit(0);
  }
  log(`PARITY DIRTY — ${dirty.length}/${results.length} commands differ: ${dirty.map((d) => d.command).join(', ')}`);
  process.exit(1);
}

main().catch((err) => {
  log(`FATAL: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  process.exit(2);
});
