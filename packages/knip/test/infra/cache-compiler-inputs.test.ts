import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { main } from '../../src/index.ts';
import { join, toPosix } from '../../src/util/path.ts';
import { createOptions } from '../helpers/create-options.ts';

for (const asyncCompiler of [false, true]) {
  test(`compiler auxiliary reads invalidate persistent facts (async=${asyncCompiler})`, async t => {
    const cwd = toPosix(await realpath(await mkdtemp(join(tmpdir(), 'knip-compiler-inputs-'))));
    t.after(() => rm(cwd, { recursive: true, force: true }));
    await writeFile(join(cwd, 'package.json'), '{"name":"compiler-inputs"}');
    await writeFile(join(cwd, 'index.custom'), 'entry');
    await writeFile(join(cwd, 'fruits.ts'), 'export const apple = 1; export const banana = 2;');
    const selector = join(cwd, 'selection.txt');
    let calls = 0;
    const options = await createOptions({ cwd, args: { cache: true } });
    options.parsedConfig.entry = ['index.custom'];
    options.parsedConfig.project = ['*.ts', '*.custom'];
    options.parsedConfig.compilers = {
      custom: (_source, _path, context) => {
        calls++;
        let name;
        if (context) name = context.readFile('selection.txt')?.trim() ?? 'apple';
        else {
          try {
            name = readFileSync(selector, 'utf8').trim();
          } catch {
            name = 'apple';
          }
        }
        const source = `import { ${name} } from './fruits.ts'; console.log(${name});`;
        return asyncCompiler ? Promise.resolve(source) : source;
      },
    };

    const unused = async () => Object.keys((await main(options)).issues.exports['fruits.ts'] ?? {});
    assert.deepEqual(await unused(), ['banana']);
    assert.deepEqual(await unused(), ['banana']);
    assert.equal(calls, 1);

    await writeFile(selector, 'banana');
    assert.deepEqual(await unused(), ['apple']);
    assert.equal(calls, 2);
    assert.deepEqual(await unused(), ['apple']);
    assert.equal(calls, 2);

    await writeFile(selector, 'apple');
    assert.deepEqual(await unused(), ['banana']);
    assert.equal(calls, 3);

    await rm(selector);
    assert.deepEqual(await unused(), ['banana']);
    assert.equal(calls, 4);
    assert.deepEqual(await unused(), ['banana']);
    assert.equal(calls, 4);
  });
}

test('an input changed during compilation is not acknowledged as cached', async t => {
  const cwd = toPosix(await realpath(await mkdtemp(join(tmpdir(), 'knip-compiler-input-race-'))));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(join(cwd, 'package.json'), '{"name":"compiler-input-race"}');
  await writeFile(join(cwd, 'index.custom'), 'entry');
  await writeFile(join(cwd, 'fruits.ts'), 'export const apple = 1; export const banana = 2;');
  const selector = join(cwd, 'selection.txt');
  await writeFile(selector, 'apple');
  let calls = 0;
  const options = await createOptions({ cwd, args: { cache: true } });
  options.parsedConfig.entry = ['index.custom'];
  options.parsedConfig.project = ['*.ts', '*.custom'];
  options.parsedConfig.compilers = {
    custom: async (_source, _path, context) => {
      calls++;
      const name = context?.readFile(selector) ?? readFileSync(selector, 'utf8');
      if (calls === 1) await writeFile(selector, 'banana');
      return `import { ${name} } from './fruits.ts'; console.log(${name});`;
    },
  };
  assert.deepEqual(Object.keys((await main(options)).issues.exports['fruits.ts']), ['banana']);
  assert.deepEqual(Object.keys((await main(options)).issues.exports['fruits.ts']), ['apple']);
  assert.equal(calls, 2);
  assert.deepEqual(Object.keys((await main(options)).issues.exports['fruits.ts']), ['apple']);
  assert.equal(calls, 2);
});
