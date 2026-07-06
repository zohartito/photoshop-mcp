/**
 * TransportRouter — the single choke point for reaching Photoshop
 * (docs/design/transport-layer.md §4.3, §6.2).
 *
 * Responsibilities the design pins to one place:
 *   - env override  PHOTOSHOP_MCP_TRANSPORT = extendscript | uxp | auto (default auto)
 *   - per-command pins (registry metadata, §4.3): neural filters → uxp;
 *     execute_script + preview/export → extendscript
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
import { ExtendScriptTransport } from './extendscript-transport.js';
import { UxpTransport } from './uxp-transport.js';
import type {
  CommandMeta,
  PhotoshopTransport,
  PsCommand,
  TransportId,
} from './types.js';

export type TransportPreference = 'extendscript' | 'uxp' | 'auto';

/**
 * M2 routing table (§4.3, §6): 100% extendscript except the neural command,
 * which is uxp-pinned. execute_script and preview/export stay extendscript-pinned
 * (binary temp-file dance / escape hatch). Registered here as command metadata so
 * routing stays per-command — a global switch could not honor these pins.
 */
const COMMAND_REGISTRY: Record<string, CommandMeta> = {
  neural_filter: { pin: 'uxp' },
  execute_script: { pin: 'extendscript' },
  get_preview: { pin: 'extendscript' },
  export_preview: { pin: 'extendscript' },
  save_document: { pin: 'extendscript' },

  // M3 read-only ports (§4.2, §5): no pin — auto-routable to whichever backend is
  // live. Registered so the routing table documents that backend B can serve them.
  get_state: {},
  get_document_info: {},
  get_layers: {},

  // §6.8 target-identity metadata for the layer family. These carry descriptor
  // builders in ../transport/uxp-commands/descriptors.ts, accept an optional layerId
  // (resolved per backend) and return the affected layerId. The metadata is the
  // machine-checkable source of truth the router, batch mode, and docs share (§6.1).
  // Now WIRED on both backends (§14): the tool handlers call run() with these names,
  // backend A carries the ExtendScript snippet in params.script (unchanged default
  // path), and UxpTransport.run() builds descriptors keyed on the name. Not pinned —
  // auto stays on ExtendScript until the returned layerID is live-verified on a
  // plugin-connected session (scripts/parity-uxp.ts --mutate).
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
    return this.enqueue(() => this.extendscript.runScript(script, timeoutMs));
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
    return this.enqueue(async () => {
      const transport = await this.selectBackend(command.name);
      return transport.run(command);
    });
  }

  /**
   * Run an ordered command sequence as one one-undo operation (§6.3). All commands
   * must resolve to the same backend — an operation cannot span backends. Queued as
   * a single unit so nothing interleaves between the operation's commands.
   */
  runOperation(name: string, commands: PsCommand[]): Promise<unknown> {
    return this.enqueue(async () => {
      const backends = new Set<TransportId>();
      for (const c of commands) backends.add(this.pinFor(c.name) ?? 'extendscript');
      if (backends.size > 1) {
        throw new Error(
          `runOperation("${name}"): an operation cannot span backends (${[...backends].join(', ')})`
        );
      }
      const transport = await this.selectBackend(commands[0]?.name ?? name);
      return transport.runOperation(name, commands);
    });
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

    // auto: prefer ExtendScript (the default backend until M5 packaging), fall
    // back to UXP only if ExtendScript is somehow unavailable but UXP is live.
    if (await this.extendscript.isAvailable()) return this.extendscript;
    if (await this.uxp.isAvailable()) return this.uxp;
    return this.extendscript;
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
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queueTail.then(task, task);
    this.queueTail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }
}
