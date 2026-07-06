/**
 * Client for the MCP-hosted UXP bridge (liveness check + neural filter invoke).
 */
import {
  ensureUxpBridgeServer,
  getUxpBridgeLastPollAt,
  invokeUxpBridge,
} from './uxp-bridge-server.js';

/**
 * Truthful liveness (docs/design/transport-layer.md §4.1, Codex #3): the plugin
 * must have hit `GET /poll` recently. The old `/health` probe only proved the
 * in-process server was up, which is always true and told nothing about whether
 * the plugin was actually connected — so `neural_filters` could report available
 * with no plugin. Delegates to the same last-poll signal `UxpTransport` uses.
 */
const POLL_FRESHNESS_MS = 2_000;

export async function isUxpBridgeReachable(): Promise<boolean> {
  try {
    await ensureUxpBridgeServer();
  } catch {
    return false;
  }
  const lastPoll = getUxpBridgeLastPollAt();
  return lastPoll > 0 && Date.now() - lastPoll <= POLL_FRESHNESS_MS;
}

export type NeuralFilterKind = 'skin_smoothing' | 'harmonize' | 'depth_blur' | 'super_zoom';

export interface NeuralFilterParams {
  smoothness?: number;
  blur?: number;
  reference_layer_id?: number;
}

export async function invokeNeuralFilter(
  filter: NeuralFilterKind,
  params: NeuralFilterParams = {}
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const result = await invokeUxpBridge('neural_filter', { filter, ...params }, 90_000);
  if (!result.ok) {
    return { ok: false, error: result.error ?? 'neural_filter_failed' };
  }
  return { ok: true, data: result.data };
}
