import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { FileEntryCache } from '../../src/util/file-entry-cache.ts';
import { join } from '../../src/util/path.ts';

test('journal writes only changed records, replays removals and compacts bounded updates', t => {
  const cwd = mkdtempSync(join(tmpdir(), 'knip-journal-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const open = () => new FileEntryCache<string>('analysis', cwd, undefined, true, 'context', true);
  const initial = open();
  const files = [];
  for (let index = 0; index < 32; index++) {
    const file = join(cwd, `${index}.ts`);
    files.push(file);
    writeFileSync(file, '');
    initial.setFileData(file, `${index}:${'a'.repeat(2048)}`);
  }
  initial.reconcile();
  const snapshot = readFileSync(initial.filePath);
  const next = open();
  next.setFileData(files[0], 'changed');
  next.removeEntry(files[1]);
  next.reconcile();
  const delta = readFileSync(next.filePath);
  assert.deepEqual(delta.subarray(0, snapshot.length), snapshot);
  assert.ok(delta.length - snapshot.length < 1024);
  const restored = open();
  assert.equal(restored.getFileDescriptor(files[0]).meta?.data, 'changed');
  assert.equal(restored.cache.has(files[1]), false);
  restored.reconcile();
  assert.deepEqual(readFileSync(restored.filePath), delta);
  for (let index = 0; index < 40; index++) {
    const current = open();
    current.setFileData(files[0], String(index));
    current.reconcile();
    assert.equal(open().getFileDescriptor(files[0]).meta?.data, String(index));
  }
  const compacted = readFileSync(initial.filePath);
  assert.notDeepEqual(compacted.subarray(0, snapshot.length), snapshot);
  assert.ok(compacted.length < snapshot.length + 4096);
});

test('truncated, corrupted and interleaved journals are discarded instead of replaying partial data', t => {
  const cwd = mkdtempSync(join(tmpdir(), 'knip-journal-corruption-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const open = () => new FileEntryCache<string>('analysis', cwd, undefined, true, 'context', true);
  const cache = open();
  for (let index = 0; index < 16; index++) {
    const file = join(cwd, `${index}.ts`);
    writeFileSync(file, '');
    cache.setFileData(file, 'value'.repeat(500));
  }
  cache.reconcile();
  const original = readFileSync(cache.filePath);
  const corrupted = Buffer.from(original);
  corrupted[corrupted.length - 1] ^= 1;
  for (const bytes of [original.subarray(0, original.length - 1), corrupted]) {
    writeFileSync(cache.filePath, bytes);
    assert.equal(open().cache.size, 0);
  }
  writeFileSync(cache.filePath, original);
  const first = open();
  const second = open();
  first.setFileData(join(cwd, '0.ts'), 'first');
  second.setFileData(join(cwd, '1.ts'), 'second');
  first.reconcile();
  second.reconcile();
  assert.equal(open().cache.size, 0);
  const recovered = open();
  recovered.setFileData(join(cwd, '0.ts'), 'recovered');
  recovered.reconcile();
  assert.equal(open().getFileDescriptor(join(cwd, '0.ts')).meta?.data, 'recovered');
});
