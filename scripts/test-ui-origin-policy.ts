import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = fileURLToPath(new URL('.', import.meta.url));
const rootDir = join(scriptDir, '..');
const serverPath = join(rootDir, 'src', 'ui', 'server.ts');
const cliPath = join(rootDir, 'src', 'ui', 'cli.ts');
const vitePath = join(rootDir, 'web', 'vite.config.ts');
const packagePath = join(rootDir, 'package.json');

const failures: string[] = [];

function check(name: string, assertion: () => void): void {
  try {
    assertion();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`${name}: ${message}`);
  }
}

async function checkAsync(name: string, assertion: () => Promise<void>): Promise<void> {
  try {
    await assertion();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`${name}: ${message}`);
  }
}

const [serverSource, cliSource, viteSource, packageSource] = await Promise.all([
  readFile(serverPath, 'utf8'),
  readFile(cliPath, 'utf8'),
  readFile(vitePath, 'utf8'),
  readFile(packagePath, 'utf8'),
]);
const packageJson = JSON.parse(packageSource) as {
  scripts?: Record<string, string>;
};

check('Vite must preserve the browser Origin', () => {
  assert.doesNotMatch(viteSource, /proxyReq|setHeader\(['"]origin['"]/);
});
check('Vite proxy must not change the request origin', () => {
  assert.match(viteSource, /changeOrigin:\s*false/);
});
check('Vite must bind its development server to loopback', () => {
  assert.match(viteSource, /host:\s*['"]127\.0\.0\.1['"]/);
  assert.match(viteSource, /port:\s*5173/);
});
check('UI CLI must expose --dev-origin', () => {
  assert.match(cliSource, /--dev-origin/);
  assert.match(cliSource, /devOrigin/);
});
check('UI CLI must pass --dev-origin to the backend', () => {
  assert.match(cliSource, /devOrigin:\s*flags\.devOrigin/);
});
check('origin authorization must not depend on NODE_ENV', () => {
  assert.doesNotMatch(serverSource, /NODE_ENV/);
});
check('development server command and Vite config must agree', () => {
  assert.equal(
    packageJson.scripts?.['dev:ui:server'],
    'tsx watch src/ui/cli.ts --port 5174 --dev-origin http://127.0.0.1:5173 --no-open'
  );
});

let originPolicy: typeof import('../src/ui/origin-policy.js') | undefined;
await checkAsync('origin policy module must load', async () => {
  originPolicy = await import('../src/ui/origin-policy.js');
});

if (originPolicy) {
  const { validateDevOrigin } = originPolicy;
  for (const origin of [
    'http://127.0.0.1:5173',
    'http://127.0.0.2:5173',
    'http://localhost:5173',
    'http://[::1]:5173',
  ]) {
    check(`valid dev origin ${origin}`, () => {
      assert.equal(validateDevOrigin(origin, '127.0.0.1'), origin);
    });
  }
  for (const origin of [
    'https://127.0.0.1:5173',
    'http://127.0.0.1',
    'http://127.0.0.1:0',
    'http://127.0.0.1:65536',
    'http://127.0.0.1:05173',
    'http://127.0.0.1:5173/',
    'http://127.0.0.1:5173/path',
    'http://127.0.0.1:5173?query=1',
    'http://127.0.0.1:5173#fragment',
    'http://user:pass@127.0.0.1:5173',
    'http://example.test:5173',
    'HTTP://127.0.0.1:5173',
  ]) {
    check(`invalid dev origin ${origin}`, () => {
      assert.throws(() => validateDevOrigin(origin, '127.0.0.1'));
    });
  }
  for (const backendHost of ['0.0.0.0', '192.168.1.10', 'example.test']) {
    check(`non-loopback backend host ${backendHost} rejects dev origin`, () => {
      assert.throws(() => validateDevOrigin('http://127.0.0.1:5173', backendHost));
    });
  }
}

let serverModule: typeof import('../src/ui/server.js') | undefined;
await checkAsync('UI server origin guard must load', async () => {
  serverModule = await import('../src/ui/server.js');
});

if (serverModule) {
  const { createUiOriginGuard } = serverModule;
  const { Hono } = await import('hono');

  check('origin guard rejects a dev origin on non-loopback bind', () => {
    assert.throws(() =>
      createUiOriginGuard({
        host: '192.168.1.10',
        port: 5174,
        devOrigin: 'http://127.0.0.1:5173',
      })
    );
  });
  await checkAsync('unconfigured backend rejects the development origin', async () => {
    const app = new Hono();
    let handlerCalls = 0;
    app.use(
      '/api/*',
      createUiOriginGuard({ host: '127.0.0.1', port: 5174 })
    );
    app.get('/api/probe', () => {
      handlerCalls += 1;
      return new Response('handled');
    });
    const response = await app.request('http://127.0.0.1:5174/api/probe', {
      headers: { Origin: 'http://127.0.0.1:5173' },
    });
    assert.equal(response.status, 403);
    assert.equal(handlerCalls, 0);
  });
  await checkAsync('configured development origin rejects near-match exactly', async () => {
    const app = new Hono();
    let handlerCalls = 0;
    app.use(
      '/api/*',
      createUiOriginGuard({
        host: '127.0.0.1',
        port: 5174,
        devOrigin: 'http://127.0.0.1:5173',
      })
    );
    app.get('/api/probe', () => {
      handlerCalls += 1;
      return new Response('handled');
    });
    const response = await app.request('http://127.0.0.1:5174/api/probe', {
      headers: { Origin: 'http://127.0.0.1:5173.evil' },
    });
    assert.equal(response.status, 403);
    assert.equal(handlerCalls, 0);
  });
  await checkAsync('configured development origin reaches the handler exactly', async () => {
    const app = new Hono();
    let handlerCalls = 0;
    app.use(
      '/api/*',
      createUiOriginGuard({
        host: '127.0.0.1',
        port: 5174,
        devOrigin: 'http://127.0.0.1:5173',
      })
    );
    app.get('/api/probe', () => {
      handlerCalls += 1;
      return new Response('handled');
    });
    const response = await app.request('http://127.0.0.1:5174/api/probe', {
      headers: { Origin: 'http://127.0.0.1:5173' },
    });
    assert.equal(response.status, 200);
    assert.equal(handlerCalls, 1);
  });
  await checkAsync('missing Origin remains accepted for compatibility', async () => {
    const app = new Hono();
    let handlerCalls = 0;
    app.use(
      '/api/*',
      createUiOriginGuard({
        host: '127.0.0.1',
        port: 5174,
        devOrigin: 'http://127.0.0.1:5173',
      })
    );
    app.get('/api/probe', () => {
      handlerCalls += 1;
      return new Response('handled');
    });
    const response = await app.request('http://127.0.0.1:5174/api/probe');
    assert.equal(response.status, 200);
    assert.equal(handlerCalls, 1);
  });
}

if (failures.length > 0) {
  process.stderr.write(
    `UI origin policy regression failures (${failures.length}):\n${failures
      .map((failure) => `- ${failure}`)
      .join('\n')}\n`
  );
  process.exitCode = 1;
} else {
  console.log('UI origin policy regression: all assertions passed');
}
