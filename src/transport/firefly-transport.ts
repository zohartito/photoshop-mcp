/**
 * Backend C — Firefly Services cloud transport (STUB, design seam only).
 *
 * transport-layer.md §8: "'Headless' means agentless, not Photoshop-less" — the
 * ExtendScript and UXP backends both require the Photoshop GUI to be running,
 * because macOS Photoshop has no true headless mode. The one path to *true*
 * headless (no local PS at all) is Adobe's Firefly Services / Photoshop API in
 * the cloud, which is enterprise-gated. The `TransportId` string union already
 * reserves `'firefly'` for exactly this hypothetical backend.
 *
 * This file is the clean seam that keeps that option open WITHOUT building the
 * cloud calls:
 *   - It implements `PhotoshopTransport` so the router could hold a third
 *     backend with zero interface churn.
 *   - Every method that would hit the network throws `FireflyNotImplementedError`
 *     with a pointer to what a real implementation must do.
 *   - `isAvailable()` is honest: absent credentials/opt-in it returns false, so
 *     `auto` routing never selects it and existing behavior is untouched.
 *
 * What a real backend C would own (left as a checklist, not code):
 *   1. Auth: IMS server-to-server token (client id/secret) exchange + refresh.
 *   2. Command mapping: translate the neutral PsCommand set to Photoshop API
 *      "actionJSON" / document operations (a different payload dialect again —
 *      the same normalization discipline the UXP backend owes, §4.2).
 *   3. Asset IO: inputs and outputs are cloud storage refs (presigned URLs),
 *      not local file paths — so batch mode's open/export/close semantics map to
 *      upload -> job -> download rather than app.open/doc.saveAs/doc.close.
 *   4. Async jobs: the API is job-poll based; runOperation() would submit a
 *      manifest and poll to completion (its natural "one operation" boundary).
 *   5. Capability reporting: the cloud feature set differs from desktop; a real
 *      capabilities() would advertise only what the API supports.
 *
 * Enabling it later is deliberately gated behind an explicit opt-in env so it
 * cannot surprise a desktop user: PHOTOSHOP_MCP_FIREFLY=1 (checked here) plus
 * credentials. Until implemented, that opt-in only changes error text, never
 * behavior.
 */
import type {
  PhotoshopTransport,
  PsCommand,
  TransportCapabilities,
} from './types.js';

export class FireflyNotImplementedError extends Error {
  constructor(what: string) {
    super(
      `Firefly cloud backend (C) is not implemented: ${what}. ` +
        `It is the true-headless seam reserved by transport-layer.md §8 (Firefly Services / ` +
        `Photoshop API, enterprise-gated). Use the extendscript or uxp backend, which require ` +
        `the Photoshop GUI to be running.`
    );
    this.name = 'FireflyNotImplementedError';
  }
}

/** True only when the operator has explicitly opted in AND supplied credentials. */
export function isFireflyOptedIn(): boolean {
  const flag = (process.env.PHOTOSHOP_MCP_FIREFLY ?? '').trim();
  const optedIn = flag === '1' || flag.toLowerCase() === 'true';
  const hasCreds =
    !!process.env.FIREFLY_CLIENT_ID?.trim() && !!process.env.FIREFLY_CLIENT_SECRET?.trim();
  return optedIn && hasCreds;
}

export class FireflyTransport implements PhotoshopTransport {
  readonly id = 'firefly' as const;

  /**
   * Honest liveness: false unless opted in with credentials. Even when opted in
   * this returns false today because the client is unbuilt — so `auto` routing
   * never picks backend C and desktop behavior is unchanged. Flip to a real
   * token/ping check when the cloud client lands.
   */
  async isAvailable(): Promise<boolean> {
    return false;
  }

  async capabilities(): Promise<TransportCapabilities> {
    return { id: this.id, available: false, commands: [] };
  }

  async run(command: PsCommand): Promise<unknown> {
    throw new FireflyNotImplementedError(`run(${command.name})`);
  }

  async runOperation(name: string, _commands: PsCommand[]): Promise<unknown> {
    throw new FireflyNotImplementedError(`runOperation(${name})`);
  }
}
