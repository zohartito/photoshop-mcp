/**
 * Photoshop MCP UXP Bridge — polls MCP HTTP server and runs batchPlay commands.
 * Load via Adobe UXP Developer Tools (Load Plugin → uxp-plugin folder), then open
 * the panel once (Plugins → Photoshop MCP UXP Bridge → MCP Bridge) to kickstart
 * the module if the host defers evaluation to first panel show.
 *
 * M3 (docs/design/transport-layer.md §4.2, §6.5, §6.7, §6.9):
 *   - Generic `batch_play` action: the plugin no longer hardcodes a per-filter
 *     switch. It receives a descriptor array from the server, wraps it in one
 *     executeAsModal + batchPlay, and returns the raw result. Porting a command to
 *     backend B is then a server-side descriptor edit — no plugin release per
 *     command. `neural_filter` is kept as a thin descriptor-builder that funnels
 *     into the same generic executor so the existing neural path keeps working.
 *   - Silent dialogs per descriptor (§6.5): batchPlay has no whole-script
 *     DialogModes.NO. Every descriptor gets `dialogOptions:'silent'` and the call
 *     runs with `modalBehavior:'execute'` so nothing blocks on a dialog.
 *   - Handshake-file port discovery (§6.7): the MCP server may bind a port other
 *     than 38452 (EADDRINUSE → +1). Each poll cycle the plugin reads the handshake
 *     file the server writes and retargets, so a port change never silently
 *     disconnects the plugin.
 *   - Ack on result (§6.9): posting /result acknowledges the leased command. The
 *     server requeues any lease that never acks, so a crash mid-command re-delivers.
 *
 * v1.1 (parity session, 2026-07-05) — hang-proofing after the first live run froze
 * the poll loop: the manifest lacked `manifestVersion: 5`, the plugin loaded as
 * legacy API v1 where `core.executeAsModal` cannot run, and the poll loop awaited
 * the never-settling call — alive-but-deaf, the exact §6 failure class:
 *   - manifestVersion 5 declared (UXP API v2 — executeAsModal available). If
 *     executeAsModal is STILL missing at runtime, fall back to direct batchPlay
 *     with a loud log instead of hanging.
 *   - The poll loop never awaits command execution (fire-and-forget + in-flight
 *     dedupe): liveness polling continues during long commands, and a requeued
 *     redelivery of a still-running command id is skipped, not double-applied.
 *   - Per-action watchdog (batch_play 20s, neural_filter 120s): a hung execution
 *     still posts {ok:false} so the server-side caller fails fast. Only the FIRST
 *     result per command id is posted; a late real result is logged, not posted.
 *   - console.log breadcrumbs throughout — read them in the UDT Debug console.
 *   - Polling no longer stops on panel hide: plugin loaded ⇒ polling.
 *   - No module-scope `os`/`path` dependency: manifest-v5 UXP strips `os.tmpdir`
 *     (the v1.0 plugin crashed at load on it — UDT console: "os.tmpdir is not a
 *     function"). The handshake now lives under HOME (matching the server) and is
 *     resolved lazily + guarded, degrading to the fixed default port.
 */
const { entrypoints } = require('uxp');
const photoshop = require('photoshop');
const { action, core } = photoshop;
const fs = require('uxp').storage.localFileSystem;

const DEFAULT_BRIDGE_PORT = 38452;
/** Per-action execution budget before the watchdog posts a failure result. */
const WATCHDOG_MS = { batch_play: 20_000, neural_filter: 120_000 };

let bridgePort = DEFAULT_BRIDGE_PORT;
let polling = false;
/** Command ids currently executing — a requeued redelivery of these is skipped. */
const inFlight = new Set();
/** Command ids already answered — only the first result per id is posted. */
const reported = new Set();

