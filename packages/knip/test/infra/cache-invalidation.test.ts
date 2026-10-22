import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import test, { type TestContext } from 'node:test';
import { main } from '../../src/index.ts';
import { join } from '../../src/util/path.ts';
import { createOptions } from '../helpers/create-options.ts';

const setup = (t: TestContext) => {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'knip-cache-invalidation-')));
  const cache = realpathSync(mkdtempSync(join(tmpdir(), 'knip-cache-invalidation-data-')));
  t.after(() => {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(cache, { recursive: true, force: true });
  });
  writeFileSync(join(cwd, 'package.json'), '{"name":"cache-invalidation"}');
  writeFileSync(join(cwd, 'knip.json'), '{"entry":["index.ts"],"project":["**/*.ts"]}');
  const write = (file: string, source: string) => writeFileSync(join(cwd, file), source);
  const run = async (cached = true) =>
    main(await createOptions({ cwd, args: { cache: cached, 'cache-location': cache } }));
  const parity = async () => {
    const cached = await run();
    const fresh = await run(false);
    assert.deepEqual(cached, fresh);
    return cached;
  };
  return { cwd, write, run, parity };
};

test('cached scans discover newly added root and nested gitignores', async t => {
  const { cwd, write, run, parity } = setup(t);
  write('index.ts', 'export {};');
  mkdirSync(join(cwd, 'nested'));
  write('nested/unused.ts', 'export const unused = 1;');
  await run();
  write('nested/.gitignore', 'unused.ts\n');
  assert.deepEqual((await parity()).issues.files, {});
  rmSync(join(cwd, 'nested/.gitignore'));
  await parity();
  write('.gitignore', 'nested/\n');
  assert.deepEqual((await parity()).issues.files, {});
});

test('cached scans refresh aliases and previously missing or deleted import targets', async t => {
  const { cwd, write, run, parity } = setup(t);
  write('index.ts', "import { value } from '@value'; console.log(value);");
  write('tsconfig.json', '{"compilerOptions":{"paths":{"@value":["./first.ts"]}}}');
  await run();
  write('first.ts', 'export const value = 1; export const unused = 2;');
  assert.deepEqual((await parity()).issues.unresolved, {});
  write('second.ts', 'export const value = 2;');
  write('tsconfig.json', '{"compilerOptions":{"paths":{"@value":["./second.ts"]}}}');
  assert.deepEqual(Object.keys((await parity()).issues.files), ['first.ts']);
  rmSync(join(cwd, 'second.ts'));
  assert.ok((await parity()).issues.unlisted['index.ts']);
});

test('cache notices same-size writes whose mtime was restored', async t => {
  const { cwd, write, run, parity } = setup(t);
  write('index.ts', "import { value } from './value.ts'; console.log(value);");
  write('value.ts', 'export const value = 1; export const unused = 2;');
  const path = join(cwd, 'value.ts');
  utimesSync(path, 1000, 1000);
  const before = statSync(path);
  await run();
  write('value.ts', 'export const value = 1; export const spared = 2;');
  utimesSync(path, before.atime, before.mtime);
  assert.deepEqual(Object.keys((await parity()).issues.exports['value.ts']), ['spared']);
});
