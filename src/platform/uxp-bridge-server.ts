/**
 * MCP-hosted UXP bridge server — companion Photoshop plugin polls for commands.
 * See docs/plans/2026-07-03-1149-photoshop-ai-features/ and uxp-plugin/.
 *
 * M3 (docs/design/transport-layer.md §6.7, §6.9) hardens delivery on the SAME
 * HTTP long-poll channel §7 keeps (no WebSocket):
 *   - Handshake file (§6.7): the server auto-increments its port on EADDRINUSE,
 *     but the plugin cannot guess the resulting port. On listen we write the real
 *     port to a well-known temp file the plugin reads each poll cycle, killing the
 *     silent-disconnect port drift. Fail-loud was rejected: refusing to increment
 *     would take the whole in-process MCP server (and backend A, the default path)
 *     down whenever a stale process holds 38452.
 *   - Lease-on-poll with requeue (§6.9): GET /poll used to `shift()` the command
 *     off the queue before the plugin acknowledged running it, so a plugin crash
 *     after fetch silently lost the command and the caller burned the full timeout.
 *     Now a poll LEASES the command (moves it to `leased`); the plugin's POST
 *     /result is the ack. A lease with no result older than LEASE_TTL_MS is
 *     requeued on the next poll so another poll cycle re-delivers it.
 */
import { createServer, type Server } from 'node:http';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '../utils/logger.js';

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

/** A command handed to the plugin on /poll, awaiting a /result ack (§6.9). */
interface LeasedCommand {
  command: UxpBridgeCommand;
  leasedAt: number;
}

const DEFAULT_PORT = Number.parseInt(process.env.PHOTOSHOP_UXP_BRIDGE_PORT ?? '38452', 10);

/**
 * Handshake-file path (§6.7). Under the user's HOME, not the OS temp dir: UXP's
 * manifest-v5 `os` shim has no `tmpdir()` (macOS temp dirs are per-user randomized
 * and unguessable without it — the v1.0 plugin crashed at load on exactly this),
 * while `os.homedir()` survives in UXP. Both sides resolve the same fixed path.
 */
const HANDSHAKE_FILE = join(homedir(), '.photoshop-mcp', 'bridge.json');

/**
 * How long a leased-but-unacked command may sit before it is requeued (§6.9). The
 * plugin loop is ~400ms and a batchPlay descriptor set is normally sub-second;
 * ~10s tolerates a slow neural filter or generative step without prematurely
 * re-delivering (which would double-apply). The per-command timeout in
 * `invokeUxpBridge` still bounds total wait; this only governs requeue-on-crash.
 */
const LEASE_TTL_MS = 10_000;

let server: Server | null = null;
let listenPort = DEFAULT_PORT;
const pendingCommands: UxpBridgeCommand[] = [];
const leased = new Map<string, LeasedCommand>();
const results = new Map<string, UxpBridgeResult>();

/**
 * Epoch-ms of the last time the UXP plugin hit `GET /poll`. Zero ⇒ never polled.
 * The in-process HTTP server always answers `/health`, which proves the SERVER is
 * up but says nothing about the plugin; a truthful "plugin connected" signal is a
 * recent poll (docs/design/transport-layer.md §4.1, Codex finding #3).
 */
let lastPollAt = 0;

export function getUxpBridgeLastPollAt(): number {
  return lastPollAt;
}

