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
 * PORTED: get_state, get_layers, get_document_info, and rename_layers_batch.
 * LIVE-VERIFIED 2026-07-05 on PS 27.8 — scripts/parity-uxp.ts reports 3/3 CLEAN
 * against the ExtendScript twins (masked-layer + active-selection fixture). See
 * docs/design/transport-layer.md §12 for the verification record and the
 * Action Manager quirk catalog these implementations encode.
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
  getLayerByIndexDescriptor,
  getLayerByNameDescriptor,
  getSelectionDescriptor,
  renameLayersBatchDescriptor,
  type RenameLayerBatchEntry,
} from './uxp-commands/descriptors.js';
import {
  normalizeGetDocumentInfo,
  normalizeGetLayers,
  normalizeGetState,
  normalizeRenameLayersBatch,
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
 * Commands the UXP backend serves. neural_filter is the original path; the three
 * read-only commands are the first descriptor ports (§5); rename_layers_batch is
 * the first mutating layer command. Other mutating layer-family commands have
 * descriptor groundwork but are not routed through run() yet.
 */
const UXP_COMMANDS = [
  'neural_filter',
  'get_state',
  'get_layers',
  'get_document_info',
  'rename_layers_batch',
] as const;

/** A raw batchPlay result is an array of ActionDescriptor objects. */
type BatchPlayResult = Record<string, unknown>[];

type RenameRequest = Pick<RenameLayerBatchEntry, 'oldName' | 'newName'>;

/** Validate the transport boundary even when a caller bypasses the MCP schema. */
function parseRenameBatchEntries(raw: unknown): RenameRequest[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('renames must be a non-empty array');
  }

  return raw.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`renames[${index}] must be an object`);
    }
    const candidate = entry as Record<string, unknown>;
    if (typeof candidate.oldName !== 'string' || candidate.oldName.length === 0) {
      throw new Error(`renames[${index}] requires a non-empty oldName`);
    }
    if (typeof candidate.newName !== 'string' || candidate.newName.length === 0) {
      throw new Error(`renames[${index}] requires a non-empty newName`);
    }
    return { oldName: candidate.oldName, newName: candidate.newName };
  });
}

