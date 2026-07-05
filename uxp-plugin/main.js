/**
 * Photoshop MCP UXP Bridge — polls MCP HTTP server and runs batchPlay commands.
 * Load via Adobe UXP Developer Tools (Load Plugin → uxp-plugin folder).
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
 */
const { entrypoints } = require('uxp');
const photoshop = require('photoshop');
const { action, core } = photoshop;
const fs = require('uxp').storage.localFileSystem;
const os = require('os');
const path = require('path');

const DEFAULT_BRIDGE_PORT = 38452;
const HANDSHAKE_FILE = path.join(os.tmpdir(), 'photoshop-mcp-bridge.json');

let bridgePort = DEFAULT_BRIDGE_PORT;
let polling = false;

function bridgeBase() {
  return `http://127.0.0.1:${bridgePort}`;
}

/**
 * Read the server's handshake file to discover the actual bound port (§6.7).
 * Best-effort — on any failure we keep the current port. Uses the UXP localFile
 * System (Node `fs` is not reliably available for arbitrary temp paths in UXP).
 */
async function refreshBridgePort() {
  try {
    const entry = await fs.getEntryWithUrl(`file:${HANDSHAKE_FILE}`);
    const text = await entry.read();
    const info = JSON.parse(text);
    if (info && typeof info.port === 'number' && info.port > 0) {
      bridgePort = info.port;
    }
  } catch {
    // No handshake file yet (server not up) — keep the default/last-known port.
  }
}

async function postResult(payload) {
  // Posting the result is also the ack for the leased command (§6.9).
  await fetch(`${bridgeBase()}/result`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
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
 * returns the raw batchPlay result for the server to normalize.
 */
async function runBatchPlay(descriptors, commandName) {
  const silenced = withSilentDialogs(descriptors);
  return core.executeAsModal(
    async () =>
      action.batchPlay(silenced, {
        synchronousExecution: true,
        modalBehavior: 'execute',
      }),
    { commandName: commandName || 'MCP batch_play' }
  );
}

async function handleCommand(cmd) {
  const { id, action: cmdAction, params = {} } = cmd;

  try {
    if (cmdAction === 'batch_play') {
      const descriptors = params.descriptors;
      if (!Array.isArray(descriptors)) {
        throw new Error('batch_play requires params.descriptors to be an array');
      }
      const result = await runBatchPlay(descriptors, params.commandName);
      await postResult({ id, ok: true, data: result });
      return;
    }

    if (cmdAction === 'neural_filter') {
      // Route the legacy neural path through the same generic executor (§4.2).
      const descriptors = neuralDescriptors(params.filter, params);
      const result = await runBatchPlay(descriptors, `neural_filter:${params.filter}`);
      await postResult({ id, ok: true, data: result });
      return;
    }

    await postResult({ id, ok: false, error: `unknown_action:${cmdAction}` });
  } catch (error) {
    await postResult({ id, ok: false, error: error?.message || String(error) });
  }
}

async function pollOnce() {
  try {
    // Retarget to the server's real port before each poll (§6.7).
    await refreshBridgePort();
    const res = await fetch(`${bridgeBase()}/poll`);
    if (res.status === 204) return;
    if (!res.ok) return;
    const cmd = await res.json();
    if (cmd?.id) {
      await handleCommand(cmd);
    }
  } catch {
    // MCP server may not be running yet
  }
}

async function pollLoop() {
  if (polling) return;
  polling = true;
  while (polling) {
    await pollOnce();
    await new Promise((r) => setTimeout(r, 400));
  }
}

entrypoints.setup({
  panels: {
    bridgePanel: {
      show() {
        pollLoop();
      },
      hide() {
        polling = false;
      },
    },
  },
});

pollLoop();
