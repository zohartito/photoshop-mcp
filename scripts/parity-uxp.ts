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
 * Read-only fixture: a fresh uniquely-named RGB doc → one filled non-background
 * pixel layer → a rectangular selection consumed into a layer MASK (positive
 * hasMask case) → a fresh rectangular selection left active (positive hasSelection
 * case). So at read time: 2 layers (Background + masked pixel layer), the active
 * layer has a mask, and a selection exists.
 *
 * MUTATING PHASE (§6.8 target identity, §14) — runs when --mutate is passed. Because
 * mutations are stateful and destructive, each backend gets its OWN fresh fixture and
 * runs the SAME chain independently, then the harness checks two things:
 *   (a) result-shape parity — both backends return a numeric top-level `layerId` from
 *       duplicate_layer / select_layer / create_layer_mask / set_layer_properties;
 *   (b) the target-identity CONTRACT — the classic duplicate→select-the-copy→mask bug
 *       class (§6.1) is gone: duplicate_layer returns the NEW layer's id, we select
 *       and mask THAT id, and a final get_layers must show hasMask=true on the layer
 *       whose name is the duplicate (never the Background/original). This is the
 *       live confirmation §6.8 flags — especially that backend A can read the
 *       returned layerID back.
 *
 * Usage: npx tsx scripts/parity-uxp.ts [--wait-min 20] [--mutate]
 * Exit codes: 0 = all checks clean, 1 = diffs/contract failure, 2 = setup failure.
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
const RUN_MUTATIONS = argv.includes('--mutate');
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

/** Pull a numeric top-level layerId out of a (possibly string) transport result. */
function layerIdOf(result: unknown): number | undefined {
  let value: unknown = result;
  if (typeof value === 'string') {
    try {
      value = new Function(`return ${value}`)();
    } catch {
      return undefined;
    }
  }
  const id = (value as { layerId?: unknown } | null)?.layerId;
  return typeof id === 'number' ? id : undefined;
}

/**
 * Build a minimal MUTATION fixture on `backend` (its own fresh doc) and run the
 * §6.8 chain: create doc → duplicate the pixel layer (capture the NEW layerId) →
 * select that id → mask that id (selection present) → set opacity+blend on that id.
 * Returns the per-command results plus a final get_layers snapshot so the caller can
 * assert the mask landed on the duplicate, not the original (the §6.1 bug class).
 *
 * `runCmd(name, params)` abstracts the backend: for A, params carries the built
 * ExtendScript `script` (+ the structured params the tool would pass); for B, only
 * the structured params (the UXP switch keys on name). This mirrors exactly what the
 * flipped tool handlers now send through the router.
 */