function json(res: import('node:http').ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

export function getUxpBridgePort(): number {
  return listenPort;
}

export function getUxpBridgeHandshakePath(): string {
  return HANDSHAKE_FILE;
}

/**
 * Write the handshake file so the plugin can discover the actual bound port (§6.7).
 * Best-effort: a write failure must not stop the server from serving — it only
 * degrades the plugin back to guessing the default port.
 */
function writeHandshakeFile(): void {
  try {
    mkdirSync(join(homedir(), '.photoshop-mcp'), { recursive: true });
    writeFileSync(
      HANDSHAKE_FILE,
      JSON.stringify({ port: listenPort, pid: process.pid, startedAt: Date.now() }),
      'utf8'
    );
  } catch (err) {
    logger.warn(`Could not write bridge handshake file ${HANDSHAKE_FILE}: ${String(err)}`);
  }
}

/**
 * Requeue any leased command whose ack (POST /result) never arrived within
 * LEASE_TTL_MS (§6.9). Called on every poll so a crashed-after-fetch command gets
 * re-delivered on a later poll instead of being lost. If a result did land, the
 * lease is simply dropped (the command is done).
 */
function reclaimExpiredLeases(now: number): void {
  for (const [id, entry] of leased) {
    if (results.has(id)) {
      leased.delete(id);
      continue;
    }
    if (now - entry.leasedAt >= LEASE_TTL_MS) {
      leased.delete(id);
      pendingCommands.unshift(entry.command);
      logger.warn(`Requeued unacked UXP command ${id} (${entry.command.action}) after lease expiry`);
    }
  }
}

export async function ensureUxpBridgeServer(): Promise<number> {
  if (server) return listenPort;

  return new Promise((resolve, reject) => {
    const s = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${listenPort}`);

      if (req.method === 'GET' && url.pathname === '/health') {
        json(res, 200, { ok: true, pending: pendingCommands.length, leased: leased.size });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/poll') {
        // A poll is the plugin's liveness heartbeat — record it even when the
        // queue is empty so isAvailable() reflects a connected-but-idle plugin.
        const now = Date.now();
        lastPollAt = now;
        // Requeue anything the plugin fetched but never acked (§6.9) before we
        // hand out the next command, so a lost command re-enters the queue.
        reclaimExpiredLeases(now);
        const cmd = pendingCommands.shift();
        if (!cmd) {
          res.writeHead(204);
          res.end();
          return;
        }
        // Lease instead of drop: the command is only truly consumed once the
        // plugin POSTs /result for its id (§6.9).
        leased.set(cmd.id, { command: cmd, leasedAt: now });
        json(res, 200, cmd);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/result') {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          try {
            const parsed = JSON.parse(body) as UxpBridgeResult;
            if (parsed?.id) {
              results.set(parsed.id, parsed);
              // The result IS the ack — the lease is satisfied (§6.9).
              leased.delete(parsed.id);
            }
            json(res, 200, { ok: true });
          } catch {
            json(res, 400, { ok: false, error: 'invalid_json' });
          }
        });
        return;
      }

      json(res, 404, { ok: false, error: 'not_found' });
    });

    s.listen(listenPort, '127.0.0.1', () => {
      server = s;
      const addr = s.address();
      if (addr && typeof addr === 'object') {
        listenPort = addr.port;
      }
      writeHandshakeFile();
      logger.info(`UXP bridge listening on 127.0.0.1:${listenPort} (handshake ${HANDSHAKE_FILE})`);
      resolve(listenPort);
    });

    s.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        listenPort += 1;
        s.listen(listenPort, '127.0.0.1');
        return;
      }
      reject(err);
    });
  });
}

export async function invokeUxpBridge(
  action: string,
  params: Record<string, unknown>,
  timeoutMs = 60_000
): Promise<UxpBridgeResult> {
  await ensureUxpBridgeServer();
  const id = `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  pendingCommands.push({ id, action, params });

  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const hit = results.get(id);
    if (hit) {
      results.delete(id);
      return hit;
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  // Timed out: stop tracking this command so a late poll cannot re-lease it and a
  // late result cannot pile up unread. The caller sees a normal timeout error.
  const idx = pendingCommands.findIndex((c) => c.id === id);
  if (idx >= 0) pendingCommands.splice(idx, 1);
  leased.delete(id);
  results.delete(id);
  return { id, ok: false, error: 'uxp_bridge_timeout' };
}

export async function shutdownUxpBridgeServer(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = null;
  try {
    rmSync(HANDSHAKE_FILE, { force: true });
  } catch {
    // Handshake file cleanup is best-effort.
  }
}
