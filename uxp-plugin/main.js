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
 *   - Handshake-file discovery (§6.7): the bridge binds only its configured port.
 *     If it is occupied, startup fails closed rather than selecting a fallback
 *     port. The plugin reads the authenticated handshake before polling.
 *   - Protocol v4 acknowledgment: posting /result is complete only after a
 *     matching authenticated 2xx acknowledgment. An expired dispatched lease is
 *     terminally uncertain and never dispatched again because it may have mutated Photoshop.
 *
 * v1.4 — authenticated protocol and execution quarantine:
 * the poll loop: the manifest lacked `manifestVersion: 5`, the plugin loaded as
 * legacy API v1 where `core.executeAsModal` cannot run, and the poll loop awaited
 * the never-settling call — alive-but-deaf, the exact §6 failure class:
 *   - manifestVersion 5 declared (UXP API v2 — executeAsModal available). If
 *     executeAsModal is STILL missing at runtime, fall back to direct batchPlay
 *     with a loud log instead of hanging.
 *   - The poll loop never overlaps commands. Result posts retry only after a
 *     non-2xx or malformed acknowledgment.
 *   - Per-action watchdog (batch_play 20s, neural_filter 120s): a hung execution
 *     reports uncertainty and quarantines this plugin session. Only actual
 *     promise settlement can post the exact terminal result, and no later command
 *     is polled until the bridge process restarts, then the plugin reloads and
 *     completes a fresh initial handshake. A plugin reload alone cannot take
 *     over the existing session.
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
const { ExecutionGuard } = require('./execution-guard');

const DEFAULT_BRIDGE_PORT = 38452;
const BRIDGE_PROTOCOL_VERSION = 4;
/** Per-action execution budget before the watchdog quarantines this plugin session. */
const WATCHDOG_MS = { batch_play: 20_000, neural_filter: 120_000 };
// Bridge-process restart followed by plugin reload and a fresh handshake is the
// only supported recovery path after an uncancellable Photoshop operation expires.
const BRIDGE_SESSION_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

let bridgePort = DEFAULT_BRIDGE_PORT;
let bridgeToken = null;
let sessionEstablished = false;
let polling = false;
/** Command ids already answered — only the first result per id is posted. */
const reported = new Set();

function log(msg) {
  console.log(`[mcp-bridge ${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

function bridgeBase() {
  return `http://127.0.0.1:${bridgePort}`;
}

function authenticatedHeaders(contentType) {
  const headers = {
    Authorization: `Bearer ${bridgeToken}`,
    'X-Photoshop-MCP-Session': BRIDGE_SESSION_ID,
  };
  if (contentType) headers['Content-Type'] = contentType;
  return headers;
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
    if (
      info &&
      info.protocolVersion === BRIDGE_PROTOCOL_VERSION &&
      typeof info.port === 'number' &&
      info.port > 0 &&
      typeof info.token === 'string' &&
      info.token.length >= 32
    ) {
      const tokenChanged = bridgeToken !== info.token;
      if (info.port !== bridgePort) log(`bridge port → ${info.port} (handshake)`);
      bridgePort = info.port;
      bridgeToken = info.token;
      if (tokenChanged) sessionEstablished = false;
    } else if (info?.protocolVersion !== BRIDGE_PROTOCOL_VERSION) {
      bridgeToken = null;
      sessionEstablished = false;
      log(
        `bridge protocol mismatch (plugin=${BRIDGE_PROTOCOL_VERSION}, server=${info?.protocolVersion ?? 'missing'})`
      );
    }
  } catch {
    // No handshake file yet (server not up) — keep the default/last-known port.
  }
}

/** Claim the bridge only once, after a server-process start with no owner. */
async function establishSession() {
  if (!bridgeToken) return false;
  try {
    const response = await fetch(`${bridgeBase()}/handshake`, {
      method: 'POST',
      headers: authenticatedHeaders(),
    });
    if (response.status === 401) {
      bridgeToken = null;
      sessionEstablished = false;
      return false;
    }
    if (!response.ok) {
      log(`initial handshake rejected (${response.status}); server session remains owned`);
      return false;
    }
    const ack = await response.json();
    if (
      ack?.ok !== true ||
      ack.sessionId !== BRIDGE_SESSION_ID ||
      ack.protocolVersion !== BRIDGE_PROTOCOL_VERSION
    ) {
      log('initial handshake received an invalid acknowledgement');
      return false;
    }
    sessionEstablished = true;
    log('authenticated bridge session established');
    return true;
  } catch (err) {
    log(`initial handshake failed: ${err?.message || err}`);
    return false;
  }
}

