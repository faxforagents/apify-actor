<p align="center">
  <a href="https://faxforagents.com"><img src="https://faxforagents.com/brand/logo-512.png" width="88" alt="Fax for Agents"></a>
</p>

<h1 align="center">Send a fax (Fax for Agents)</h1>

<p align="center">An Apify Actor that sends one fax through <a href="https://faxforagents.com">Fax for Agents</a> and waits for the carrier's outcome. A PDF or image URL, text or Markdown to a number.</p>

<p align="center">
  <a href="https://faxforagents.com">Website</a> ·
  <a href="https://faxforagents.com/docs/quickstart/">Quickstart</a> ·
  <a href="https://faxforagents.com/docs/api/">API reference</a> ·
  <a href="https://faxforagents.com/docs/sdks/">SDKs</a> ·
  <a href="https://faxforagents.com/mcp/">MCP</a> ·
  <a href="https://app.faxforagents.com">Dashboard</a> ·
  <a href="https://faxforagents.com/pricing/">Pricing</a> ·
  <a href="https://faxforagents.com/changelog/">Changelog</a> ·
  <a href="https://faxforagents.com/affiliates/">Affiliate program</a> ·
  <a href="https://gitlab.com/faxforagents/apify-actor">GitLab</a>
</p>

<div align="center">

[![ci](https://img.shields.io/github/actions/workflow/status/faxforagents/apify-actor/ci.yml?branch=main&label=ci)](https://github.com/faxforagents/apify-actor/actions/workflows/ci.yml) [![MIT](https://img.shields.io/badge/licence-MIT-1f6feb)](https://github.com/faxforagents/apify-actor/blob/main/LICENSE) [![Apify Actor](https://img.shields.io/badge/Apify-Actor-00c3a0)](https://apify.com/store)

</div>

Fax for Agents is a fax API, a hosted MCP server and SDKs built so AI agents can send and receive
faxes. It is made by JSB Holdings LLC and built by [Synapse](https://synapsereality.io/).

The Actor runs on Node 20 with the Apify SDK and nothing else. It prepares the document and quotes it
to the number. It queues the fax under an idempotency key tied to the Apify run. Then it polls until
the carrier reports `delivered`, `partial`, `failed` or `unknown`, and writes one record to the
dataset and to the `OUTPUT` key.

## Input

| Field | Required | Default | Does |
|---|---|---|---|
| `apiKey` | no | | The Fax for Agents API key, stored as a secret input. Empty means check mode: the run probes the API, sends nothing and writes one `mode: check` record |
| `to` | yes | | Destination in E.164, for example `+12025550123` |
| `fileUrl` | one of three | | URL of a PDF, PNG, JPG or TIFF, up to 25 MB |
| `text` | one of three | | Plain text, rendered to a letter PDF |
| `markdown` | one of three | | Markdown, rendered to PDF |
| `coverSubject`, `coverMessage`, `coverToName`, `coverFromName` | no | | Fields of an optional cover sheet. Any of them adds a billable cover page |
| `approvalId` | no | | An approved request bound to this send, when the account needs a human approval for live sends |
| `clientReference` | no | the run id | Your own reference on the fax, up to 200 characters |
| `waitForDelivery` | no | `true` | `false` returns once the fax is queued |
| `timeoutSeconds` | no | `600` | How long to wait for a terminal state before the run fails |
| `failOn` | no | `failed,unknown` | Terminal states that fail the run. Empty never fails it |
| `baseUrl` | no | `https://api.faxforagents.com` | Only for a test double |

```json
{
  "apiKey": "ffa_test_...",
  "to": "+15550000001",
  "text": "Hello from an Apify Actor.",
  "coverSubject": "Deploy notice"
}
```

A test key (`ffa_test_...`) reaches the sandbox only. No carrier, no cost. The destination number
picks the outcome: `+15550000001` is delivered, `+15550000003` is partial and `+15550000005` is
unknown. A live key (`ffa_live_...`) reaches the carrier and spends the prepaid wallet. Keys are
created at [app.faxforagents.com](https://app.faxforagents.com).

## Output

One dataset record, also stored as `OUTPUT` in the default key-value store.

```json
{
  "fax_id": "fax_...",
  "quote_id": "qte_...",
  "document_id": "doc_...",
  "to": "+15550000001",
  "state": "delivered",
  "failure_code": null,
  "pages": 1,
  "pages_sent": 1,
  "amount_micro": 39000,
  "provider_ref": "...",
  "evidence": { "remote_station_id": "...", "pages": 1 },
  "idempotency_key": "apify:<run id>:+15550000001"
}
```

`amount_micro` is the quoted price in USD micro-units: 39000 is $0.039. `evidence` is what the
carrier reported on a delivered or partial fax. It is not legal proof the recipient accepted it. A
`partial` or `unknown` outcome never retransmits on its own.

An API refusal fails the run with the remedy and the stable `error_code` in the status message, for
example `error_code=insufficient_balance`. When the quote says a human approval is required and no
`approvalId` was given, the run fails before anything is sent.

## Prices

Price card launch-v3 is effective from 2026-11-12. $0.039 per page sent, $0.019 per page received. $2 per
number per month, $19 per month for the Agent workspace. Sandbox pages cost 0. Apify charges its own
compute for the run.

## Working on this repository

```bash
npm ci
npm test                 # the send flow against a fake API, no network
npm run test:local       # a run through the Apify SDK against the fake API, dataset and OUTPUT checked
npx apify-cli run        # the same through the Apify CLI, input from storage/key_value_stores/default/INPUT.json
docker build -t faxforagents-send-a-fax .
sh scripts/truthcheck.sh
```

Publishing to the Apify Store goes through Apify Console: push the Actor (`apify push`), build it,
then Publishing, "Publish on Store".

## Licence

MIT. See [LICENSE](LICENSE). Security reports go to hello@faxforagents.com.
