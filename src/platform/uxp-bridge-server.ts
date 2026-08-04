/** Authenticated, bounded localhost bridge for the optional UXP plugin. */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '../utils/logger.js';
import { UxpBridgeSessionAuthority } from './uxp-bridge-session.js';
import { UxpReplayTombstones } from './uxp-replay-tombstones.js';

const logger = new Logger('UxpBridgeServer');

export interface UxpBridgeCommand {
  id: string;
  action: string;
  params: Record<string, unknown>;
}

export interface UxpBridgeResult {
  id: string;
  ok: boolean;
  data?: unknown;
  error?: string;
}

interface LeasedCommand {
  command: UxpBridgeCommand;
  leasedAt: number;
  deadline: number;
  bytes: number;
  ownerSession: string;
  uncertain: boolean;
}

interface PendingCommand {
  command: UxpBridgeCommand;
  deadline: number;
  bytes: number;
}

interface RetainedResult {
  result: UxpBridgeResult;
  bytes: number;
}

export const UXP_BRIDGE_PROTOCOL_VERSION = 4;
const DEFAULT_PORT = Number.parseInt(process.env.PHOTOSHOP_UXP_BRIDGE_PORT ?? '38452', 10);
const HANDSHAKE_FILE = join(homedir(), '.photoshop-mcp', 'bridge.json');
const MAX_EXECUTION_MS = 120_000;
const ACK_MARGIN_MS = 5_000;
const MAX_COMMANDS = 32;
const MAX_COMMAND_BYTES = 256 * 1024;
const MAX_PENDING_LEASED_BYTES = 1024 * 1024;
const MAX_RESULT_BYTES = 256 * 1024;
const MAX_RETAINED_RESULT_BYTES = 1024 * 1024;
const MAX_REPLAY_TOMBSTONES = 64;
const MAX_REPLAY_TOMBSTONE_BYTES = 16 * 1024;
const REPLAY_TOMBSTONE_TTL_MS = 5 * 60_000;

let server: Server | null = null;
let starting: Promise<number> | null = null;
let listenPort = DEFAULT_PORT;
let bridgeToken: string | null = null;
let bridgeExecutionUncertain = false;
let lastPollAt = 0;
let retainedResultBytes = 0;
const pendingCommands: PendingCommand[] = [];
const leased = new Map<string, LeasedCommand>();
const results = new Map<string, RetainedResult>();
const sessionAuthority = new UxpBridgeSessionAuthority();
const replayTombstones = new UxpReplayTombstones(
  MAX_REPLAY_TOMBSTONES,
  MAX_REPLAY_TOMBSTONE_BYTES,
  REPLAY_TOMBSTONE_TTL_MS
);

export function getUxpBridgeLastPollAt(): number {
  return lastPollAt;
}

export function getUxpBridgePort(): number {
  return listenPort;
}

export function getUxpBridgeHandshakePath(): string {
  return HANDSHAKE_FILE;
}

