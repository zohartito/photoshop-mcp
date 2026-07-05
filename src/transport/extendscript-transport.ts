/**
 * Backend A — ExtendScript (docs/design/transport-layer.md §4.1, §4.2).
 *
 * Wraps the EXISTING machinery unchanged: PhotoshopConnection → ScriptExecutor,
 * PhotoshopAPIFactory / ExtendScriptPhotoshopAPI (px/pt unit forcing, DialogModes.NO,
 * alert/confirm/prompt shims, the "ERROR:" string protocol, toSource() serialization),
 * and parseExtendScriptPayload for result normalization. None of that logic is
 * duplicated here — the transport is a thin altitude-lift so tools stop holding a
 * PhotoshopConnection directly. Result normalization stays internal to the backend
 * (§4.1): callers get parsed payloads, never raw ExtendScript strings.
 */
import { PhotoshopAPIFactory } from '../api/photoshop-api.js';
import type { PhotoshopConnection, PhotoshopInfo } from '../platform/connection.js';
import type {
  PhotoshopTransport,
  PsCommand,
  TransportCapabilities,
} from './types.js';

/**
 * A command destined for the ExtendScript backend carries a ready-built
 * ExtendScript source string in `params.script`. This is the M2 bridge: the
 * per-tool script generators (the 2,467-line snippet library) remain the
 * `extendscript` implementations, co-located with their tool files (§4.2 as
 * amended by Codex #1). M3 formalizes a per-command registry on top of this.
 */
export interface ExtendScriptCommandParams extends Record<string, unknown> {
  script: string;
  timeoutMs?: number;
}

function scriptFromCommand(command: PsCommand): { script: string; timeoutMs?: number } {
  const script = command.params?.script;
  if (typeof script !== 'string') {
    throw new Error(
      `ExtendScriptTransport: command "${command.name}" is missing params.script`
    );
  }
  const timeoutMs =
    command.timeoutMs ??
    (typeof command.params?.timeoutMs === 'number'
      ? (command.params.timeoutMs as number)
      : undefined);
  return { script, timeoutMs };
}

export class ExtendScriptTransport implements PhotoshopTransport {
  readonly id = 'extendscript' as const;

  private readonly connection: PhotoshopConnection;

  constructor(connection: PhotoshopConnection) {
    this.connection = connection;
  }

  /**
   * Execute a ready-built ExtendScript string and return the parsed result.
   * Behaviourally identical to the old `PhotoshopAPIFactory(connection)
   * .createAPI().executeScript(script, timeoutMs)` that every tool used to call —
   * a fresh factory per call, exactly as before, so lazy PS detection still
   * recovers on a later call if the first ran before the connection was warm.
   */
  async runScript(script: string, timeoutMs?: number): Promise<unknown> {
    const api = await new PhotoshopAPIFactory(this.connection).createAPI();
    return api.executeScript(script, timeoutMs);
  }

  async run(command: PsCommand): Promise<unknown> {
    const { script, timeoutMs } = scriptFromCommand(command);
    return this.runScript(script, timeoutMs);
  }

  /**
   * §6.3 — an operation is one one-undo history scope. For the ExtendScript
   * backend the whole sequence is a single wrapped script (recipes already do
   * this via suspendHistory around the full body). In M2 we accept a single
   * pre-composed command carrying the whole script; multi-command composition
   * on this backend arrives with the M3 registry.
   */
  async runOperation(name: string, commands: PsCommand[]): Promise<unknown> {
    if (commands.length !== 1) {
      throw new Error(
        `ExtendScriptTransport.runOperation("${name}"): expected exactly one pre-composed ` +
          `command in M2, got ${commands.length}`
      );
    }
    return this.run(commands[0]);
  }

  async isAvailable(): Promise<boolean> {
    // Truthful for backend A = "Photoshop is detected/reachable" (§4.1). The
    // ExtendScript channel needs a real PS install; ping() performs detection.
    return this.connection.ping();
  }

  async capabilities(): Promise<TransportCapabilities> {
    return {
      id: this.id,
      available: await this.isAvailable(),
      // Empty ⇒ backend A can run any registered command (§4.1).
    };
  }

  // --- passthroughs so tools that needed connection.* keep working unchanged ---

  getVersion(): Promise<string> {
    return this.connection.getVersion();
  }

  ping(): Promise<boolean> {
    return this.connection.ping();
  }

  getPhotoshopInfo(): PhotoshopInfo | null {
    return this.connection.getPhotoshopInfo();
  }
}
