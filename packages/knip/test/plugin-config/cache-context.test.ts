import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { join } from '../../src/util/path.ts';
import { resolve } from '../helpers/resolve.ts';

test('cached plugin configuration respects environment changes in a fresh process', t => {
  const cwd = mkdtempSync(join(tmpdir(), 'knip-plugin-cache-context-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  mkdirSync(join(cwd, 'src'));
  writeFileSync(join(cwd, 'package.json'), '{"name":"plugin-cache","type":"module"}');
  writeFileSync(join(cwd, 'knip.json'), '{"vite":true,"entry":[],"project":["src/**/*.ts"]}');
  writeFileSync(join(cwd, 'src/apple.ts'), 'export {};');
  writeFileSync(join(cwd, 'src/pear.ts'), 'export {};');
  writeFileSync(
    join(cwd, 'vite.config.js'),
    'export default { build: { rollupOptions: { input: process.env.KNIP_TEST_ENTRY } } };'
  );
  const run = (entry: string, cached: boolean) => {
    const args = [resolve('src/cli.ts'), '--no-progress', '--reporter', 'json'];
    if (cached) args.push('--cache', '--cache-location', join(cwd, '.cache'));
    const result = spawnSync(process.execPath, args, {
      cwd,
      env: { ...process.env, KNIP_TEST_ENTRY: entry },
      encoding: 'utf8',
    });
    assert.ok(result.status === 0 || result.status === 1, result.stderr);
    return JSON.parse(result.stdout);
  };
  const apple = run('src/apple.ts', true);
  const pear = run('src/pear.ts', true);
  assert.notDeepEqual(apple, pear);
  assert.deepEqual(pear, run('src/pear.ts', false));
});