/** Photoshop's Action Manager wording for a missing document/layer target. */
function isUnavailableTargetError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  // Infrastructure failures must retain their original message so the standard
  // error classifier can distinguish a dead bridge or watchdog timeout.
  if (
    /uxp.?bridge|plugin_watchdog|timeout|unknown_action|ECONN|EADDR|fetch failed/i.test(message)
  ) {
    return false;
  }
  return /not currently available|not available|could not find|does not exist|not found/i.test(
    message
  );
}

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
   * the bridge (the plugin builds the descriptors). Ported commands build
   * descriptors server-side, run them via the generic `batch_play` action, and
   * normalize to the ExtendScript envelope (§4.2). Throws on bridge failure so the
   * router/tool sees a normal Error, never a leaked `{ ok:false }`.
   */
  async run(command: PsCommand): Promise<unknown> {
    switch (command.name) {
      case 'get_state':
        return this.getState(command.timeoutMs);
      case 'get_document_info':
        return this.getDocumentInfo(command.timeoutMs);
      case 'get_layers':
        return this.getLayers(command.timeoutMs);
      case 'rename_layers_batch':
        return this.renameLayersBatch(command.params?.renames, command.timeoutMs);
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

  /**
   * hasSelection probe: a `get` of the document's selection property THROWS when
   * no selection exists, so it runs as its own bridge command and maps failure →
   * false. Separate round-trip by design (the shared batch would fail wholesale
   * under continueOnError:false); merge once the plugin gains continueOnError.
   */
  private async probeSelection(timeoutMs?: number): Promise<boolean> {
    try {
      const raw = await this.runBatchPlay(getSelectionDescriptor(), 'probe_selection', timeoutMs);
      const selection = raw[0]?.selection;
      return !!selection && typeof selection === 'object';
    } catch {
      return false;
    }
  }

  private async getState(timeoutMs?: number): Promise<unknown> {
    const { docDesc, layerDesc } = await this.readDocumentAndLayer(timeoutMs);
    const hasSelection = docDesc ? await this.probeSelection(timeoutMs) : false;
    return normalizeGetState(docDesc, layerDesc, hasSelection);
  }

  private async getDocumentInfo(timeoutMs?: number): Promise<unknown> {
    const { docDesc, layerDesc } = await this.readDocumentAndLayer(timeoutMs);
    const hasSelection = docDesc ? await this.probeSelection(timeoutMs) : false;
    return normalizeGetDocumentInfo(docDesc, layerDesc, hasSelection);
  }

  /**
   * Full layer walk (live-verified on PS 27.8): AM `numberOfLayers` excludes a
   * Background layer, and the `_index` space puts the background at index 0 with
   * non-background layers at 1..N (bottom→top). Requesting an index past N errors
   * the whole sync batchPlay — the first walk attempt proved the model. Iterate
   * N..1 then 0 to match the top-first order of the ExtendScript twin.
   */
  private async getLayers(timeoutMs?: number): Promise<unknown> {
    const { docDesc, layerDesc } = await this.readDocumentAndLayer(timeoutMs);
    const hasSelection = docDesc ? await this.probeSelection(timeoutMs) : false;
    const context = normalizeGetState(docDesc, layerDesc, hasSelection);

    const numberOfLayers =
      docDesc && typeof docDesc.numberOfLayers === 'number' ? docDesc.numberOfLayers : 0;
    const hasBackground = docDesc?.hasBackgroundLayer === true;

    let layerDescs: Record<string, unknown>[] = [];
    if (numberOfLayers > 0 || hasBackground) {
      const gets = [];
      for (let index = numberOfLayers; index >= 1; index--) {
        gets.push(getLayerByIndexDescriptor(index));
      }
      if (hasBackground) {
        gets.push(getLayerByIndexDescriptor(0));
      }
      layerDescs = await this.runBatchPlay(gets, 'walk_layers', timeoutMs);
    }
    return normalizeGetLayers(layerDescs, context);
  }

  // --- ported mutating commands ---

  /**
   * Resolve every name to a stable native id before changing anything, then send
   * every `set` descriptor in one batchPlay call. This makes missing targets
   * fail before mutation and keeps swaps/chains bound to their original layers.
   * Mutation and bridge failures deliberately propagate to the standard envelope.
   */
  private async renameLayersBatch(rawRenames: unknown, timeoutMs?: number): Promise<unknown> {
    const renames = parseRenameBatchEntries(rawRenames);

    let documentResult: BatchPlayResult;
    try {
      documentResult = await this.runBatchPlay(
        getDocumentDescriptor(),
        'rename_layers_batch:preflight_document',
        timeoutMs
      );
    } catch (error) {
      if (isUnavailableTargetError(error)) {
        throw new Error('No active document');
      }
      throw error;
    }
    if (!documentResult[0]) {
      throw new Error('No active document');
    }

    const resolved: RenameLayerBatchEntry[] = [];
    for (const rename of renames) {
      let layerResult: BatchPlayResult;
      try {
        layerResult = await this.runBatchPlay(
          [getLayerByNameDescriptor(rename.oldName)],
          `rename_layers_batch:preflight_layer:${rename.oldName}`,
          timeoutMs
        );
      } catch (error) {
        if (isUnavailableTargetError(error)) {
          throw new Error(`Layer not found: ${rename.oldName}`);
        }
        throw error;
      }

      const layerId = layerResult[0]?.layerID;
      if (typeof layerId !== 'number') {
        throw new Error(`Layer not found: ${rename.oldName}`);
      }
      resolved.push({ ...rename, layerId });
    }

    await this.runBatchPlay(
      renameLayersBatchDescriptor(resolved),
      'rename_layers_batch',
      timeoutMs
    );
    return normalizeRenameLayersBatch(renames);
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