function log(msg) {
  console.log(`[mcp-bridge ${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

function bridgeBase() {
  return `http://127.0.0.1:${bridgePort}`;
}

/**
 * Resolve the handshake-file URL lazily and guarded (§6.7). The server writes
 * `~/.photoshop-mcp/bridge.json`; UXP's `os.homedir()` survives manifest v5 while
 * `os.tmpdir()` does not. Empty string ⇒ discovery unavailable, fixed port only.
 */
let handshakeUrl = null;
function resolveHandshakeUrl() {
  if (handshakeUrl !== null) return handshakeUrl;
  try {
    const os = require('os');
    const home = typeof os.homedir === 'function' ? os.homedir() : '';
    handshakeUrl = home ? `file:${home}/.photoshop-mcp/bridge.json` : '';
  } catch {
    handshakeUrl = '';
  }
  if (!handshakeUrl) {
    log(`handshake discovery unavailable — using fixed port ${DEFAULT_BRIDGE_PORT}`);
  }
  return handshakeUrl;
}

/**
 * Read the server's handshake file to discover the actual bound port (§6.7).
 * Best-effort — on any failure we keep the current port. Uses the UXP localFile
 * System (Node `fs` is not reliably available for arbitrary paths in UXP).
 */
async function refreshBridgePort() {
  const url = resolveHandshakeUrl();
  if (!url) return;
  try {
    const entry = await fs.getEntryWithUrl(url);
    const text = await entry.read();
    const info = JSON.parse(text);
    if (info && typeof info.port === 'number' && info.port > 0) {
      if (info.port !== bridgePort) log(`bridge port → ${info.port} (handshake)`);
      bridgePort = info.port;
    }
  } catch {
    // No handshake file yet (server not up) — keep the default/last-known port.
  }
}

/** Post a result exactly once per command id (§6.9: the post IS the ack). */
async function postResultOnce(payload) {
  if (reported.has(payload.id)) {
    log(`result for ${payload.id} already posted — dropping duplicate (ok=${payload.ok})`);
    return;
  }
  reported.add(payload.id);
  if (reported.size > 500) reported.clear(); // bounded memory; dev-bridge scale
  try {
    await fetch(`${bridgeBase()}/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    log(`posted result ${payload.id} ok=${payload.ok}${payload.error ? ` error=${payload.error}` : ''}`);
  } catch (err) {
    // Allow a retry by a later watchdog/real result if the POST itself failed.
    reported.delete(payload.id);
    log(`POST /result failed for ${payload.id}: ${err?.message || err}`);
  }
}

/**
 * Build neural-filter descriptors from a filter name. Kept plugin-side only so the
 * existing neural_filter command keeps working while the generic path exists; new
 * commands should send descriptors directly via the `batch_play` action instead.
 */
function neuralDescriptors(filter, params) {
  const smoothness = params.smoothness ?? 50;
  const blur = params.blur ?? 50;

  switch (filter) {
    case 'skin_smoothing':
      return [
        {
          _obj: 'neuralGalleryFilters',
          neuralGalleryFilters: { _obj: 'skinSmoothing', smoothness, blur },
        },
      ];
    case 'harmonize':
      return [{ _obj: 'neuralGalleryFilters', neuralGalleryFilters: { _obj: 'harmonization' } }];
    case 'depth_blur':
      return [{ _obj: 'neuralGalleryFilters', neuralGalleryFilters: { _obj: 'depthBlur' } }];
    case 'super_zoom':
      return [{ _obj: 'neuralGalleryFilters', neuralGalleryFilters: { _obj: 'superZoom' } }];
    default:
      throw new Error(`Unknown neural filter: ${filter}`);
  }
}

/**
 * §6.5 — batchPlay has no whole-script dialog suppression, so stamp every
 * descriptor with silent dialog options. Returns a shallow-cloned array so the
 * caller's descriptors are not mutated.
 */
function withSilentDialogs(descriptors) {
  return descriptors.map((d) => ({ dialogOptions: 'silent', ...d }));
}

/**
 * The one generic executor (§4.2). Runs a descriptor array inside a single
 * executeAsModal (one-undo / operation scope, §6.3) with silent dialogs, and
 * returns the raw batchPlay result for the server to normalize. If executeAsModal
 * is unavailable (legacy API v1 load — the v1.0.0 manifest bug), degrade to a
 * direct batchPlay call with a loud log rather than hanging the poll loop.
 */
async function runBatchPlay(descriptors, commandName) {
  const silenced = withSilentDialogs(descriptors);
  const opts = { synchronousExecution: true, modalBehavior: 'execute' };
  if (typeof core?.executeAsModal === 'function') {
    return core.executeAsModal(async () => action.batchPlay(silenced, opts), {
      commandName: commandName || 'MCP batch_play',
    });
  }
  log('WARN: core.executeAsModal unavailable (API v1 load?) — running batchPlay directly');
  return action.batchPlay(silenced, opts);
}

/** Race a promise against the per-action watchdog budget. */
function withWatchdog(promise, actionName, id) {
  const budget = WATCHDOG_MS[actionName] ?? 20_000;
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`plugin_watchdog_timeout:${actionName}:${budget}ms`)), budget)
    ),
  ]);
}

async function handleCommand(cmd) {
  const { id, action: cmdAction, params = {} } = cmd;
  inFlight.add(id);
  const started = Date.now();
  log(`command ${id} (${cmdAction}) received`);

  try {
    let resultPromise;
    if (cmdAction === 'batch_play') {
      const descriptors = params.descriptors;
      if (!Array.isArray(descriptors)) {
        throw new Error('batch_play requires params.descriptors to be an array');
      }
      resultPromise = runBatchPlay(descriptors, params.commandName);
    } else if (cmdAction === 'neural_filter') {
      // Route the legacy neural path through the same generic executor (§4.2).
      resultPromise = runBatchPlay(neuralDescriptors(params.filter, params), `neural_filter:${params.filter}`);
    } else {
      await postResultOnce({ id, ok: false, error: `unknown_action:${cmdAction}` });
      return;
    }

    const result = await withWatchdog(resultPromise, cmdAction, id);
    log(`command ${id} done in ${Date.now() - started}ms`);
    await postResultOnce({ id, ok: true, data: result });
  } catch (error) {
    log(`command ${id} failed after ${Date.now() - started}ms: ${error?.message || error}`);
    await postResultOnce({ id, ok: false, error: error?.message || String(error) });
  } finally {
    inFlight.delete(id);
  }
}

let pollFailures = 0;
let pollEverSucceeded = false;

async function pollOnce() {
  try {
    // Retarget to the server's real port before each poll (§6.7).
    await refreshBridgePort();
    const res = await fetch(`${bridgeBase()}/poll`);
    if (!pollEverSucceeded) {
      pollEverSucceeded = true;
      log(`bridge reachable at ${bridgeBase()} (first poll ok)`);
    }
    pollFailures = 0;
    if (res.status === 204) return;
    if (!res.ok) return;
    const cmd = await res.json();
    if (!cmd?.id) return;
    if (inFlight.has(cmd.id) || reported.has(cmd.id)) {
      // A lease-expiry redelivery of a command we're still running (or already
      // answered) — skip so it is not double-applied (§6.9).
      log(`skipping redelivered command ${cmd.id} (in flight or already answered)`);
      return;
    }
    // Fire-and-forget: the poll loop must keep beating (liveness) while a
    // command runs. The watchdog guarantees a result is eventually posted.
    handleCommand(cmd).catch((err) => log(`handleCommand crashed: ${err?.message || err}`));
  } catch (err) {
    // Server may be down (normal between sessions) — but NEVER silently: a v5
    // network-permission denial looks identical to "server not running" without
    // this log (that starvation cost a full harness window on 2026-07-05).
    pollFailures++;
    if (pollFailures <= 3 || pollFailures % 50 === 0) {
      log(`poll failed (#${pollFailures}) to ${bridgeBase()}: ${err?.message || err}`);
    }
  }
}

async function pollLoop() {
  if (polling) return;
  polling = true;
  log(`poll loop started (port ${bridgePort}, watchdogs: batch_play ${WATCHDOG_MS.batch_play}ms)`);
  while (polling) {
    await pollOnce();
    await new Promise((r) => setTimeout(r, 400));
  }
}

entrypoints.setup({
  panels: {
    bridgePanel: {
      show() {
        log('panel shown — ensuring poll loop');
        pollLoop();
      },
      hide() {
        // v1.1: liveness is tied to the plugin being loaded, not panel visibility.
        log('panel hidden — polling continues');
      },
    },
  },
});

pollLoop();
