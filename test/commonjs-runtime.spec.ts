import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

test('Firebase auth loads and JWKS keys verify signatures without require(ESM)', () => {
  const child = spawnSync(
    process.execPath,
    ['--no-experimental-require-module', resolve(__dirname, 'runtime-smoke.cjs')],
    { cwd: resolve(__dirname, '..'), encoding: 'utf8', timeout: 15000 },
  );
  expect({ status: child.status, stderr: child.stderr, error: child.error?.message }).toEqual({
    status: 0,
    stderr: '',
    error: undefined,
  });
  expect(child.stdout).toContain('CommonJS Firebase/JWKS smoke passed');
});
