/** Run the P3 TypeScript test on the declared Node 20 floor without installs. */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(root);
const testFile = join(root, 'test-p3-security.ts');
const helperFile = join(projectRoot, 'src/ui/providers/cli-utils.ts');
const testEnv = { ...process.env, P3_SECURITY_PROJECT_ROOT: projectRoot };

function candidateNodeModules() {
  const paths = [join(projectRoot, 'node_modules')];
  try {
    const worktrees = execFileSync('git', ['worktree', 'list', '--porcelain'], {
      cwd: projectRoot,
      encoding: 'utf8',
    });
    for (const line of worktrees.split('\n')) {
      if (line.startsWith('worktree ')) {
        paths.push(join(line.slice('worktree '.length), 'node_modules'));
      }
    }
  } catch {
    // A normal checkout still has the local project node_modules candidate.
  }
  return [...new Set(paths)].filter((path) => existsSync(path));
}

function resolveJavaScriptTool(packageName, binName) {
  for (const nodeModules of candidateNodeModules()) {
    const packageRoot = join(nodeModules, packageName);
    const packageJsonPath = join(packageRoot, 'package.json');
    if (!existsSync(packageJsonPath)) continue;
    try {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
      const bin =
        typeof packageJson.bin === 'string' ? packageJson.bin : packageJson.bin?.[binName];
      if (typeof bin !== 'string') continue;
      const entrypoint = resolve(packageRoot, bin);
      const entryRelativePath = relative(packageRoot, entrypoint);
      if (
        entryRelativePath.startsWith('..') ||
        entryRelativePath === '' ||
        !existsSync(entrypoint)
      ) {
        continue;
      }
      return { entrypoint, nodeModules };
    } catch {
      // Try the next installed project toolchain candidate.
    }
  }
  return null;
}

const tsx = process.env.P3_SECURITY_FORCE_TSC === '1' ? null : resolveJavaScriptTool('tsx', 'tsx');
if (tsx) {
  execFileSync(process.execPath, [tsx.entrypoint, testFile], {
    cwd: projectRoot,
    env: { ...testEnv, P3_SECURITY_TOOL_MODE: 'tsx' },
    stdio: 'inherit',
  });
  process.exit(0);
}

const tsc = resolveJavaScriptTool('typescript', 'tsc');
if (!tsc) {
  throw new Error('P3 security test requires the declared local tsx or TypeScript compiler.');
}

const outputDir = mkdtempSync(join(tmpdir(), 'photoshop-mcp-p3-security-'));
const typeRoots = join(tsc.nodeModules, '@types');
try {
  writeFileSync(join(outputDir, 'package.json'), '{"type":"module"}\n', { mode: 0o600 });
  execFileSync(
    process.execPath,
    [
      tsc.entrypoint,
      testFile,
      helperFile,
      '--target',
      'ES2022',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      '--rootDir',
      projectRoot,
      '--outDir',
      outputDir,
      '--types',
      'node',
      '--typeRoots',
      typeRoots,
      '--strict',
      '--skipLibCheck',
    ],
    { cwd: projectRoot, env: { ...testEnv, P3_SECURITY_TOOL_MODE: 'tsc' }, stdio: 'inherit' }
  );
  execFileSync(process.execPath, [join(outputDir, 'scripts/test-p3-security.js')], {
    cwd: projectRoot,
    env: { ...testEnv, P3_SECURITY_TOOL_MODE: 'tsc' },
    stdio: 'inherit',
  });
} finally {
  rmSync(outputDir, { recursive: true, force: true });
}
