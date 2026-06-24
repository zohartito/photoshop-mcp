let activeClientName: string | undefined;
let activeClientVersion: string | undefined;

export function setActiveMcpClient(client: { name: string; version: string } | undefined): void {
  activeClientName = client?.name ?? 'unknown';
  activeClientVersion = client?.version ?? 'unknown';
}

export function clearActiveMcpClient(): void {
  activeClientName = undefined;
  activeClientVersion = undefined;
}

export function getActiveMcpClient(): { name?: string; version?: string } {
  return {
    ...(activeClientName ? { name: activeClientName } : {}),
    ...(activeClientVersion ? { version: activeClientVersion } : {}),
  };
}

export function hasActiveMcpClient(): boolean {
  return activeClientName !== undefined;
}
