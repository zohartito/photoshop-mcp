import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
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
  opts: { timeoutMs?: number; env?: Record<string, string>; cwd?: string } = {}
): Promise<CommandResult> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...opts.env },
      cwd: opts.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });

    child.on('error', () => {
      clearTimeout(timer);
      resolve({ exitCode: 1, stdout, stderr });
    });
  });
}
