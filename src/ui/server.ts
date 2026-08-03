/**
 * Compatibility boundary for the retired standalone browser UI.
 *
 * Do not reintroduce a listener here without an authenticated pairing and TLS
 * design. The former server exposed credential and Photoshop-operation routes
 * to unauthenticated browser clients.
 */

export const UI_SECURITY_DISABLED_MESSAGE =
  'The standalone browser UI is security-disabled until authenticated pairing and TLS are implemented.';

/** Retained so callers of the former startup API continue to type-check. */
export interface UIServerOptions {
  port: number;
  host: string;
  devOrigin?: string;
}

/** Retained for compatibility; no server instance can now be created. */
export interface UIServer {
  url: string;
  close(): Promise<void>;
}

/**
 * Permanently fail closed until the standalone browser UI has authenticated
 * pairing and TLS. Options are intentionally ignored: no host, origin, flag,
 * or environment setting may turn this compatibility tombstone back on.
 */
export async function startUIServer(_options: UIServerOptions): Promise<UIServer> {
  throw new Error(UI_SECURITY_DISABLED_MESSAGE);
}