/** A timed-out UXP mutation is unsafe until bridge restart, plugin reload, and fresh handshake. */
export function isUxpBridgeExecutionUncertain(): boolean {
  return bridgeExecutionUncertain;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function bridgeCommandCount(): number {
  // Uncertain ids are terminal notices for callers, not live work. Counting
  // them would let an old plugin reload permanently exhaust a fresh session.
  return pendingCommands.length + leased.size + results.size;
}

function pendingAndLeasedBytes(): number {
  let bytes = 0;
  for (const entry of pendingCommands) bytes += entry.bytes;
  for (const entry of leased.values()) bytes += entry.bytes;
  return bytes;
}

function writeHandshakeFile(): void {
  try {
    mkdirSync(join(homedir(), '.photoshop-mcp'), { recursive: true, mode: 0o700 });
    writeFileSync(
      HANDSHAKE_FILE,
      JSON.stringify({
        protocolVersion: UXP_BRIDGE_PROTOCOL_VERSION,
        port: listenPort,
        token: bridgeToken,
        pid: process.pid,
        startedAt: Date.now(),
      }),
      { encoding: 'utf8', mode: 0o600 }
    );
    chmodSync(HANDSHAKE_FILE, 0o600);
  } catch (error) {
    logger.warn(`Could not write authenticated UXP handshake: ${String(error)}`);
  }
}

function isAuthenticated(req: IncomingMessage): boolean {
  const supplied = req.headers.authorization;
  if (!bridgeToken || typeof supplied !== 'string') return false;
  const expected = Buffer.from(`Bearer ${bridgeToken}`);
  const received = Buffer.from(supplied);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

/** Read, but do not establish or mutate, a presented plugin session id. */
function readPluginSession(req: IncomingMessage): string | null {
  const session = req.headers['x-photoshop-mcp-session'];
  if (typeof session !== 'string' || session.length < 16 || session.length > 256) return null;
  return session;
}

function markExecutionUncertain(id: string, reason: string): void {
  const entry = leased.get(id);
  if (entry) entry.uncertain = true;
  bridgeExecutionUncertain = true;
  logger.warn(`UXP command ${id} is execution-uncertain (${reason}); bridge is quarantined.`);
}

function expireLeases(now: number): void {
  for (const [id, entry] of leased) {
    if (now < entry.deadline || entry.uncertain) continue;
    // A Photoshop mutation may still be running. Keep the lease solely so a
    // later real settlement can receive its exact terminal acknowledgement;
    // never redeliver it and quarantine all subsequent commands meanwhile.
    markExecutionUncertain(id, 'lease_deadline_exceeded');
  }
}

async function readBoundedJson(
  req: IncomingMessage
): Promise<{ body?: UxpBridgeResult; error?: string }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let oversized = false;
    req.on('data', (chunk: Buffer) => {
      if (oversized) return;
      bytes += chunk.length;
      if (bytes > MAX_RESULT_BYTES) {
        oversized = true;
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', () => resolve({ error: 'invalid_body' }));
    req.on('end', () => {
      if (oversized) return resolve({ error: 'result_too_large' });
      try {
        resolve({
          body: JSON.parse(Buffer.concat(chunks, bytes).toString('utf8')) as UxpBridgeResult,
        });
      } catch {
        resolve({ error: 'invalid_json' });
      }
    });
  });
}

function removeResult(id: string): UxpBridgeResult | undefined {
  const entry = results.get(id);
  if (!entry) return undefined;
  results.delete(id);
  retainedResultBytes -= entry.bytes;
  return entry.result;
}

function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${listenPort}`);
  if (req.method === 'GET' && url.pathname === '/health') {
    json(res, 200, {
      ok: true,
      commands: bridgeCommandCount(),
      retainedResultBytes,
      executionUncertain: bridgeExecutionUncertain,
    });
    return;
  }
  if (!isAuthenticated(req)) {
    json(res, 401, { ok: false, error: 'unauthorized' });
    return;
  }
  const requestedSession = readPluginSession(req);
  if (!requestedSession) {
    json(res, 400, { ok: false, error: 'missing_or_invalid_plugin_session' });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/handshake') {
    if (!sessionAuthority.establishInitial(requestedSession, bridgeExecutionUncertain)) {
      json(res, 409, { ok: false, error: 'bridge_session_already_owned_or_quarantined' });
      return;
    }
    json(res, 200, {
      ok: true,
      sessionId: requestedSession,
      protocolVersion: UXP_BRIDGE_PROTOCOL_VERSION,
    });
    return;
  }
  if (!sessionAuthority.isCurrent(requestedSession)) {
    // A superseded, late, or never-handshaken session must have zero effects:
    // no liveness update, lease mutation, or quarantine reset.
    json(res, 409, { ok: false, error: 'stale_or_unowned_plugin_session' });
    return;
  }
  const session = requestedSession;
  if (req.method === 'GET' && url.pathname === '/poll') {
    const now = Date.now();
    lastPollAt = now;
    expireLeases(now);
    if (bridgeExecutionUncertain) {
      json(res, 423, { ok: false, error: 'uxp_bridge_session_quarantined' });
      return;
    }
    let pending = pendingCommands.shift();
    while (pending && now >= pending.deadline) {
      // Not dispatched; the caller's single command deadline will return a
      // normal timeout, and this stale entry never reaches Photoshop.
      pending = pendingCommands.shift();
    }
    if (!pending) {
      res.writeHead(204);
      res.end();
      return;
    }
    leased.set(pending.command.id, {
      command: pending.command,
      leasedAt: now,
      deadline: pending.deadline,
      bytes: pending.bytes,
      ownerSession: session,
      uncertain: false,
    });
    json(res, 200, pending.command);
    return;
  }
  if (req.method === 'POST' && url.pathname === '/uncertain') {
    void readBoundedJson(req).then(({ body, error }) => {
      const lease = body?.id ? leased.get(body.id) : undefined;
      if (error || !body?.id || !lease || lease.ownerSession !== session) {
        json(res, 409, { ok: false, error: error ?? 'unknown_or_unleased_command' });
        return;
      }
      markExecutionUncertain(body.id, 'plugin_watchdog_expired');
      json(res, 200, { ok: true, id: body.id, protocolVersion: UXP_BRIDGE_PROTOCOL_VERSION });
    });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/result') {
    void readBoundedJson(req).then(({ body, error }) => {
      if (error) {
        json(res, error === 'result_too_large' ? 413 : 400, { ok: false, error });
        return;
      }
      const lease = body?.id ? leased.get(body.id) : undefined;
      if (!body?.id || !lease || lease.ownerSession !== session || results.has(body.id)) {
        json(res, 409, {
          ok: false,
          error:
            body?.id && replayTombstones.has(body.id)
              ? 'replayed_terminal_result'
              : 'unknown_or_unleased_command',
        });
        return;
      }
      if (
        typeof body.ok !== 'boolean' ||
        (body.error !== undefined && typeof body.error !== 'string')
      ) {
        json(res, 400, { ok: false, error: 'invalid_result' });
        return;
      }
      const bytes = Buffer.byteLength(JSON.stringify(body));
      if (bytes > MAX_RESULT_BYTES || retainedResultBytes + bytes > MAX_RETAINED_RESULT_BYTES) {
        json(res, 413, { ok: false, error: 'result_capacity_exhausted' });
        return;
      }
      leased.delete(body.id);
      if (lease.uncertain) {
        // The caller was already told execution is uncertain. The plugin may
        // still acknowledge its real late settlement, but it cannot turn the
        // session back into a dispatchable state.
        replayTombstones.add(body.id);
        json(res, 200, { ok: true, id: body.id, protocolVersion: UXP_BRIDGE_PROTOCOL_VERSION });
        return;
      }
      results.set(body.id, { result: body, bytes });
      retainedResultBytes += bytes;
      json(res, 200, { ok: true, id: body.id, protocolVersion: UXP_BRIDGE_PROTOCOL_VERSION });
    });
    return;
  }
  json(res, 404, { ok: false, error: 'not_found' });
}

export async function ensureUxpBridgeServer(): Promise<number> {
  if (server) return listenPort;
  if (starting) return starting;
  bridgeToken = randomBytes(32).toString('base64url');
  starting = new Promise<number>((resolve, reject) => {
    const candidate = createServer(handleRequest);
    const fail = (error: Error) => {
      bridgeToken = null;
      reject(error);
    };
    candidate.once('error', fail);
    candidate.listen(listenPort, '127.0.0.1', () => {
      candidate.removeListener('error', fail);
      server = candidate;
      const address = candidate.address();
      if (address && typeof address === 'object') listenPort = address.port;
      writeHandshakeFile();
      logger.info(`Authenticated UXP bridge listening on 127.0.0.1:${listenPort}`);
      resolve(listenPort);
    });
  });
  try {
    return await starting;
  } finally {
    starting = null;
  }
}

export async function invokeUxpBridge(
  action: string,
  params: Record<string, unknown>,
  timeoutMs = 60_000
): Promise<UxpBridgeResult> {
  await ensureUxpBridgeServer();
  if (bridgeExecutionUncertain) {
    return { id: '', ok: false, error: 'uxp_bridge_session_quarantined' };
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_EXECUTION_MS) {
    return { id: '', ok: false, error: 'invalid_timeout' };
  }
  const id = `cmd-${randomBytes(16).toString('hex')}`;
  const command: UxpBridgeCommand = { id, action, params };
  let serialized: string;
  try {
    serialized = JSON.stringify(command);
  } catch {
    return { id, ok: false, error: 'uxp_bridge_command_not_serializable' };
  }
  const bytes = Buffer.byteLength(serialized, 'utf8');
  if (bytes > MAX_COMMAND_BYTES) {
    return { id: '', ok: false, error: 'uxp_bridge_command_too_large' };
  }
  if (
    bridgeCommandCount() >= MAX_COMMANDS ||
    pendingAndLeasedBytes() + bytes > MAX_PENDING_LEASED_BYTES
  ) {
    return { id: '', ok: false, error: 'uxp_bridge_overloaded' };
  }
  // The one command deadline covers its maximum 120s Photoshop execution plus
  // a bounded authenticated acknowledgement window. No lease has an unrelated
  // short TTL that can reject a legitimate neural filter.
  const deadline = Date.now() + timeoutMs + ACK_MARGIN_MS;
  pendingCommands.push({ command, deadline, bytes });
  while (Date.now() < deadline) {
    const result = removeResult(id);
    if (result) return result;
    if (leased.get(id)?.uncertain || replayTombstones.has(id)) {
      return { id, ok: false, error: 'uxp_bridge_execution_uncertain' };
    }
    if (bridgeExecutionUncertain) {
      const pendingIndex = pendingCommands.findIndex((entry) => entry.command.id === id);
      if (pendingIndex >= 0) pendingCommands.splice(pendingIndex, 1);
      return { id, ok: false, error: 'uxp_bridge_session_quarantined' };
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(250, deadline - Date.now())));
  }
  const pendingIndex = pendingCommands.findIndex((entry) => entry.command.id === id);
  if (pendingIndex >= 0) pendingCommands.splice(pendingIndex, 1);
  if (leased.has(id)) {
    markExecutionUncertain(id, 'caller_deadline_exceeded');
    return { id, ok: false, error: 'uxp_bridge_execution_uncertain' };
  }
  if (replayTombstones.has(id)) {
    return { id, ok: false, error: 'uxp_bridge_execution_uncertain' };
  }
  removeResult(id);
  return { id, ok: false, error: 'uxp_bridge_timeout' };
}

export async function shutdownUxpBridgeServer(): Promise<void> {
  if (starting) await starting.catch(() => undefined);
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = null;
  pendingCommands.length = 0;
  leased.clear();
  results.clear();
  replayTombstones.clear();
  retainedResultBytes = 0;
  bridgeToken = null;
  sessionAuthority.clearForProcessShutdown();
  bridgeExecutionUncertain = false;
  lastPollAt = 0;
  try {
    rmSync(HANDSHAKE_FILE, { force: true });
  } catch {
    // Best-effort cleanup only.
  }
}
