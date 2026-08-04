/**
 * TransportRouter — the single choke point for reaching Photoshop
 * (docs/design/transport-layer.md §4.3, §6.2).
 *
 * Responsibilities the design pins to one place:
 *   - env override  PHOTOSHOP_MCP_TRANSPORT = extendscript | uxp | auto (default auto)
 *   - per-command pins (registry metadata, §4.3): neural filters → uxp;
 *     internal recipe operations + preview/export → extendscript
 *   - capability gating (auto: preferred backend → isAvailable() → fall back)
 *   - ONE GLOBAL command queue across BOTH backends (§6.2): MacOSExecutor's FIFO
 *     only serializes the ExtendScript channel and executeAsModal only serializes
 *     within one UXP call, so with two channels driving one PS instance a mixed
 *     sequence (UXP mutation then ExtendScript export) can reorder. Serialization
 *     is lifted here so every path through the router is globally ordered.
 *
 * The router is what server.ts injects into the create*Tools factories in place
 * of PhotoshopConnection (§4.4). It exposes both the forward-looking command API
 * (run/runOperation) and a compatibility facade (runScript + connection
 * passthroughs) so the tool-body migration is a mechanical type swap, not a
 * rewrite — tool names, schemas, descriptions, and error envelopes are untouched.
 */
import type { PhotoshopConnection, PhotoshopInfo } from '../platform/connection.js';
import { isUxpBridgeExecutionUncertain } from '../platform/uxp-bridge-server.js';
import { ExtendScriptTransport } from './extendscript-transport.js';
import { UxpTransport } from './uxp-transport.js';
import type { CommandMeta, PhotoshopTransport, PsCommand, TransportId } from './types.js';

export type TransportPreference = 'extendscript' | 'uxp' | 'auto';

const MAX_QUEUED_COMMANDS = 32;
const MAX_QUEUED_COMMAND_BYTES = 1024 * 1024;
const DEFAULT_COMMAND_DEADLINE_MS = 120_000;
const MAX_COMMAND_DEADLINE_MS = 120_000;

/**
 * M2 routing table (§4.3, §6): 100% extendscript except the neural command,
 * which is uxp-pinned. Internal recipe operations and preview/export stay
 * extendscript-pinned. Registered here as command metadata so routing stays
 * per-command — a global switch could not honor these pins.
 */
const COMMAND_REGISTRY: Record<string, CommandMeta> = {
  neural_filter: { pin: 'uxp' },
  extendscript_operation: { pin: 'extendscript' },
  get_preview: { pin: 'extendscript' },
  export_preview: { pin: 'extendscript' },
  save_document: { pin: 'extendscript' },

  // M3 read-only ports (§4.2, §5): no pin — auto-routable to whichever backend is
  // live. Registered so the routing table documents that backend B can serve them.
  get_state: {},
  get_document_info: {},
  get_layers: {},

  // §6.8 target-identity metadata for the layer family. These carry descriptor
  // builders in ../transport/uxp-commands/descriptors.ts and accept an optional
  // layerId (resolved per backend) / return the affected layerId. The metadata is
  // the machine-checkable source of truth the router, batch mode, and docs share
  // (§6.1). Not pinned — auto-routable once the mutating-family port is verified.
  duplicate_layer: { mutatesActiveLayer: true },
  select_layer: { mutatesActiveLayer: true },
  create_layer_mask: { requiresSelection: true, requiresNonBackgroundLayer: true },
  set_layer_properties: { mutatesActiveLayer: true },
};

function readPreference(): TransportPreference {
  const raw = (process.env.PHOTOSHOP_MCP_TRANSPORT ?? 'auto').trim().toLowerCase();
  if (raw === 'extendscript' || raw === 'uxp') return raw;
  return 'auto';
}

export class TransportRouter {
  private readonly extendscript: ExtendScriptTransport;
  private readonly uxp: UxpTransport;
  private readonly preference: TransportPreference;

  /** The one global command queue (§6.2): a single serial tail all work awaits. */
  private queueTail: Promise<unknown> = Promise.resolve();
  private queuedCommands = 0;
  private queuedBytes = 0;

  constructor(connection: PhotoshopConnection) {
    this.extendscript = new ExtendScriptTransport(connection);
    this.uxp = new UxpTransport();
    this.preference = readPreference();
  }

  // --- compatibility facade (what the migrated tool bodies call) ---

  /**
   * Execute a ready-built ExtendScript string through the global queue. This is
   * the drop-in for the old `PhotoshopAPIFactory(connection).createAPI()
   * .executeScript(script, timeoutMs)` that runSnippet/runScript/
   * runGenerativeSnippet/executeRecipe and the inline factory sites all reduced to.
   * ExtendScript strings are always backend A (that is where the snippet library
   * lives); pins/auto only matter for the command API below.
   */
  runScript(script: string, timeoutMs?: number): Promise<unknown> {
    return this.enqueue(
      (remainingMs) => this.extendscript.runScript(script, remainingMs),
      timeoutMs,
      Buffer.byteLength(script)
    );
  }

  getVersion(): Promise<string> {
    return this.extendscript.getVersion();
  }

  ping(): Promise<boolean> {
    return this.extendscript.ping();
  }

  getPhotoshopInfo(): PhotoshopInfo | null {
    return this.extendscript.getPhotoshopInfo();
  }

