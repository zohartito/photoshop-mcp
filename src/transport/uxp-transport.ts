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
  addLayerMaskDescriptor,
  duplicateLayerDescriptor,
  getActiveLayerDescriptor,
  getActiveLayerIdDescriptor,
  getDocumentDescriptor,
  getLayerByIndexDescriptor,
  getSelectionDescriptor,
  selectLayerByIdDescriptor,
  setLayerPropertiesDescriptor,
} from './uxp-commands/descriptors.js';
import {
  normalizeCreateLayerMask,
  normalizeDuplicateLayer,
  normalizeGetDocumentInfo,
  normalizeGetLayers,
  normalizeGetState,
  normalizeSelectLayer,
  normalizeSetLayerProperties,
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
 * Commands the UXP backend ADVERTISES as servable (feeds capabilities().commands).
 * neural_filter is the original path; the three read-only commands are the first
 * descriptor ports (§5); the mutating layer-family is the §6.8 target-identity port
 * — descriptors + read-back are wired, pending live verification of the returned
 * layerID (transport-layer.md §6.8, §14).
 *
 * `select_layer` is deliberately NOT advertised here even though run() handles it:
 * backend B can only select by native id ({ _ref:'layer', _id }); it has no generic
 * batchPlay way to resolve the tool's default by-NAME selection (that needs the
 * plugin's DOM, which the generic batch_play action does not expose). So UXP
 * select_layer is only meaningful inside a layerId-carrying chain (duplicate → mask)
 * — advertising it as a general capability would over-promise (Codex MED). run()
 * throws loud if it is invoked without a layerId.
 */
const UXP_COMMANDS = [
  'neural_filter',
  'get_state',
  'get_layers',
  'get_document_info',
  'duplicate_layer',
  'create_layer_mask',
  'set_layer_properties',
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
    const params = command.params ?? {};
    const layerId = typeof params.layerId === 'number' ? params.layerId : undefined;
    switch (command.name) {
      case 'get_state':
        return this.getState(command.timeoutMs);
      case 'get_document_info':
        return this.getDocumentInfo(command.timeoutMs);
      case 'get_layers':
        return this.getLayers(command.timeoutMs);
      case 'duplicate_layer':
        return this.duplicateLayer(
          layerId,
          typeof params.newName === 'string' ? params.newName : undefined,
          command.timeoutMs
        );
      case 'select_layer':
        return this.selectLayer(layerId, command.timeoutMs);
      case 'create_layer_mask':
        return this.createLayerMask(layerId, command.timeoutMs);
      case 'set_layer_properties':
        return this.setLayerProperties(
          layerId,
          typeof params.opacity === 'number' ? params.opacity : undefined,
          typeof params.blendMode === 'string' ? params.blendMode : undefined,
          command.timeoutMs
        );
      case 'neural_filter':
        return this.invokeRaw(command.name, params, command.timeoutMs ?? 90_000);
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

  // --- ported mutating commands (§6.8 target identity) ---
  //
  // Each builds its descriptor(s) (targeting by layerId when supplied, else the
  // active layer), APPENDS a `get` of the resulting active layer's layerID, runs
  // the whole array in one batch_play, and normalizes to the ExtendScript twin's
  // shape — crucially surfacing the affected `layerId` (the read-back the §6.8
  // contract requires). Live verification of the returned layerID is pending a
  // plugin-connected session (transport-layer.md §6.8, §14).

  private async duplicateLayer(
    layerId: number | undefined,
    newName: string | undefined,
    timeoutMs?: number
  ): Promise<unknown> {
    const dupDescriptors = duplicateLayerDescriptor(layerId, newName);
    const descriptors = [...dupDescriptors, getActiveLayerIdDescriptor()];
    const raw = await this.runBatchPlay(descriptors, 'duplicate_layer', timeoutMs);
    // Last element = the appended `get` of the active layer's id (the copy, which
    // duplicate leaves active); first element = the duplicate action's own result
    // (adb-mcp reads `o[0].layerID`). Pass both so the normalizer can fall back.
    return normalizeDuplicateLayer(raw[raw.length - 1], raw[dupDescriptors.length - 1]);
  }

  private async selectLayer(
    layerId: number | undefined,
    timeoutMs?: number
  ): Promise<unknown> {
    if (typeof layerId !== 'number') {
      // By-name selection is backend-A only (needs the DOM layer walk); backend B
      // selects strictly by native id. Under PHOTOSHOP_MCP_TRANSPORT=uxp a no-id
      // name-select cannot be served — fail loud rather than select the wrong layer.
      throw new Error(
        'select_layer via UXP requires a layerId; by-name selection is only available on the ExtendScript backend'
      );
    }
    const descriptors = [...selectLayerByIdDescriptor(layerId), getActiveLayerIdDescriptor()];
    const raw = await this.runBatchPlay(descriptors, 'select_layer', timeoutMs);
    return normalizeSelectLayer(raw[raw.length - 1]);
  }

  private async createLayerMask(
    layerId: number | undefined,
    timeoutMs?: number
  ): Promise<unknown> {
    // Match the ExtendScript twin: reveal the current selection when one exists,
    // else reveal all. The selection probe is the same one the read-only path uses.
    const fromSelection = await this.probeSelection(timeoutMs);
    const descriptors = [
      ...addLayerMaskDescriptor(layerId, fromSelection ? 'revealSelection' : 'revealAll'),
      getActiveLayerIdDescriptor(),
    ];
    const raw = await this.runBatchPlay(descriptors, 'create_layer_mask', timeoutMs);
    return normalizeCreateLayerMask(raw[raw.length - 1], fromSelection);
  }

  private async setLayerProperties(
    layerId: number | undefined,
    opacity: number | undefined,
    blendMode: string | undefined,
    timeoutMs?: number
  ): Promise<unknown> {
    const descriptors = [
      ...setLayerPropertiesDescriptor({ layerId, opacity, blendMode }),
      getActiveLayerIdDescriptor(),
    ];
    const raw = await this.runBatchPlay(descriptors, 'set_layer_properties', timeoutMs);
    return normalizeSetLayerProperties(raw[raw.length - 1], { opacity, blendMode });
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
