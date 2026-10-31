// The Actor: read the input, send one fax, write the result to the dataset and to OUTPUT, fail the
// run when the fax ends in a state listed under failOn.
import { Actor, log } from 'apify';

import { ApiError, sendFax } from './fax.js';

const MAX_FILE_BYTES = 25 * 1024 * 1024;

async function fetchFile(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('fileUrl is not a URL.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('fileUrl must be http or https.');
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`fileUrl answered HTTP ${res.status}.`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > MAX_FILE_BYTES) throw new Error('The file is over 25 MB.');
  const name = parsed.pathname.split('/').filter(Boolean).pop() || 'document.pdf';
  return { bytes, filename: /\.(pdf|png|jpe?g|tiff?)$/i.test(name) ? name : `${name}.pdf` };
}

await Actor.init();
try {
  const input = (await Actor.getInput()) || {};
  const runId = process.env.APIFY_ACTOR_RUN_ID || 'local';
  const failOn = String(input.failOn ?? 'failed,unknown').split(',').map((s) => s.trim()).filter(Boolean);
  const file = input.fileUrl ? await fetchFile(input.fileUrl) : undefined;
  const result = await sendFax({
    apiKey: input.apiKey,
    baseUrl: input.baseUrl || 'https://api.faxforagents.com',
    to: String(input.to || '').trim(),
    file,
    text: input.text || undefined,
    markdown: input.markdown || undefined,
    cover: { subject: input.coverSubject, message: input.coverMessage, to_name: input.coverToName, from_name: input.coverFromName },
    approvalId: input.approvalId || undefined,
    clientReference: String(input.clientReference || `apify run ${runId}`).slice(0, 200),
    idempotencyKey: `apify:${runId}:${String(input.to || '').trim()}`,
    wait: input.waitForDelivery !== false,
    timeoutMs: Number(input.timeoutSeconds || 600) * 1000,
    log: (line) => log.info(line),
  });
  const { document, quote, fax, idempotencyKey } = result;
  const record = {
    fax_id: fax.id,
    quote_id: quote.id,
    document_id: document.id,
    to: fax.to,
    state: fax.state,
    failure_code: fax.failure_code ?? null,
    pages: quote.billable_pages,
    pages_sent: fax.pages_sent ?? 0,
    amount_micro: quote.amount_micro,
    provider_ref: fax.provider_ref ?? null,
    evidence: fax.evidence && typeof fax.evidence === 'object' ? Object.fromEntries(Object.entries(fax.evidence).filter(([k]) => !['body', 'headers'].includes(k))) : null,
    idempotency_key: idempotencyKey,
  };
  await Actor.pushData(record);
  await Actor.setValue('OUTPUT', record);
  if (failOn.includes(fax.state)) {
    await Actor.fail(`Fax ${fax.id} ended ${fax.state}${fax.failure_code ? ` (${fax.failure_code})` : ''}.`);
  } else {
    await Actor.exit(`Fax ${fax.id} is ${fax.state}.`);
  }
} catch (err) {
  const msg = err instanceof ApiError ? err.message : err && err.message ? err.message : String(err);
  await Actor.fail(msg);
}
