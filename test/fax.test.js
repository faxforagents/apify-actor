import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import { createRequire } from 'node:module';

import { ApiError, sendFax } from '../src/fax.js';

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
