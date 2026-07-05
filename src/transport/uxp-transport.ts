/**
 * Backend B — UXP batchPlay bridge (docs/design/transport-layer.md §4.1, §7).
 *
 * Moves the existing neural-filter HTTP bridge behind the transport interface.
 * The channel (in-process HTTP long-poll: plugin polls GET /poll, posts POST
 * /result) is unchanged and stays internal to this backend — bridge JSON
 * envelopes are normalized here so callers get a parsed result, never the raw
 * envelope (§4.1). M3 replaces the plugin's per-filter switch with one generic
 * `batch_play` action and ports read-only commands first.
 */
import {
  ensureUxpBridgeServer,
  getUxpBridgeLastPollAt,
  invokeUxpBridge,
} from '../platform/uxp-bridge-server.js';
import type {
  PhotoshopTransport,
  PsCommand,
  TransportCapabilities,
} from './types.js';

/**
 * How recently the plugin must have polled to count as "connected". The plugin
 * loop is ~400ms; ~2s tolerates one or two missed beats without false-positives
 * from a stale server (§4.1, Codex #3).
 */
const POLL_FRESHNESS_MS = 2_000;

/** Commands the UXP backend serves in M2. Only neural filters are ported so far. */
const UXP_COMMANDS = ['neural_filter'] as const;

export class UxpTransport implements PhotoshopTransport {
  readonly id = 'uxp' as const;

  /**
   * Truthful liveness (§4.1, Codex #3): the plugin must have hit `/poll` within
   * POLL_FRESHNESS_MS. We do NOT probe the in-process `/health` endpoint — it
   * always answers and proves nothing about the plugin. `ensureUxpBridgeServer`
   * is idempotent; we call it so the port is bound and the plugin can reach it.
   */
  async isAvailable(): Promise<boolean> {
    try {
      await ensureUxpBridgeServer();
    } catch {
      return false;
    }
    const lastPoll = getUxpBridgeLastPollAt();
    return lastPoll > 0 && Date.now() - lastPoll <= POLL_FRESHNESS_MS;
  }

  async capabilities(): Promise<TransportCapabilities> {
    return {
      id: this.id,
      available: await this.isAvailable(),
      commands: [...UXP_COMMANDS],
    };
  }

  /**
   * Route one command to the plugin and normalize the bridge envelope. Throws on
   * bridge failure so the router/tool sees a normal Error (matching how the
   * ExtendScript backend surfaces failures), rather than leaking `{ ok:false }`.
   */
  async run(command: PsCommand): Promise<unknown> {
    const result = await invokeUxpBridge(
      command.name,
      command.params ?? {},
      command.timeoutMs ?? 90_000
    );
    if (!result.ok) {
      throw new Error(result.error ?? `uxp command "${command.name}" failed`);
    }
    return result.data;
  }

  /**
   * §6.3 — the UXP twin of a one-undo operation is a single executeAsModal +
   * history suspension around the whole descriptor sequence, which the plugin
   * runs. In M2 the only UXP path is the single neural_filter command, so an
   * operation is exactly one command; multi-descriptor operations land in M3.
   */
  async runOperation(name: string, commands: PsCommand[]): Promise<unknown> {
    if (commands.length !== 1) {
      throw new Error(
        `UxpTransport.runOperation("${name}"): multi-command UXP operations arrive in M3, ` +
          `got ${commands.length}`
      );
    }
    return this.run(commands[0]);
  }
}