  // --- forward-looking command API (§4.1) ---

  /** Route one command to its backend (pin → auto) and run it on the global queue. */
  run(command: PsCommand): Promise<unknown> {
    return this.enqueue(
      async (remainingMs) => {
        const transport = await this.selectBackend(command.name);
        return transport.run({ ...command, timeoutMs: remainingMs });
      },
      command.timeoutMs,
      estimateCommandBytes(command)
    );
  }

  /**
   * Run an ordered command sequence as one one-undo operation (§6.3). All commands
   * must resolve to the same backend — an operation cannot span backends. Queued as
   * a single unit so nothing interleaves between the operation's commands.
   */
  runOperation(name: string, commands: PsCommand[]): Promise<unknown> {
    return this.enqueue(
      async (remainingMs) => {
        const backends = new Set<TransportId>();
        for (const c of commands) backends.add(this.pinFor(c.name) ?? 'extendscript');
        if (backends.size > 1) {
          throw new Error(
            `runOperation("${name}"): an operation cannot span backends (${[...backends].join(', ')})`
          );
        }
        const transport = await this.selectBackend(commands[0]?.name ?? name);
        return transport.runOperation(
          name,
          commands.map((command) => ({ ...command, timeoutMs: remainingMs }))
        );
      },
      undefined,
      commands.reduce(
        (total, command) => total + estimateCommandBytes(command),
        Buffer.byteLength(name)
      )
    );
  }

  // --- routing internals ---

  private pinFor(commandName: string): TransportId | undefined {
    return COMMAND_REGISTRY[commandName]?.pin;
  }

  /**
   * Pick the backend for a command: an explicit pin wins; otherwise the env
   * preference; otherwise auto (preferred → isAvailable() → fall back to the other).
   */
  private async selectBackend(commandName: string): Promise<PhotoshopTransport> {
    const pin = this.pinFor(commandName);
    if (pin) return this.transportById(pin);

    if (this.preference === 'extendscript') return this.extendscript;
    if (this.preference === 'uxp') return this.uxp;

    // Auto mode never selects a disabled/unreachable backend. On macOS the
    // ExtendScript executor is tombstoned, so only a live authenticated UXP
    // peer may be selected.
    if (await this.extendscript.isAvailable()) return this.extendscript;
    if (await this.uxp.isAvailable()) return this.uxp;
    throw new Error('No live authenticated Photoshop transport is available.');
  }

  private transportById(id: TransportId): PhotoshopTransport {
    if (id === 'uxp') return this.uxp;
    return this.extendscript;
  }

  /**
   * Append work to the single global FIFO. Failures do not poison the tail: the
   * chain continues with a resolved sentinel so one command's error never blocks
   * later commands (the old MacOSExecutor queue had the same property).
   */
  private enqueue<T>(
    task: (remainingMs: number) => Promise<T>,
    timeoutMs?: number,
    bytes = 0
  ): Promise<T> {
    this.assertExecutionSafe();
    const deadlineMs = normalizeDeadline(timeoutMs);
    if (this.queuedCommands >= MAX_QUEUED_COMMANDS) {
      return Promise.reject(
        new Error(`Photoshop command queue is full (${MAX_QUEUED_COMMANDS} commands).`)
      );
    }
    if (bytes > MAX_QUEUED_COMMAND_BYTES || this.queuedBytes + bytes > MAX_QUEUED_COMMAND_BYTES) {
      return Promise.reject(new Error('Photoshop command queue byte budget is exhausted.'));
    }
    this.queuedCommands += 1;
    this.queuedBytes += bytes;
    const deadline = Date.now() + deadlineMs;
    const runTask = async (): Promise<T> => {
      this.assertExecutionSafe();
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        throw new Error('Photoshop command expired while waiting in the queue.');
      }
      // Both current backends receive this remaining deadline: ExtendScript
      // passes it to the platform executor and UXP passes it to the bridge.
      // A backend that cannot honor cancellation must fail rather than running
      // after this deadline.
      return task(remainingMs);
    };
    const run = this.queueTail.then(runTask, runTask);
    this.queueTail = run.then(
      () => undefined,
      () => undefined
    );
    // Do not race a detached timer: it would reject the caller while leaving a
    // mutation live. The dispatched backend gets the same remaining deadline,
    // and admission remains occupied until its real completion/failure.
    void run.then(
      () => {
        this.queuedCommands -= 1;
        this.queuedBytes -= bytes;
      },
      () => {
        this.queuedCommands -= 1;
        this.queuedBytes -= bytes;
      }
    );
    return run;
  }

  private assertExecutionSafe(): void {
    if (isUxpBridgeExecutionUncertain()) {
      throw new Error(
        'Photoshop execution is quarantined after an uncertain UXP mutation. Restart the bridge process, then reload the authenticated UXP bridge plugin and complete a fresh handshake before sending more commands.'
      );
    }
  }
}

function normalizeDeadline(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined) return DEFAULT_COMMAND_DEADLINE_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new Error('Command timeout must be a positive finite number.');
  return Math.min(timeoutMs, MAX_COMMAND_DEADLINE_MS);
}

function estimateCommandBytes(command: PsCommand): number {
  return Buffer.byteLength(JSON.stringify(command.params ?? {}), 'utf8');
}
