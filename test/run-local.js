// A real local run of the Actor with the Apify SDK, against the fake API: the input goes to the local
// key-value store, the dataset and OUTPUT are read back. `npm run test:local` after `npm install`.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const fake = require('./fake-api.cjs');

const root = path.resolve(new URL('..', import.meta.url).pathname);
const storage = path.join(root, 'storage');
fs.rmSync(storage, { recursive: true, force: true });
fs.mkdirSync(path.join(storage, 'key_value_stores', 'default'), { recursive: true });

const api = await fake.start();
fs.writeFileSync(
  path.join(storage, 'key_value_stores', 'default', 'INPUT.json'),
  JSON.stringify({ apiKey: api.KEY, to: '+15550000001', text: 'Local run through the Apify SDK.', baseUrl: api.url }),
);
const child = spawn(process.execPath, ['src/main.js'], {
  cwd: root,
  env: { ...process.env, APIFY_LOCAL_STORAGE_DIR: storage, APIFY_ACTOR_RUN_ID: 'local-1', APIFY_HEADLESS: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
child.stdout.on('data', (d) => (out += d));
child.stderr.on('data', (d) => (out += d));
const code = await new Promise((r) => child.on('close', r));
api.server.close();
const items = fs
  .readdirSync(path.join(storage, 'datasets', 'default'))
  .map((f) => JSON.parse(fs.readFileSync(path.join(storage, 'datasets', 'default', f), 'utf8')));
const output = JSON.parse(fs.readFileSync(path.join(storage, 'key_value_stores', 'default', 'OUTPUT.json'), 'utf8'));
assert.equal(code, 0, out);
assert.equal(items.length, 1);
assert.equal(items[0].state, 'delivered');
assert.equal(items[0].fax_id, api.FAX);
assert.equal(output.idempotency_key, 'apify:local-1:+15550000001');
const send = api.calls.find((c) => c.path === '/v1/faxes');
assert.equal(send.headers['idempotency-key'], 'apify:local-1:+15550000001');
assert.equal(send.body.client_reference, 'apify run local-1');
console.log('local run ok:', items[0].fax_id, items[0].state, `${items[0].pages_sent}/${items[0].pages} pages`);
