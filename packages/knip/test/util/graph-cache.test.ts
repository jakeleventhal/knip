import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { GraphCacheConsultant } from '../../src/GraphCacheConsultant.ts';
import { createFileNode } from '../../src/util/module-graph.ts';
import { join } from '../../src/util/path.ts';
import { createOptions } from '../helpers/create-options.ts';

test('graph cache retains both export policies and returns independent graph records', async t => {
  const cwd = mkdtempSync(join(tmpdir(), 'knip-graph-variants-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  writeFileSync(join(cwd, 'package.json'), '{}');
  const filePath = join(cwd, 'index.ts');
  writeFileSync(filePath, 'export {};');
  const cacheLocation = join(cwd, '.cache');
  const options = await createOptions({ cwd, args: { cache: true, 'cache-location': cacheLocation } });
  const open = () => {
    const cache = new GraphCacheConsultant(options);
    cache.init('stable-context');
    return cache;
  };
  const cache = open();
  const full = createFileNode();
  cache.setCachedFile(filePath, full, new Map());
  cache.setCachedFile(filePath, { ...full, skipExports: true }, new Map());
  cache.reconcile();
  const path = join(cacheLocation, readdirSync(cacheLocation)[0]);
  const before = readFileSync(path);
  const restored = open();
  const first = restored.getCachedFile(filePath, false, () => undefined);
  assert.ok(first);
  first.scripts.add('modified only in the live graph');
  assert.deepEqual(
    restored.getCachedFile(filePath, false, () => undefined),
    full
  );
  assert.deepEqual(
    restored.getCachedFile(filePath, true, () => undefined),
    { ...full, skipExports: true }
  );
  restored.reconcile();
  assert.deepEqual(readFileSync(path), before);
  const changedContext = new GraphCacheConsultant(options);
  changedContext.init('different-context');
  assert.equal(
    changedContext.getCachedFile(filePath, false, () => undefined),
    undefined
  );
});
