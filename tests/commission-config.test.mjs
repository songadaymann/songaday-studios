// wrangler.jsonc against the commission code: a typo in a binding, a name, the migrations folder,
// the cron or the sender would pass every other test and only fail in production.
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import { COMMISSIONS_DATABASE, COMMISSION_BUCKET } from '../commission.mjs';

const root = new URL('../', import.meta.url);

// JSONC as this file writes it: whole-line // comments, no trailing commas.
async function wranglerConfig() {
  const text = await readFile(new URL('wrangler.jsonc', root), 'utf8');
  return JSON.parse(text.split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n'));
}

test('the commission bindings in wrangler.jsonc are the ones the code uses', async () => {
  const config = await wranglerConfig();
  const db = config.d1_databases.find((entry) => entry.binding === 'COMMISSIONS_DB');
  assert.ok(db, 'COMMISSIONS_DB');
  assert.equal(db.database_name, COMMISSIONS_DATABASE);
  assert.equal(db.migrations_dir, 'commission-migrations');
  assert.ok((await readdir(new URL('commission-migrations/', root))).some((name) => /^\d{4}_.*\.sql$/.test(name)));
  const bucket = config.r2_buckets.find((entry) => entry.binding === 'COMMISSION_FILES');
  assert.ok(bucket, 'COMMISSION_FILES');
  assert.equal(bucket.bucket_name, COMMISSION_BUCKET);
  assert.ok(config.ratelimits.some((entry) => entry.name === 'COMMISSION_LIMIT'), 'COMMISSION_LIMIT');
  const email = config.send_email.find((entry) => entry.name === 'COMMISSION_EMAIL');
  assert.ok(email, 'COMMISSION_EMAIL');
  assert.ok(email.allowed_sender_addresses.includes(config.vars.COMMISSION_FROM_EMAIL), 'the sender is an allowed sender');
  assert.equal(config.triggers.crons.length, 1);
  assert.match(config.triggers.crons[0], /^\d+ \d+ \* \* \*$/, 'once a day');
});

test('nothing in wrangler.jsonc opens the admin or logs buyer links', async () => {
  const config = await wranglerConfig();
  // The localhost admin is for .dev.vars only.
  assert.equal('COMMISSION_ADMIN_LOCAL' in config.vars, false);
  // Invocation logs record full URLs, and buyer links carry their token.
  assert.equal(config.observability?.logs?.invocation_logs, false);
  for (const name of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'ADMIN_EMAILS', 'TURNSTILE_SECRET_KEY',
    'COMMISSION_REPLY_TO', 'COMMISSION_NOTIFY_TO']) {
    assert.equal(name in config.vars, false, `${name} is a secret`);
  }
});
