/**
 * Backend B — UXP batchPlay bridge (docs/design/transport-layer.md §4.1, §4.2, §7).
 *
 * Moves the existing neural-filter HTTP bridge behind the transport interface and,
 * in M3, adds server-side implementations of commands that run via the plugin's
 * one generic `batch_play` action. Each UXP implementation builds a batchPlay
 * descriptor array (src/transport/uxp-commands/descriptors.ts), sends it through
 * the bridge, and normalizes the raw result to the SAME envelope as its
 * ExtendScript twin (src/transport/uxp-commands/normalize.ts, §4.2). The channel
 * (in-process HTTP long-poll) stays internal to this backend — callers get a
 * parsed result, never the raw bridge envelope (§4.1).
 *
 * PORTED IN M3 (read-only first, per §5): get_state, get_layers, get_document_info.
 * NOT LIVE-VERIFIED this run — the plugin is not loaded; PHOTOSHOP_MCP_TRANSPORT=uxp
 * vs extendscript parity diffing is deferred to a plugin-connected follow-up.
 */
import {
  ensureUxpBridgeServer,
  getUxpBridgeLastPollAt,
  invokeUxpBridge,
} from '../platform/uxp-bridge-server.js';
import type { ActionDescriptor } from '../api/batch-play.js';
import {
  getActiveLayerDescriptor,
  getDocumentDescriptor,
} from './uxp-commands/descriptors.js';
import {
  normalizeGetDocumentInfo,
  normalizeGetLayers,
  normalizeGetState,
} from './uxp-commands/normalize.js';
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

/**
 * Commands the UXP backend serves in M3. neural_filter is the original path;
 * the three read-only commands are the first descriptor ports (§5). Mutating
 * layer-family commands (duplicate/select/mask/properties) have descriptor
 * builders in ./uxp-commands/descriptors.ts (§6.8 groundwork) but are not routed
 * through run() until a plugin-connected session verifies their result parsing.
 */
const UXP_COMMANDS = [
  'neural_filter',
  'get_state',
  'get_layers',
  'get_document_info',
] as const;

/** A raw batchPlay result is an array of ActionDescriptor objects. */
type BatchPlayResult = Record<string, unknown>[];

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
   * Route one command to the plugin. neural_filter passes its params straight to
   * the bridge (the plugin builds the descriptors). The ported read-only commands
   * build descriptors server-side, run them via the generic `batch_play` action,
   * and normalize to the ExtendScript envelope (§4.2). Throws on bridge failure so
   * the router/tool sees a normal Error, never a leaked `{ ok:false }`.
   */
  async run(command: PsCommand): Promise<unknown> {
    switch (command.name) {
      case 'get_state':
        return this.getState(command.timeoutMs);
      case 'get_document_info':
        return this.getDocumentInfo(command.timeoutMs);
      case 'get_layers':
        return this.getLayers(command.timeoutMs);
      case 'neural_filter':
        return this.invokeRaw(command.name, command.params ?? {}, command.timeoutMs ?? 90_000);
      default:
        throw new Error(`UxpTransport: command "${command.name}" is not ported to backend B`);
    }
  }

  /**
   * §6.3 — the UXP twin of a one-undo operation is a single executeAsModal +
   * history suspension around the whole descriptor sequence, which the plugin runs
   * via one batch_play call. In M3 the ported UXP paths are single commands, so an
   * operation is exactly one command; multi-descriptor composed operations land
   * with the mutating-family port in a later session.
   */
  async runOperation(name: string, commands: PsCommand[]): Promise<unknown> {
    if (commands.length !== 1) {
      throw new Error(
        `UxpTransport.runOperation("${name}"): multi-command UXP operations arrive with the ` +
          `mutating-family port, got ${commands.length}`
      );
    }
    return this.run(commands[0]);
  }

  // --- ported read-only commands (§4.2, §5) ---

  private async getState(timeoutMs?: number): Promise<unknown> {
    const { docDesc, layerDesc } = await this.readDocumentAndLayer(timeoutMs);
    // hasSelection defaults false; a dedicated selection-bounds probe is added
    // when this path is live-verified (the ExtendScript twin reads it inline).
    return normalizeGetState(docDesc, layerDesc, false);
  }

  private async getDocumentInfo(timeoutMs?: number): Promise<unknown> {
    const { docDesc, layerDesc } = await this.readDocumentAndLayer(timeoutMs);
    return normalizeGetDocumentInfo(docDesc, layerDesc, false);
  }

  private async getLayers(timeoutMs?: number): Promise<unknown> {
    const { docDesc, layerDesc } = await this.readDocumentAndLayer(timeoutMs);
    const context = normalizeGetState(docDesc, layerDesc, false);
    // A full recursive multi-layer get is built when this path is live-verified;
    // M3 embeds the active-layer descriptor so the envelope shape is correct and
    // the normalizer is exercised. See ./uxp-commands/descriptors.ts.
    const layerDescs = layerDesc ? [layerDesc] : [];
    return normalizeGetLayers(layerDescs, context);
  }

  // --- bridge plumbing ---

  /**
   * Run a descriptor array via the generic `batch_play` plugin action and return
   * the raw ActionDescriptor result array.
   */
  private async runBatchPlay(
    descriptors: ActionDescriptor[],
    commandName: string,
    timeoutMs = 30_000
  ): Promise<BatchPlayResult> {
    const data = await this.invokeRaw(
      'batch_play',
      { descriptors, commandName },
      timeoutMs
    );
    return Array.isArray(data) ? (data as BatchPlayResult) : [];
  }

  /** Invoke the bridge and unwrap the envelope, throwing on failure. */
  private async invokeRaw(
    action: string,
    params: Record<string, unknown>,
    timeoutMs: number
  ): Promise<unknown> {
    const result = await invokeUxpBridge(action, params, timeoutMs);
    if (!result.ok) {
      throw new Error(result.error ?? `uxp command "${action}" failed`);
    }
    return result.data;
  }

  /** Fetch the active-document and active-layer descriptors in one batch_play. */
  private async readDocumentAndLayer(
    timeoutMs?: number
  ): Promise<{ docDesc: Record<string, unknown> | null; layerDesc: Record<string, unknown> | null }> {
    const descriptors = [...getDocumentDescriptor(), ...getActiveLayerDescriptor()];
    const raw = await this.runBatchPlay(descriptors, 'read_state', timeoutMs);
    return {
      docDesc: raw[0] ?? null,
      layerDesc: raw[1] ?? null,
    };
  }
}
