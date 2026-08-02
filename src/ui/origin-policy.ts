import { isIP } from 'node:net';

const LOOPBACK_HOSTNAMES = new Set(['localhost', '::1']);

function normalizeHostname(hostname: string): string {
  const lower = hostname.trim().toLowerCase();
  return lower.startsWith('[') && lower.endsWith(']') ? lower.slice(1, -1) : lower;
}

/** Return whether a host names a loopback interface without doing DNS lookup. */
export function isLoopbackHost(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  if (LOOPBACK_HOSTNAMES.has(normalized)) return true;

  if (isIP(normalized) === 4) {
    const octets = normalized.split('.').map(Number);
    return octets[0] === 127;
  }

  return false;
}

/**
 * Validate the explicitly configured Vite development origin.
 *
 * The returned value is byte-for-byte identical to the input so callers can
 * use exact string matching at the request boundary. URL normalization is
 * intentionally treated as invalid input rather than silently accepted.
 */
export function validateDevOrigin(origin: string, backendHost: string): string {
  if (!isLoopbackHost(backendHost)) {
    throw new Error('--dev-origin requires a loopback backend host');
  }
  if (typeof origin !== 'string' || origin.length === 0) {
    throw new Error('--dev-origin must be a non-empty origin');
  }

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new Error('--dev-origin must be a canonical http:// loopback origin');
  }

  const port = Number(parsed.port);
  const isCanonical = parsed.origin === origin;
  const isValidPort = Number.isInteger(port) && port >= 1 && port <= 65535;
  if (
    parsed.protocol !== 'http:' ||
    !isLoopbackHost(parsed.hostname) ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.port === '' ||
    !isValidPort ||
    parsed.pathname !== '/' ||
    parsed.search !== '' ||
    parsed.hash !== '' ||
    !isCanonical
  ) {
    throw new Error(
      '--dev-origin must be exactly one canonical http:// loopback origin with an explicit port'
    );
  }

  return origin;
}

/** Preserve the UI server's existing loopback-origin behavior. */
export function isLoopbackOrigin(origin: string, port: number): boolean {
  try {
    const parsed = new URL(origin);
    return isLoopbackHost(parsed.hostname) && (parsed.port === '' || parsed.port === String(port));
  } catch {
    return false;
  }
}
