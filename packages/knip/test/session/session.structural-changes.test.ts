import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import test, { type TestContext } from 'node:test';
import { ProjectPrincipal } from '../../src/ProjectPrincipal.ts';
import { createSession, type Session } from '../../src/session/session.ts';
import { join, toPosix } from '../../src/util/path.ts';
import { createOptions } from '../helpers/create-options.ts';

const setup = async (t: TestContext, isCache: boolean, entry = ['index.ts']) => {
  const cwd = toPosix(await realpath(await mkdtemp(join(tmpdir(), 'knip-session-structure-'))));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(
    join(cwd, 'package.json'),
    JSON.stringify({
      name: 'session-structure',
      dependencies: { 'left-pad': '*' },
      scripts: { check: 'missing-script-bin' },
      knip: { entry, project: ['*.ts'] },
    })
  );
  const write = (file: string, source: string) => writeFile(join(cwd, file), source);
  const start = async () => createSession(await createOptions({ cwd, isSession: true, args: { cache: isCache } }));
  const assertFresh = async (session: Session) => {
    const fresh = await createSession(await createOptions({ cwd, isSession: true }));
    assert.deepEqual(session.getIssues(), fresh.getIssues());
    assert.equal(JSON.stringify(session.getIssues()), JSON.stringify(fresh.getIssues()));
    assert.deepEqual(session.getResults(), fresh.getResults());
    assert.deepEqual(session.describePackageJson(), fresh.describePackageJson());
  };
  return { cwd, write, start, assertFresh };
};

for (const isCache of [false, true]) {
  test(`removing the last source dependency reference matches fresh analysis (cache=${isCache})`, async t => {
    const { write, start, assertFresh } = await setup(t, isCache);
    await write('index.ts', "import 'left-pad';\n");
    const session = await start();
    const results = session.getResults();
    assert.deepEqual(session.getIssues().issues.dependencies, {});

    await write('index.ts', 'export {};\n');
    await session.handleFileChanges([{ type: 'modified', filePath: 'index.ts' }]);
    assert.strictEqual(session.getResults(), results);
    assert.deepEqual(Object.keys(session.getIssues().issues.dependencies['package.json'] ?? {}), ['left-pad']);
    assert.deepEqual(Object.keys(session.getIssues().issues.binaries['package.json']), ['missing-script-bin']);
    await assertFresh(session);

    await write('index.ts', "import 'left-pad';\n");
    await session.handleFileChanges([{ type: 'modified', filePath: 'index.ts' }]);
    await assertFresh(session);
  });

  test(`deleted and newly discovered entry files match fresh analysis (cache=${isCache})`, async t => {
    const { cwd, write, start, assertFresh } = await setup(t, isCache, ['*.entry.ts']);
    await write('app.entry.ts', "import { value } from './value.ts'; console.log(value);\n");
    await write('value.ts', 'export const value = 1;\n');
    const session = await start();

    await rm(join(cwd, 'app.entry.ts'));
    await session.handleFileChanges([{ type: 'deleted', filePath: 'app.entry.ts' }]);
    await assertFresh(session);

    await write('app.entry.ts', "import { value } from './value.ts'; console.log(value);\n");
    await session.handleFileChanges([{ type: 'added', filePath: 'app.entry.ts' }]);
    await assertFresh(session);
    assert.deepEqual(session.getIssues().issues.files, {});

    await write('other.ts', 'export const other = 2;\n');
    await write('other.entry.ts', "import { other } from './other.ts'; console.log(other);\n");
    await session.handleFileChanges([
      { type: 'added', filePath: 'other.ts' },
      { type: 'added', filePath: 'other.entry.ts' },
    ]);
    await assertFresh(session);
    assert.deepEqual(session.getIssues().issues.files, {});
  });

  test(`creating and deleting import targets refreshes unchanged importers (cache=${isCache})`, async t => {
    const { cwd, write, start, assertFresh } = await setup(t, isCache);
    await write('index.ts', "import { value } from './missing.ts'; console.log(value);\n");
    const session = await start();
    assert.deepEqual(Object.keys(session.getIssues().issues.unresolved['index.ts']), ['./missing.ts']);

    await write('missing.ts', 'export const value = 1;\nexport const unused = 2;\n');
    await session.handleFileChanges([{ type: 'added', filePath: 'missing.ts' }]);
    await assertFresh(session);
    assert.deepEqual(session.getIssues().issues.unresolved, {});

    await rm(join(cwd, 'missing.ts'));
    await session.handleFileChanges([{ type: 'deleted', filePath: 'missing.ts' }]);
    await assertFresh(session);
    assert.deepEqual(Object.keys(session.getIssues().issues.unresolved['index.ts']), ['./missing.ts']);
  });

  test(`plugin discovery follows added, modified and deleted non-source inputs (cache=${isCache})`, async t => {
    const { cwd, write, start, assertFresh } = await setup(t, isCache);
    await write(
      'package.json',
      JSON.stringify({ name: 'vite-discovery', knip: { entry: [], project: ['src/**/*.ts'], vite: true } })
    );
    await mkdir(join(cwd, 'src'));
    await write('src/app.ts', 'export {};\n');
    await write('src/other.ts', 'export {};\n');
    const session = await start();
    assert.deepEqual(Object.keys(session.getIssues().issues.files), ['src/app.ts', 'src/other.ts']);

    await write('index.html', '<script type="module" src="/src/app.ts"></script>');
    await session.handleFileChanges([{ type: 'added', filePath: 'index.html' }]);
    await assertFresh(session);
    assert.deepEqual(Object.keys(session.getIssues().issues.files), ['src/other.ts']);

    await write('index.html', '<script type="module" src="/src/other.ts"></script>');
    await session.handleFileChanges([{ type: 'modified', filePath: 'index.html' }]);
    await assertFresh(session);
    assert.deepEqual(Object.keys(session.getIssues().issues.files), ['src/app.ts']);

    await rm(join(cwd, 'index.html'));
    await session.handleFileChanges([{ type: 'deleted', filePath: 'index.html' }]);
    await assertFresh(session);
    assert.deepEqual(Object.keys(session.getIssues().issues.files), ['src/app.ts', 'src/other.ts']);
  });
}

