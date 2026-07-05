/**
 * Transport-layer contracts (M2 of the transport-layer refactor).
 * See docs/design/transport-layer.md §4.1 and §6.
 *
 * A transport is the swappable seam between an MCP tool and Photoshop. It sits
 * ABOVE payload generation: the ExtendScript backend owns ExtendScript source
 * strings + the "ERROR:"/toSource() protocol internally; the UXP backend owns
 * batchPlay descriptors + the bridge JSON envelopes internally. Tools never see
 * which backend answered — result normalization lives inside each transport.
 */

/** Backend identifier. `firefly` is reserved for a hypothetical cloud backend C (§8). */
export type TransportId = 'extendscript' | 'uxp' | 'firefly';

/**
 * A single command routed to Photoshop. `name` matches the command-registry key
 * (e.g. `neural_filter`); `params` are already validated by the owning tool.
 */
export interface PsCommand {
  name: string;
  params: Record<string, unknown>;
  timeoutMs?: number;
}

/**
 * Coarse per-backend capability report (§4.1). Kept intentionally small in M2;
 * M3 expands this as commands are ported to the UXP backend.
 */
export interface TransportCapabilities {
  id: TransportId;
  /** Whether this backend is currently usable (PS detected / plugin connected). */
  available: boolean;
  /** Command names this backend can run right now. Empty ⇒ "all registered" (ExtendScript). */
  commands?: string[];
}

/**
 * The swappable backend interface. Backend A = ExtendScript, backend B = UXP.
 *
 * `run` / `runOperation` are the forward-looking §4.1 command API. `runOperation`
 * exists because one-undo recipes need a boundary ABOVE single commands: the whole
 * sequence must run inside one history scope (ExtendScript: suspendHistory around
 * the full script; UXP: one executeAsModal + history suspension around all
 * descriptors). An operation cannot span backends (§6.3).
 */
export interface PhotoshopTransport {
  readonly id: TransportId;

  /** Truthful liveness: PS detected (ExtendScript) / plugin polled recently (UXP, §4.1). */
  isAvailable(): Promise<boolean>;

  capabilities(): Promise<TransportCapabilities>;

  /** Run one command; returns the parsed/normalized result — never a raw string. */
  run(command: PsCommand): Promise<unknown>;

  /** Run an ordered command sequence inside a single one-undo history scope (§6.3). */
  runOperation(name: string, commands: PsCommand[]): Promise<unknown>;
}

/**
 * Per-command routing metadata, kept as registry entries so the router, batch
 * mode, and docs consume one source of truth (§4.2, §6). In M2 the registry is
 * derived at registration time and used only for pins; the semantic-contract
 * booleans (§6.1/§6.8) are declared here for M3 to populate as commands migrate.
 */
export interface CommandMeta {
  /** Force this command onto a specific backend regardless of `PHOTOSHOP_MCP_TRANSPORT`. */
  pin?: TransportId;
  /** §6.1 — command depends on / mutates the active layer. */
  mutatesActiveLayer?: boolean;
  /** §6.1 — command requires a live selection. */
  requiresSelection?: boolean;
  /** §6.1 — command must not run on a Background layer. */
  requiresNonBackgroundLayer?: boolean;
}
