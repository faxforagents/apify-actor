// Keeps the fake API up for a run through the Apify CLI: prints its URL, exits on SIGTERM.
const fake = require('./fake-api.cjs');
fake.start().then((api) => {
  process.stdout.write(`${api.url}\n`);
  process.on('SIGTERM', () => { api.server.close(); process.exit(0); });
});
