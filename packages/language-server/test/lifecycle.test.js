import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  NOTIFICATION_MODULE_GRAPH_BUILT,
  NOTIFICATION_RESTART_REQUIRED,
  REQUEST_FILE_NODE,
  REQUEST_RESULTS,
} from '../src/constants.js';

const startServer = (cwd, t) => {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../src/cli.js', import.meta.url)), '--stdio'], {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  t.after(() => child.kill());
  let buffer = Buffer.alloc(0);
  let nextId = 1;
  const messages = [];
  const send = payload => {
    const body = JSON.stringify({ jsonrpc: '2.0', ...payload });
    child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  };
  child.stdout.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const header = buffer.indexOf('\r\n\r\n');
      if (header === -1) return;
      const length = Number(
        buffer
          .subarray(0, header)
          .toString()
          .match(/Content-Length: (\d+)/i)?.[1]
      );
      if (buffer.length < header + 4 + length) return;
      const message = JSON.parse(buffer.subarray(header + 4, header + 4 + length).toString());
      buffer = buffer.subarray(header + 4 + length);
      if (message.method === 'workspace/configuration') send({ id: message.id, result: [{}] });
      else messages.push(message);
    }
  });
  const wait = async predicate => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const index = messages.findIndex(predicate);
      if (index !== -1) return messages.splice(index, 1)[0];
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.fail(`Timed out waiting for server: ${JSON.stringify(messages)}`);
  };
  const request = async (method, params) => {
    const id = nextId++;
    send({ id, method, params });
    const message = await wait(message => message.id === id);
    assert.equal(message.error, undefined);
    return message.result;
  };
  const initialize = async () => {
    await request('initialize', {
      processId: process.pid,
      capabilities: {},
      workspaceFolders: [{ uri: pathToFileURL(cwd).href, name: 'lifecycle' }],
    });
    send({ method: 'initialized', params: {} });
    await wait(message => message.method === NOTIFICATION_MODULE_GRAPH_BUILT);
  };
  return { child, send, wait, request, initialize };
};

test('source updates refresh descriptors without diagnostic changes and executable configs request a fresh process', async t => {
  const cwd = realpathSync(mkdtempSync(path.join(tmpdir(), 'knip-ls-lifecycle-')));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const write = (name, source) => writeFileSync(path.join(cwd, name), source);
  write('package.json', '{"name":"lifecycle","type":"module"}');
  write('settings.js', "export const entry = ['index.js'];");
  write('knip.js', "import { entry } from './settings.js'; export default { entry, project: ['*.js'] };");
  write('index.js', "import { used } from './value.js'; console.log(used);");
  write('value.js', 'export const used = 1;');
  const server = startServer(cwd, t);
  await server.initialize();
  const uri = pathToFileURL(path.join(cwd, 'value.js')).href;
  const initial = await server.request(REQUEST_FILE_NODE, { uri });
  const before = await server.request(REQUEST_RESULTS);
  write('value.js', '\nexport const used = 1;');
  server.send({ method: 'workspace/didChangeWatchedFiles', params: { changes: [{ uri, type: 2 }] } });
  await server.wait(message => message.method === NOTIFICATION_MODULE_GRAPH_BUILT);
  const updated = await server.request(REQUEST_FILE_NODE, { uri });
  assert.equal(updated.exports[0].line, initial.exports[0].line + 1);
  assert.deepEqual((await server.request(REQUEST_RESULTS)).counters, before.counters);
  write('settings.js', "export const entry = ['value.js'];");
  server.send({
    method: 'workspace/didChangeWatchedFiles',
    params: {
      changes: [{ uri: pathToFileURL(path.join(cwd, 'settings.js')).href, type: 2 }],
    },
  });
  await server.wait(message => message.method === NOTIFICATION_RESTART_REQUIRED);
  assert.equal(await server.request(REQUEST_RESULTS), null);
  server.child.kill();
  const restarted = startServer(cwd, t);
  await restarted.initialize();
  assert.ok((await restarted.request(REQUEST_RESULTS)).issues.files['index.js']);
});
