/**
 * Owns the one authenticated UXP plugin session for a bridge process.
 *
 * A session is established only through the dedicated initial handshake. A
 * retry from the exact owner is an idempotent acknowledgement only; it cannot
 * alter quarantine or any other bridge state. A late or reloaded plugin cannot
 * take ownership. Recovery requires bridge-process restart followed by plugin
 * reload and a fresh handshake (or a future explicit local-admin reset).
 */
export class UxpBridgeSessionAuthority {
  private owner: string | null = null;

  establishInitial(session: string, executionUncertain: boolean): boolean {
    // The plugin may retry after losing the handshake response. That exact
    // retry is safe as a no-op, including while the bridge is quarantined.
    if (this.owner === session) return true;
    if (this.owner !== null || executionUncertain) return false;
    this.owner = session;
    return true;
  }

  isCurrent(session: string | null): boolean {
    return session !== null && session === this.owner;
  }

  clearForProcessShutdown(): void {
    this.owner = null;
  }
}
