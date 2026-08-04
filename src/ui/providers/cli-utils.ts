import { access } from 'node:fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import { statSync } from 'node:fs';
import { isAbsolute, relative, resolve as resolvePath } from 'node:path';

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  outputLimitExceeded: boolean;
  timedOut: boolean;
}

/** Combined stdout/stderr capture cap for operator-selected CLI probes. */
export const MAX_CLI_OUTPUT_BYTES = 64 * 1024;
const FORCE_KILL_GRACE_MS = 100;
const FINALIZE_GRACE_MS = 100;
const TREE_KILL_COMMAND_TIMEOUT_MS = 100;

export interface WindowsTreeTerminationOps {
  runTreeKill(force: boolean): Promise<boolean>;
  wait(ms: number): Promise<void>;
  killLeader(): void;
}

/**
 * Preserve the leader through both taskkill tree attempts. A failed graceful
 * attempt is not permission to target the leader: `/F /T` still needs that PID
 * to locate every descendant. Direct leader termination is a last resort only.
 */
export async function runWindowsTreeTerminationSequence(
  operations: WindowsTreeTerminationOps
): Promise<void> {
  await operations.runTreeKill(false);
  await operations.wait(FORCE_KILL_GRACE_MS);
  if (!(await operations.runTreeKill(true))) operations.killLeader();
}

export async function resolveCliBinary(
  binaryName: string,
  customPath?: string
): Promise<string | null> {
  if (customPath) {
    try {
      await access(customPath);
      return customPath;
    } catch {
      return null;
    }
  }
  const which = await runCommand('which', [binaryName], { timeoutMs: 5_000 });
  const resolved = which.stdout.trim();
  return which.exitCode === 0 && resolved ? resolved : null;
}

export function runCommand(
  command: string,
  args: string[],
  opts: {
    timeoutMs?: number;
    env?: Record<string, string>;
    cwd?: string;
    maxOutputBytes?: number;
  } = {}
): Promise<CommandResult> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const requestedMaxOutputBytes = opts.maxOutputBytes;
  const maxOutputBytes =
    typeof requestedMaxOutputBytes === 'number' &&
    Number.isSafeInteger(requestedMaxOutputBytes) &&
    requestedMaxOutputBytes > 0
      ? requestedMaxOutputBytes
      : MAX_CLI_OUTPUT_BYTES;
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(command, args, {
        env: { ...process.env, ...opts.env },
        cwd: opts.cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        // POSIX creates a new session/process group with the child as leader,
        // allowing timeout cleanup to signal every inherited pipe holder.
        detached: process.platform !== 'win32',
      });
    } catch {
      resolve({
        exitCode: 1,
        stdout: '',
        stderr: '',
        outputLimitExceeded: false,
        timedOut: false,
      });
      return;
    }

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let capturedBytes = 0;
    let outputLimitExceeded = false;
    let timedOut = false;
    let completed = false;
    let terminationStarted = false;
    let finalizeTimer: NodeJS.Timeout | undefined;
    let closeCode: number | null = null;

    const complete = (exitCode: number) => {
      if (completed) return;
      completed = true;
      clearTimeout(timeout);
      if (finalizeTimer) clearTimeout(finalizeTimer);
      resolve({
        exitCode,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        outputLimitExceeded,
        timedOut,
      });
    };

    const directKillLeader = (signal: NodeJS.Signals) => {
      if (!child.pid) return;
      try {
        child.kill(signal);
      } catch {
        // It may have exited between the PID check and signal delivery.
      }
    };

    const getWindowsTaskkillPath = (): string | null => {
      const systemRoot = process.env.SystemRoot;
      if (!systemRoot || !isAbsolute(systemRoot)) return null;
      const taskkillPath = resolvePath(systemRoot, 'System32', 'taskkill.exe');
      if (relative(systemRoot, taskkillPath).toLowerCase() !== 'system32\\taskkill.exe') {
        return null;
      }
      try {
        return statSync(taskkillPath).isFile() ? taskkillPath : null;
      } catch {
        return null;
      }
    };

    const runWindowsTaskkill = (force: boolean): Promise<boolean> => {
      const taskkillPath = getWindowsTaskkillPath();
      if (!taskkillPath || !child.pid) return Promise.resolve(false);
      return new Promise((resolveTaskkill) => {
        let settled = false;
        let taskkill: ChildProcess;
        let timer: NodeJS.Timeout | undefined;
        const settle = (ok: boolean) => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          resolveTaskkill(ok);
        };
        try {
          // The absolute, validated system executable receives PID-only argv;
          // no command string or PATH lookup can alter the tree target.
          taskkill = spawn(
            taskkillPath,
            ['/pid', String(child.pid), '/t', ...(force ? ['/f'] : [])],
            { stdio: 'ignore', windowsHide: true }
          );
        } catch {
          settle(false);
          return;
        }
        timer = setTimeout(() => {
          try {
            taskkill.kill('SIGKILL');
          } catch {
            // The helper may have exited during its own bounded timeout.
          }
          settle(false);
        }, TREE_KILL_COMMAND_TIMEOUT_MS);
        taskkill.once('error', () => settle(false));
        taskkill.once('close', (code) => settle(code === 0));
      });
    };

    const signalPosixProcessGroup = (signal: NodeJS.Signals): void => {
      if (!child.pid) return;
      try {
        process.kill(-child.pid, signal);
        return;
      } catch {
        // The group may already have exited; the direct child fallback is
        // still worthwhile when a platform does not expose process groups.
      }
      directKillLeader(signal);
    };

    const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

    const terminate = (reason: 'timeout' | 'output_limit') => {
      if (terminationStarted) return;
      terminationStarted = true;
      timedOut ||= reason === 'timeout';
      // Closing our ends prevents a surviving descendant from holding the
      // ChildProcess close event open while the group/tree receives TERM/KILL.
      child.stdout?.destroy();
      child.stderr?.destroy();
      void (async () => {
        if (process.platform === 'win32') {
          await runWindowsTreeTerminationSequence({
            runTreeKill: runWindowsTaskkill,
            wait,
            killLeader: () => directKillLeader('SIGKILL'),
          });
        } else {
          signalPosixProcessGroup('SIGTERM');
          await wait(FORCE_KILL_GRACE_MS);
          signalPosixProcessGroup('SIGKILL');
        }
        finalizeTimer = setTimeout(() => complete(closeCode ?? 1), FINALIZE_GRACE_MS);
      })();
    };

    const appendOutput = (target: Buffer[], chunk: Buffer) => {
      if (outputLimitExceeded) return;
      const remaining = maxOutputBytes - capturedBytes;
      if (remaining > 0) {
        const captured = chunk.subarray(0, remaining);
        target.push(captured);
        capturedBytes += captured.length;
      }
      if (chunk.length > remaining) {
        // Do not continue draining an untrusted process into Node memory. Close
        // both pipes, then terminate the complete process group/tree.
        outputLimitExceeded = true;
        terminate('output_limit');
      }
    };

    child.stdout?.on('data', (chunk: Buffer) => appendOutput(stdout, chunk));
    child.stderr?.on('data', (chunk: Buffer) => appendOutput(stderr, chunk));

    const timeout = setTimeout(() => terminate('timeout'), timeoutMs);

    child.on('close', (code) => {
      closeCode = code;
      // A group leader can exit after TERM while a descendant still owns an
      // inherited pipe. Preserve the scheduled group KILL and final deadline.
      if (!terminationStarted) complete(code ?? 1);
    });
    child.on('error', () => {
      if (!terminationStarted) complete(1);
    });
  });
}
