import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import { createRequire } from 'node:module';

import { ApiError, sendFax, checkApi, trimTrailingSlashes } from '../src/fax.js';

const require = createRequire(import.meta.url);
const fake = require('./fake-api.cjs');

let api;
const noSleep = async () => {};
before(async () => {
  api = await fake.start();
});
after(() => api.server.close());
beforeEach(() => {
  api.calls.length = 0;
  api.state.polls = 0;
  api.state.outcome = 'delivered';
});
const base = () => ({ apiKey: api.KEY, baseUrl: api.url, sleep: noSleep });

test('text is prepared, quoted, queued under an idempotency key and polled to delivered', async () => {
  const r = await sendFax({ ...base(), to: '+15550000001', text: 'Hello from Apify.' });
  assert.deepEqual(api.calls.map((c) => [c.method, c.path]), [
    ['POST', '/v1/documents'], ['POST', '/v1/fax-quotes'], ['POST', '/v1/faxes'], ['GET', `/v1/faxes/${api.FAX}`], ['GET', `/v1/faxes/${api.FAX}`],
  ]);
  assert.equal(api.calls[2].headers['idempotency-key'], `apify:${api.QUOTE}`);
  assert.equal(r.fax.state, 'delivered');
  assert.equal(r.quote.amount_micro, 39000);
});

test('the base URL drops its trailing slashes and nothing else', async () => {
  assert.equal(trimTrailingSlashes('https://api.example.test///'), 'https://api.example.test');
  assert.equal(trimTrailingSlashes('https://api.example.test/v1/'), 'https://api.example.test/v1');
  assert.equal(trimTrailingSlashes('https://api.example.test'), 'https://api.example.test');
  assert.equal(trimTrailingSlashes('///'), '');
  await sendFax({ ...base(), baseUrl: `${api.url}//`, to: '+15550000001', text: 'Hello from Apify.' });
  assert.equal(api.calls[0].path, '/v1/documents');
});

test('the base URL trim takes linear time on a long run of slashes that does not end the string', () => {
  // `/\/+$/` took about 16 s on this input (CodeQL js/polynomial-redos)
  const long = `https://api.example.test${'/'.repeat(100_000)}x`;
  const started = performance.now();
  assert.equal(trimTrailingSlashes(long), long);
  assert.equal(trimTrailingSlashes(`${long}${'/'.repeat(100_000)}`), long);
  assert.ok(performance.now() - started < 1_000);
});

test('downloaded bytes go through the signed upload with their sha256', async () => {
  const bytes = Buffer.from('%PDF-1.4 fake');
  const r = await sendFax({ ...base(), to: '+15550000001', file: { bytes, filename: 'letter.pdf' }, wait: false });
  assert.deepEqual(api.calls.map((c) => [c.method, c.path]).slice(0, 4), [
    ['POST', '/v1/uploads'], ['PUT', '/upload/signed'], ['POST', `/v1/uploads/${api.UPL}/complete`], ['POST', '/v1/documents'],
  ]);
  assert.deepEqual(api.calls[0].body, { filename: 'letter.pdf', size_bytes: bytes.length, content_type: 'application/pdf' });
  assert.equal(api.calls[1].headers.authorization, undefined);
  assert.equal(api.calls[2].body.sha256, crypto.createHash('sha256').update(bytes).digest('hex'));
  assert.equal(r.fax.state, 'queued');
});

test('a quote that needs a human approval stops before the send', async () => {
  await assert.rejects(sendFax({ ...base(), to: '+15550000007', text: 'x' }), (e) => e instanceof ApiError && e.code === 'approval_required');
  assert.equal(api.calls.filter((c) => c.path === '/v1/faxes').length, 0);
});

test('input mistakes are refused before any request', async () => {
  await assert.rejects(sendFax({ ...base(), to: '+15550000001' }), /exactly one of fileUrl, text or markdown/);
  await assert.rejects(sendFax({ ...base(), to: '5550000001', text: 'a' }), /E\.164/);
  await assert.rejects(sendFax({ ...base(), apiKey: '', to: '+15550000001', text: 'a' }), /apiKey is required/);
  assert.equal(api.calls.length, 0);
});

test('API refusals carry the stable code, partial and failed are terminal', async () => {
  await assert.rejects(sendFax({ ...base(), apiKey: 'ffa_test_wrong', to: '+15550000001', text: 'a' }), /error_code=invalid_token/);
  api.state.outcome = 'partial';
  assert.equal((await sendFax({ ...base(), to: '+15550000001', text: 'a' })).fax.state, 'partial');
  api.state.polls = 0;
  api.state.outcome = 'failed';
  assert.equal((await sendFax({ ...base(), to: '+15550000001', text: 'a' })).fax.state, 'failed');
});

test('checkApi probes /healthz without a key and reports the outcome', async () => {
  const calls = [];
  const fetchImpl = async (url) => { calls.push(url); return { ok: true, status: 200 }; };
  const r = await checkApi({ baseUrl: 'https://example.test/', fetchImpl });
  assert.deepEqual(calls, ['https://example.test/healthz']);
  assert.equal(r.api_base_url, 'https://example.test');
  assert.equal(r.mode, 'check');
  assert.equal(r.api_reachable, true);
  assert.equal(r.api_status, 200);
  calls.length = 0;
  assert.equal((await checkApi({ baseUrl: 'https://example.test///', fetchImpl })).api_base_url, 'https://example.test');
  assert.deepEqual(calls, ['https://example.test/healthz']);
  // the whole sentence, not a substring check on the host (CodeQL js/incomplete-url-substring-sanitization)
  assert.equal(r.next_step, 'Create a key at https://app.faxforagents.com and put it in the apiKey input to send a fax.');
});