/** Return true only when the current bridge explicitly acknowledges this result. */
async function postResultOnce(payload) {
  if (reported.has(payload.id)) {
    return true;
  }
  if (!bridgeToken) {
    log(`cannot report ${payload.id}: no authenticated bridge token`);
    return false;
  }
  try {
    const response = await fetch(`${bridgeBase()}/result`, {
      method: 'POST',
      headers: authenticatedHeaders('application/json'),
      body: JSON.stringify(payload),
    });
    if (response.status === 401) bridgeToken = null;
    if (!response.ok) {
      log(`result ${payload.id} rejected (${response.status})`);
      return false;
    }
    const ack = await response.json();
    if (
      ack?.ok !== true ||
      ack.id !== payload.id ||
      ack.protocolVersion !== BRIDGE_PROTOCOL_VERSION
    ) {
      log(`result ${payload.id} received invalid acknowledgement`);
      return false;
    }
    reported.add(payload.id);
    if (reported.size > 32) reported.clear();
    log(
      `posted result ${payload.id} ok=${payload.ok}${payload.error ? ` error=${payload.error}` : ''}`
    );
    return true;
  } catch (err) {
    log(`POST /result failed for ${payload.id}: ${err?.message || err}`);
    return false;
  }
}

async function postResultWithRetry(payload) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (await postResultOnce(payload)) return true;
    await new Promise((resolve) => setTimeout(resolve, attempt * 250));
  }
  log(`result ${payload.id} was not acknowledged; bridge will report execution uncertainty`);
  return false;
}

/** Tell the bridge that the command may still be mutating Photoshop. */
async function postUncertainOnce(id) {
  if (!bridgeToken) return false;
  try {
    const response = await fetch(`${bridgeBase()}/uncertain`, {
      method: 'POST',
      headers: authenticatedHeaders('application/json'),
      body: JSON.stringify({ id }),
    });
    if (response.status === 401) bridgeToken = null;
    if (!response.ok) return false;
    const ack = await response.json();
    return ack?.ok === true && ack.id === id && ack.protocolVersion === BRIDGE_PROTOCOL_VERSION;
  } catch (err) {
    log(`POST /uncertain failed for ${id}: ${err?.message || err}`);
    return false;
  }
}

async function postUncertainWithRetry(id) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (await postUncertainOnce(id)) return true;
    await new Promise((resolve) => setTimeout(resolve, attempt * 250));
  }
  log(`uncertainty for ${id} was not acknowledged; this plugin remains quarantined`);
  return false;
}

const executionGuard = new ExecutionGuard({
  onUncertain: async (id) => {
    log(`command ${id} exceeded its watchdog; quarantining this plugin session`);
    await postUncertainWithRetry(id);
  },
  onSettled: async (result) => {
    log(`command ${result.id} actually settled ok=${result.ok}; posting the only terminal result`);
    await postResultWithRetry(result);
  },
});

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

function handleCommand(cmd) {
  const { id, action: cmdAction, params = {} } = cmd;
  const started = Date.now();
  log(`command ${id} (${cmdAction}) received`);
  let execute;

  try {
    if (cmdAction === 'batch_play') {
      const descriptors = params.descriptors;
      if (!Array.isArray(descriptors)) {
        throw new Error('batch_play requires params.descriptors to be an array');
      }
      execute = () => runBatchPlay(descriptors, params.commandName);
    } else if (cmdAction === 'neural_filter') {
      // Route the legacy neural path through the same generic executor (§4.2).
      execute = () =>
        runBatchPlay(neuralDescriptors(params.filter, params), `neural_filter:${params.filter}`);
    } else {
      void postResultWithRetry({ id, ok: false, error: `unknown_action:${cmdAction}` });
      return;
    }
  } catch (error) {
    log(`command ${id} failed after ${Date.now() - started}ms: ${error?.message || error}`);
    void postResultWithRetry({ id, ok: false, error: error?.message || String(error) });
    return;
  }

  if (!executionGuard.start(id, execute, WATCHDOG_MS[cmdAction] ?? 20_000)) {
    // pollOnce gates this before fetching, but keep the handler fail-closed if a
    // future caller invokes it directly.
    log(`refusing ${id}: plugin execution is busy or quarantined`);
    void postResultWithRetry({ id, ok: false, error: 'plugin_execution_quarantined' });
  }
}

let pollFailures = 0;
let pollEverSucceeded = false;

async function pollOnce() {
  try {
    // Never request a second command while Photoshop may still be executing.
    // A late actual settlement does not clear quarantine; bridge-process
    // restart followed by plugin reload and a fresh handshake creates a new
    // session and guard.
    if (executionGuard.isBusy() || executionGuard.isQuarantined()) return;
    // Retarget to the server's real port before each poll (§6.7).
    await refreshBridgePort();
    if (!bridgeToken) return;
    if (!sessionEstablished && !(await establishSession())) return;
    const res = await fetch(`${bridgeBase()}/poll`, {
      headers: authenticatedHeaders(),
    });
    if (res.status === 401) {
      bridgeToken = null;
      throw new Error('bridge authentication rejected');
    }
    if (!pollEverSucceeded) {
      pollEverSucceeded = true;
      log(`bridge reachable at ${bridgeBase()} (first poll ok)`);
    }
    pollFailures = 0;
    if (res.status === 204) return;
    if (!res.ok) return;
    const cmd = await res.json();
    if (!cmd?.id) return;
    if (reported.has(cmd.id)) {
      // A duplicate protocol delivery is invalid; never apply the command twice.
      log(`skipping duplicate command ${cmd.id} (in flight or already acknowledged)`);
      return;
    }
    handleCommand(cmd);
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