test('a failed structural rebuild retries without reusing partially updated state', async t => {
  const { cwd, write } = await setup(t, false);
  await write('index.ts', "import 'left-pad';\n");
  await write(
    'preprocessor.mjs',
    'let count = 0; export default options => { if (++count === 2) throw new Error("retryable preprocessor failure"); return options; };'
  );
  const options = await createOptions({
    cwd,
    isSession: true,
    args: { preprocessor: [join(cwd, 'preprocessor.mjs')] },
  });
  const session = await createSession(options);
  await write('index.ts', 'export {};\n');
  await assert.rejects(
    session.handleFileChanges([{ type: 'modified', filePath: 'index.ts' }]),
    /retryable preprocessor failure/
  );

  await session.handleFileChanges([{ type: 'modified', filePath: 'index.ts' }]);
  const fresh = await createSession(options);
  assert.deepEqual(session.getIssues(), fresh.getIssues());
  assert.deepEqual(Object.keys(session.getIssues().issues.dependencies['package.json']), ['left-pad']);
});

test('structural rebuilds run the preprocessor once and retain the results object', async t => {
  const { cwd, write } = await setup(t, false);
  await write('index.ts', "import 'left-pad';\n");
  await write(
    'preprocessor.mjs',
    'let count = 0; export default options => { options.counters.total = ++count; return options; };'
  );
  const session = await createSession(
    await createOptions({ cwd, isSession: true, args: { preprocessor: [join(cwd, 'preprocessor.mjs')] } })
  );
  const results = session.getResults();
  assert.equal(results.counters.total, 1);

  await write('index.ts', 'export {};\n');
  await session.handleFileChanges([{ type: 'modified', filePath: 'index.ts' }]);
  assert.strictEqual(session.getResults(), results);
  assert.equal(results.counters.total, 2);
  assert.deepEqual(Object.keys(session.getIssues().issues.dependencies['package.json']), ['left-pad']);
});

test('added files still respect project patterns when a compiler is enabled', async t => {
  const { cwd, write } = await setup(t, false);
  await write('index.ts', 'export {};\n');
  const options = await createOptions({ cwd, isSession: true });
  options.parsedConfig.compilers = { mdx: true };
  const session = await createSession(options);
  await write('notes.mdx', '# Notes');
  await session.handleFileChanges([{ type: 'added', filePath: 'notes.mdx' }]);
  const fresh = await createSession(options);
  assert.deepEqual(session.getIssues(), fresh.getIssues());
  assert.deepEqual(session.getIssues().issues.files, {});
});

test('ordinary source edits retain the fast path when compilers are configured', async t => {
  const { cwd, write } = await setup(t, false);
  await write('index.ts', "import 'left-pad'; console.log(1);\n");
  const options = await createOptions({ cwd, isSession: true });
  options.parsedConfig.compilers = { mdx: true };
  const session = await createSession(options);
  const rebuild = t.mock.method(ProjectPrincipal.prototype, 'walkAndAnalyze');
  await write('index.ts', "import 'left-pad'; console.log(2);\n");
  await session.handleFileChanges([{ type: 'modified', filePath: 'index.ts' }]);
  assert.equal(rebuild.mock.callCount(), 0);
  const fresh = await createSession(options);
  assert.deepEqual(session.getIssues(), fresh.getIssues());
});
