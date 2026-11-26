// The private monthly total (monthly-giving.mjs): what monthly patrons give each month, read
// from Zeffy's payments API and shown only at /commission/admin/monthly.
import assert from 'node:assert/strict';
import test from 'node:test';
import { WINDOW_DAYS, ZeffyError, handleMonthlyGiving, monthlySummary, readPayments } from '../monthly-giving.mjs';
import { call, commissionEnv, fakeFetch } from './fake-cloudflare.mjs';

const LOCAL = 'http://localhost:8787';
const NOW = Date.UTC(2026, 10, 15, 12);
const ago = (days) => Math.floor(NOW / 1000) - days * 86400;
const FORM = 'c0000000-0000-4000-8000-000000000001';
const OTHER = 'c0000000-0000-4000-8000-000000000002';

// A payment as Zeffy sends it, buyer and all. Made-up people.
let made = 0;
function payment({ cents = 1000, days = 3, gift = null, interval = 'monthly', status = 'active', campaign = FORM, title = 'Song A Day', refund = 'none' } = {}) {
  made += 1;
  return {
    id: `p${made}`, object: 'payment', created: ago(days), amount: cents, currency: 'usd', status: 'succeeded', type: 'online',
    refund_status: refund, description: title, campaign_id: campaign, campaign_category: 'donation',
    contact: `contact-${made}`,
    buyer: { first_name: 'Ada', last_name: 'Example', email: 'ada@example.com', address: { city: 'Springfield' } },
    receipt_url: `https://example.com/receipt/${made}`,
    items: [{ type: 'donation', amount: cents, recurrence_interval: gift ? interval : null }],
    recurring: gift ? { is_recurring: true, status, interval, subscription_id: gift, current_period_start: ago(days), current_period_end: ago(days - 30) } : null
  };
}

const zeffy = (pages) => fakeFetch([['https://api.zeffy.com/api/v1/payments', (request) => {
  const after = new URL(request.url).searchParams.get('starting_after');
  const index = after ? pages.findIndex((page) => page.next_cursor === after) + 1 : 0;
  return pages[index];
}]]);

test('payments are read a page at a time with the key, and cut down to what the totals need', async () => {
  const stub = zeffy([
    { object: 'list', data: [payment({ gift: 's1' }), payment()], has_more: true, next_cursor: 'cursor-1' },
    { object: 'list', data: [payment({ gift: 's2', cents: 2500 })], has_more: false, next_cursor: null }
  ]);
  const payments = await readPayments({ ZEFFY_API_KEY: 'test-key' }, { now: NOW, fetcher: stub.fetch });
  assert.equal(payments.length, 3);
  assert.equal(stub.calls.length, 2);
  const first = new URL(stub.calls[0].url);
  assert.equal(first.searchParams.get('status'), 'succeeded');
  assert.equal(first.searchParams.get('limit'), '100');
  assert.equal(first.searchParams.get('created[gte]'), String(ago(WINDOW_DAYS)));
  assert.equal(first.searchParams.get('starting_after'), null);
  assert.equal(new URL(stub.calls[1].url).searchParams.get('starting_after'), 'cursor-1');
  for (const sent of stub.calls) assert.equal(sent.headers.get('Authorization'), 'Bearer test-key');
  // Nothing about the person survives the read.
  assert.deepEqual(Object.keys(payments[0]).sort(), ['campaign', 'cents', 'created', 'currency', 'id', 'recurring', 'refunded', 'title']);
  assert.deepEqual(payments[0].recurring, { interval: 'monthly', status: 'active', gift: 's1' });
  assert.equal(payments[1].recurring, null);
  assert.doesNotMatch(JSON.stringify(payments), /Ada|Example|example\.com|contact-|Springfield|receipt/);
});

test('a refusal from Zeffy carries its status and code, never the key', async () => {
  const refused = fakeFetch([['https://api.zeffy.com/', () => Response.json({ error: { type: 'authentication_error', code: 'invalid_api_key', status: 401 } }, { status: 401 })]]);
  await assert.rejects(readPayments({ ZEFFY_API_KEY: 'secret-key-value' }, { now: NOW, fetcher: refused.fetch }), (error) => {
    assert.ok(error instanceof ZeffyError);
    assert.equal(error.status, 401);
    assert.equal(error.code, 'invalid_api_key');
    assert.doesNotMatch(error.message, /secret-key-value/);
    return true;
  });
});