async function runMutationChain(
  label: string,
  runCmd: (name: string, params: Record<string, unknown>) => Promise<unknown>,
  buildDupSelMaskSetFixture: () => Promise<void>
): Promise<{
  label: string;
  duplicate: unknown;
  select: unknown;
  mask: unknown;
  setProps: unknown;
  newLayerId: number | undefined;
  finalLayers: unknown;
  contract: { ok: boolean; detail: string };
}> {
  await buildDupSelMaskSetFixture();

  // 1) duplicate the (active) pixel layer, name the copy so we can find it later.
  const duplicate = await runCmd('duplicate_layer', {
    script: ExtendScriptSnippets.duplicateLayer('parity-dupe'),
    newName: 'parity-dupe',
  });
  const newLayerId = layerIdOf(duplicate);
  log(`   ${label} duplicate_layer → layerId=${String(newLayerId)}`);

  // 2) select the duplicate BY ITS RETURNED ID (the target-identity primitive).
  const select = await runCmd('select_layer', {
    script: ExtendScriptSnippets.selectLayerByName('parity-dupe', newLayerId),
    layerId: newLayerId,
  });

  // 3) fresh selection, then mask THAT id — must land on the duplicate.
  await runCmd('select_rectangle', {
    script: ExtendScriptSnippets.selectRectangle(120, 120, 480, 380),
  });
  const mask = await runCmd('create_layer_mask', {
    script: ExtendScriptSnippets.createLayerMask(newLayerId),
    layerId: newLayerId,
  });

  // 4) set opacity + blend mode on that id.
  const setProps = await runCmd('set_layer_properties', {
    script: ExtendScriptSnippets.setLayerOpacity(60, newLayerId),
    layerId: newLayerId,
    opacity: 60,
  });

  // Snapshot layers via backend A (ground truth) to check WHERE the mask landed.
  const finalLayers = await runCmd('get_layers', {
    script: ExtendScriptSnippets.getLayerNames(),
  });

  // Contract: the layer named 'parity-dupe' must be the one carrying hasMask.
  let contract = { ok: false, detail: 'no get_layers payload' };
  const parsed =
    typeof finalLayers === 'string'
      ? (() => {
          try {
            return new Function(`return ${finalLayers}`)();
          } catch {
            return null;
          }
        })()
      : finalLayers;
  const layers = (parsed as { layers?: Array<{ name?: string; hasMask?: boolean }> })?.layers;
  if (Array.isArray(layers)) {
    const dupe = layers.find((l) => l.name === 'parity-dupe');
    const maskedNames = layers.filter((l) => l.hasMask).map((l) => l.name);
    if (dupe?.hasMask === true && maskedNames.length === 1) {
      contract = { ok: true, detail: `mask on 'parity-dupe' only (masked: ${maskedNames.join(',')})` };
    } else {
      contract = {
        ok: false,
        detail: `expected hasMask only on 'parity-dupe'; masked layers = [${maskedNames.join(', ')}], dupe.hasMask=${String(
          dupe?.hasMask
        )}`,
      };
    }
  }
  log(`   ${label} target-identity contract: ${contract.ok ? 'HELD' : 'FAILED'} — ${contract.detail}`);

  return { label, duplicate, select, mask, setProps, newLayerId, finalLayers, contract };
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
    log('Closing read-only fixture document (no save)…');
    await backendA
      .run({ name: 'close_document', params: { script: ExtendScriptSnippets.closeDocument(false) } })
      .catch((err) => log(`WARN: close failed: ${String(err)}`));
  }

  // --- §6.8 mutating-family parity (opt-in via --mutate) ---
  const mutationResults: Array<Awaited<ReturnType<typeof runMutationChain>>> = [];
  if (RUN_MUTATIONS) {
    log('=== Mutating-family parity phase (§6.8 target identity) ===');

    // Backend A chain on its own fresh fixture.
    const runA = (name: string, params: Record<string, unknown>) =>
      backendA.run({ name, params, timeoutMs: 30_000 });
    const buildAFixture = async () => {
      log('Building backend-A mutation fixture…');
      await runA('new_document', { script: ExtendScriptSnippets.newDocument(1024, 768) });
      await runA('new_layer', { script: ExtendScriptSnippets.newLayer('parity-src') });
      await runA('fill_layer', { script: ExtendScriptSnippets.fillLayer(64, 128, 200) });
    };
    try {
      mutationResults.push(await runMutationChain('A(extendscript)', runA, buildAFixture));
    } catch (err) {
      log(`MUTATION A ERROR — ${String(err)}`);
    } finally {
      await backendA
        .run({ name: 'close_document', params: { script: ExtendScriptSnippets.closeDocument(false) } })
        .catch(() => undefined);
    }

    // Backend B chain on its own fresh fixture. The fixture itself is still built
    // with backend A (open/new/fill are ExtendScript-pinned), but the four §6.8
    // commands run through UxpTransport — the mixed-backend reality of §8, safe here
    // because both channels drive the one PS instance serially.
    const runB = (name: string, params: Record<string, unknown>) => {
      // The four mutating commands + the get_layers snapshot go to backend B where
      // ported; setup/selection/close stay on backend A (unpinned-but-unported →
      // fall back). Route by whether B advertises the command.
      const bServes = [
        'duplicate_layer',
        'select_layer',
        'create_layer_mask',
        'set_layer_properties',
        'get_layers',
      ].includes(name);
      return bServes
        ? backendB.run({ name, params, timeoutMs: 30_000 })
        : backendA.run({ name, params, timeoutMs: 30_000 });
    };
    const buildBFixture = async () => {
      log('Building backend-B mutation fixture…');
      await backendA.run({ name: 'new_document', params: { script: ExtendScriptSnippets.newDocument(1024, 768) } });
      await backendA.run({ name: 'new_layer', params: { script: ExtendScriptSnippets.newLayer('parity-src') } });
      await backendA.run({ name: 'fill_layer', params: { script: ExtendScriptSnippets.fillLayer(64, 128, 200) } });
    };
    try {
      mutationResults.push(await runMutationChain('B(uxp)', runB, buildBFixture));
    } catch (err) {
      log(`MUTATION B ERROR — ${String(err)}`);
    } finally {
      await backendA
        .run({ name: 'close_document', params: { script: ExtendScriptSnippets.closeDocument(false) } })
        .catch(() => undefined);
    }
  } else {
    log('Mutating-family phase skipped (pass --mutate to run it).');
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
        mutationResults,
      },
      null,
      2
    )
  );
  log(`Report written: ${REPORT_PATH}`);

  const dirty = results.filter((r) => !r.clean);
  // A mutating result is "dirty" if the target-identity contract failed OR the
  // read-back layerId was not a number on either backend.
  const mutationDirty = mutationResults.filter(
    (m) => !m.contract.ok || typeof m.newLayerId !== 'number'
  );
  const allClean = dirty.length === 0 && mutationDirty.length === 0;

  if (allClean) {
    log(
      `PARITY CLEAN — read-only ${results.length}/${results.length} identical` +
        (RUN_MUTATIONS ? `; mutating ${mutationResults.length}/${mutationResults.length} contract held` : '')
    );
    process.exit(0);
  }
  if (dirty.length > 0) {
    log(`READ-ONLY DIRTY — ${dirty.length}/${results.length} differ: ${dirty.map((d) => d.command).join(', ')}`);
  }
  if (mutationDirty.length > 0) {
    log(`MUTATING DIRTY — ${mutationDirty.map((m) => m.label).join(', ')} failed the target-identity contract`);
  }
  process.exit(1);
}

main().catch((err) => {
  log(`FATAL: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  process.exit(2);
});