test('the monthly total counts each running monthly gift once, and nothing else', async () => {
  const stub = zeffy([{ object: 'list', has_more: false, next_cursor: null, data: [
    payment({ gift: 's1', cents: 1000, days: 2 }),
    payment({ gift: 's1', cents: 1000, days: 31 }),                      // the same gift's charge a month earlier
    payment({ gift: 's2', cents: 5000, days: 10 }),
    payment({ gift: 's3', cents: 700, days: 5, status: 'cancelled' }),   // stopped since
    payment({ gift: 's4', cents: 12000, days: 8, interval: 'yearly' }),  // not monthly
    payment({ gift: 's5', cents: 900, days: 4, refund: 'full' }),        // given back
    payment({ cents: 100, days: 1 }),                                    // one-time
    payment({ cents: 2000, days: 20 }),                                  // one-time
    payment({ gift: 's6', cents: 300, days: 6, campaign: OTHER, title: 'Another fund' })
  ] }]);
  const payments = await readPayments({ ZEFFY_API_KEY: 'k' }, { now: NOW, fetcher: stub.fetch });
  const all = monthlySummary(payments);
  assert.deepEqual(all.monthly, { cents: 6300, gifts: 3 });
  assert.deepEqual(all.oneTime, { cents: 2100, gifts: 2 });
  assert.deepEqual(all.campaigns.map((entry) => [entry.title, entry.monthlyCents, entry.monthlyGifts, entry.oneTimeCents]), [['Song A Day', 6000, 2, 2100], ['Another fund', 300, 1, 0]]);
  assert.deepEqual(all.seen, { payments: 9, intervals: ['monthly', 'yearly'], statuses: ['active', 'cancelled'], currencies: ['usd'] });
  // One campaign only.
  const one = monthlySummary(payments, { campaign: FORM });
  assert.deepEqual(one.monthly, { cents: 6000, gifts: 2 });
  assert.deepEqual(one.campaigns.map((entry) => entry.id), [FORM]);
  assert.deepEqual(monthlySummary([]).monthly, { cents: 0, gifts: 0 });
});

test('the page is only for the signed-in admin, shows totals and no names, and says so when Zeffy or the key is the problem', async () => {
  const env = await commissionEnv({ ZEFFY_API_KEY: 'test-key' });
  const stub = zeffy([{ object: 'list', has_more: false, next_cursor: null, data: [payment({ gift: 's1', cents: 1500 }), payment({ gift: 's2', cents: 4500 }), payment({ cents: 2000 })] }]);
  // Not the admin: nothing is read from Zeffy at all.
  const stranger = await call(env, '/commission/admin/monthly', {}, stub);
  assert.equal(stranger.status, 401);
  assert.equal(stub.calls.length, 0);

  const response = await call(env, '/commission/admin/monthly', {}, stub, LOCAL);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.match(response.headers.get('X-Robots-Tag'), /noindex/);
  const html = await response.text();
  assert.match(html, /<p class="big">\$60 a month<\/p>/);
  assert.match(html, /From 2 monthly gifts: 2% of the first goal of \$3,000 a month\./);
  assert.match(html, /One-time gifts in the last 32 days: \$20 across 1 gift\./);
  assert.doesNotMatch(html, /Ada|example\.com|test-key/);

  const json = await (await call(env, '/commission/admin/monthly?format=json', {}, stub, LOCAL)).json();
  assert.deepEqual(json.monthly, { cents: 6000, gifts: 2 });
  assert.doesNotMatch(JSON.stringify(json), /Ada|example\.com|test-key/);

  // One campaign only, when its id is set.
  const narrowed = await (await call({ ...env, ZEFFY_CAMPAIGN_ID: OTHER }, '/commission/admin/monthly?format=json', {}, stub, LOCAL)).json();
  assert.deepEqual(narrowed.monthly, { cents: 0, gifts: 0 });

  assert.equal((await call(env, '/commission/admin/monthly', { method: 'POST' }, stub, LOCAL)).status, 405);
  const { ZEFFY_API_KEY, ...keyless } = env;
  const missing = await call(keyless, '/commission/admin/monthly', {}, stub, LOCAL);
  assert.equal(missing.status, 503);
  assert.match(await missing.text(), /ZEFFY_API_KEY/);
  const refused = fakeFetch([['https://api.zeffy.com/', () => Response.json({ error: { code: 'invalid_api_key' } }, { status: 401 })]]);
  const bad = await call(env, '/commission/admin/monthly', {}, refused, LOCAL);
  assert.equal(bad.status, 502);
  const said = await bad.text();
  assert.match(said, /Zeffy refused the key/);
  assert.doesNotMatch(said, /test-key/);

  // Every other address is left to the rest of the site.
  assert.equal(await handleMonthlyGiving(new Request('https://songaday.studio/commission/admin'), env, new URL('https://songaday.studio/commission/admin')), null);
});

test('no public page shows the monthly total or links to it', async () => {
  const { readFile } = await import('node:fs/promises');
  for (const file of ['profile.html', 'patrons.html', 'story.html', 'films.html']) {
    assert.doesNotMatch(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'), /admin\/monthly|ZEFFY_API_KEY/, file);
  }
});
