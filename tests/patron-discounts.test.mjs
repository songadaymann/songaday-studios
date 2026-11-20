import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fakeD1 } from './fake-cloudflare.mjs';
import { handlePatron, findPatron, paidThrough, monthAfter, patronHash, cleanupPatrons } from '../patron-discounts.mjs';
import { handleStore, createStoreCheckout, settleStoreCheckout } from '../store.mjs';

const sql = (await Promise.all(['0001_commissions.sql', '0002_store.sql', '0003_store_snapshot.sql', '0004_patron_discounts.sql'].map(f => readFile(new URL('../commission-migrations/' + f, import.meta.url), 'utf8')))).join('\n');
const origin = 'https://songaday.studio';
const email = 'patron@example.com';
const at = () => Math.floor(Date.now() / 1000);
const address = { firstName: 'Sample', lastName: 'Buyer', addressLine1: '1 Test St', addressLine2: '', city: 'Brooklyn', state: 'NY', postCode: '11203', country: 'US', email, phone: '2125550100' };
const payment = (change = {}) => ({ id: 'payment-fixture', contact: 'contact-fixture', campaign_id: 'campaign-fixture', created: at() - 86400,
  amount: 100, status: 'succeeded', type: 'online', refund_status: 'none', refunds: [], dispute: null,
  recurring: { is_recurring: true, interval: 'monthly', status: 'active', subscription_id: 'subscription-fixture', current_period_end: at() + 28 * 86400 }, ...change });
function setup() {
  const db = fakeD1(sql), emails = [], calls = [];
  let payments = [payment()], unavailable = false, contactEmail = email;
  const env = { COMMISSIONS_DB: db, SITE_ORIGIN: origin, STORE_OPEN: 'yes', GELATO_API_KEY: 'fixture', STRIPE_SECRET_KEY: 'rk_live_fixture', STRIPE_WEBHOOK_SECRET: 'fixture',
    ZEFFY_API_KEY: 'fixture', ZEFFY_CAMPAIGN_ID: 'campaign-fixture', PATRON_DISCOUNT_PERCENT: '20', COMMISSION_FROM_EMAIL: 'songs@songaday.studio',
    COMMISSION_EMAIL: { send: async message => { emails.push(message); return { messageId: 'fixture' }; } } };
  const fetcher = async (input, options = {}) => {
    const url = new URL(input); calls.push({ url, ...options });
    if (url.hostname === 'api.zeffy.com') {
      if (unavailable) return Response.json({}, { status: 503 });
      const data = url.pathname.endsWith('/contacts') ? [{ id: 'contact-fixture', email: contactEmail }] : payments;
      return Response.json({ data, has_more: false });
    }
    if (url.pathname === '/v4/orders:quote') return Response.json({ quotes: [{ products: [{ itemReferenceId: 'poster', currency: 'USD' }], shipmentMethods: [{ shipmentMethodUid: 'ground', currency: 'USD', name: 'Ground', price: 4.9 }], carrierSurcharge: { price: .4 } }] });
    if (url.pathname === '/v1/customers') return Response.json({ id: 'cus_fixture' });
    if (url.pathname === '/v1/checkout/sessions') return Response.json({ id: 'cs_live_fixture', url: 'https://checkout.stripe.com/c/pay/cs_live_fixture', expires_at: at() + 2700 });
    if (url.pathname === '/v1/payment_intents/pi_fixture') return Response.json({ status: 'succeeded', currency: 'usd', amount_received: 2892, latest_charge: { refunded: false, amount_refunded: 0 } });
    if (url.pathname === '/v4/orders') return Response.json({ id: 'gelato_fixture', orderReferenceId: JSON.parse(options.body).orderReferenceId, orderType: 'order', fulfillmentStatus: 'created' });
    throw Error('Unexpected provider call');
  };
  return { db, env, emails, calls, fetcher, setPayments: value => { payments = value; }, setUnavailable: value => { unavailable = value; }, setContactEmail: value => { contactEmail = value; } };
}
async function withSetup(fn) {
  const s = setup(), previous = globalThis.fetch; globalThis.fetch = s.fetcher;
  try { await fn(s); } finally { globalThis.fetch = previous; s.db.sqlite.close(); }
}
const request = (path, data, cookie, method = data === undefined ? 'GET' : 'POST') => new Request(origin + path, {
  method, headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: data === undefined ? undefined : JSON.stringify(data)
});
const route = (s, req) => handlePatron(req, s.env, new URL(req.url));
async function verify(s, value = email) {
  const sent = await route(s, request('/store/patron/request', { email: value, returnTo: '/store/muscle/?figure=39&size=12x16&frame=none' }));
  assert.equal(sent.status, 200);
  const link = s.emails.at(-1).text.match(/https:\/\/\S+/)[0], token = new URL(link).searchParams.get('token');
  const req = new Request(origin + '/store/patron/verify', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }) });
  const response = await route(s, req); assert.equal(response.status, 303);
  return { cookie: response.headers.get('Set-Cookie').split(';')[0], response, token, link };
}
const quote = (s, cookie, recipient = address, extra = {}) => {
  const req = request('/store/quote', { figure: 15, variant: '12x16-unframed', recipient, ...extra }, cookie);
  return handleStore(req, s.env, new URL(req.url));
};
test('only a paid, current monthly gift qualifies; no minimum amount, including a canceled paid month', () => {
  assert.ok(paidThrough(payment({ amount: 1 }), 'campaign-fixture'));
  assert.ok(paidThrough(payment({ recurring: { ...payment().recurring, status: 'canceled' } }), 'campaign-fixture'));
  for (const change of [{ status: 'pending' }, { status: 'failed' }, { amount: 0 }, { campaign_id: 'other' }, { type: 'manual' },
    { refund_status: 'full' }, { refunds: [{ amount: 100 }] }, { dispute: { status: 'open' } }, { recurring: null },
    { recurring: { ...payment().recurring, interval: 'yearly' } }, { created: at() - 40 * 86400 }, { created: at() + 1000 }]) assert.equal(paidThrough(payment(change), 'campaign-fixture'), 0);
});
test('failed renewals cannot extend a benefit; month arithmetic handles leap years and January 31', () => {
  const stamp = value => Date.parse(value) / 1000;
  assert.equal(monthAfter(stamp('2027-01-31T12:00:00Z')), stamp('2027-02-28T12:00:00Z'));
  assert.equal(monthAfter(stamp('2028-01-31T12:00:00Z')), stamp('2028-02-29T12:00:00Z'));
  assert.equal(paidThrough(payment({ created: stamp('2026-09-01T12:00:00Z'), recurring: { ...payment().recurring, current_period_end: stamp('2026-12-01T12:00:00Z') } }), 'campaign-fixture', stamp('2026-11-01T12:00:00Z')), 0);
});
test('verification is single use, GET-safe, private, and keeps only token hashes', () => withSetup(async s => {
  const v = await verify(s, ' PATRON@example.com ');
  assert.equal(s.emails[0].to, email); assert.match(v.response.headers.get('Set-Cookie'), /HttpOnly; SameSite=Lax; Max-Age=2592000; Secure/);
  assert.equal(v.response.headers.get('Location'), '/store/muscle/?figure=39&size=12x16&frame=none#patron-discount');
  assert.equal(s.db.rows('patron_links').length, 0); assert.notEqual(s.db.rows('patron_sessions')[0].token_hash, v.cookie.split('=')[1]);
  const expired = await route(s, new Request(v.link)); assert.equal(expired.status, 400);
  const r = await route(s, request('/store/patron/status', undefined, v.cookie)); const body = await r.json();
  assert.equal(body.eligible, true); assert.equal(body.email, email); assert.equal(body.percent, 20); assert.match(r.headers.get('Cache-Control'), /no-store/);
  assert.equal(JSON.stringify(body).includes('subscription-fixture'), false);
}));
test('email scanners, expired links, replayed POSTs and cross-origin requests cannot sign in', () => withSetup(async s => {
  await route(s, request('/store/patron/request', { email }));
  const link = s.emails[0].text.match(/https:\/\/\S+/)[0];
  assert.equal((await route(s, new Request(link))).status, 200); assert.equal((await route(s, new Request(link))).status, 200); assert.equal(s.db.rows('patron_sessions').length, 0);
  const req = request('/store/patron/request', { email }); req.headers.set('Origin', 'https://evil.invalid'); assert.equal((await route(s, req)).status, 403);
  await s.db.prepare('UPDATE patron_links SET expires_at=0').run(); assert.equal((await route(s, new Request(link))).status, 400);
  const v = await verify(s);
  const replay = new Request(origin + '/store/patron/verify', { method: 'POST', headers: { Origin: origin }, body: new URLSearchParams({ token: v.token }) });
  assert.equal((await route(s, replay)).status, 400); assert.equal(s.db.rows('patron_sessions').length, 1);
}));
test('anonymous responses do not expose membership; durable email and IP limits stop repeated sends', () => withSetup(async s => {
  s.setPayments([]);
  const r = await route(s, request('/store/patron/status')); assert.deepEqual(await r.json(), { verified: false, eligible: false, percent: 20 }); assert.equal(s.calls.length, 0);
  for (let i = 0; i < 5; i++) assert.equal((await route(s, request('/store/patron/request', { email }))).status, 200);
  assert.equal(s.emails.length, 3); assert.equal(s.calls.length, 0); assert.equal(s.db.rows('patron_limits')[0].key, await patronHash('email:' + email));
  s.env.PATRON_LIMIT = { limit: async () => ({ success: false }) };
  assert.equal((await route(s, request('/store/patron/request', { email: 'other@example.com' }))).status, 429);
}));
test('privacy-preserving browser form POSTs work; cross-site form posts and invalid bodies fail', () => withSetup(async s => {
  await route(s, request('/store/patron/request', { email }));
  const token = new URL(s.emails[0].text.match(/https:\/\/\S+/)[0]).searchParams.get('token');
  const submit = site => new Request(origin + '/store/patron/verify', { method: 'POST', headers: { Origin: 'null', 'Sec-Fetch-Site': site }, body: new URLSearchParams({ token }) });
  assert.equal((await route(s, submit('cross-site'))).status, 403);
  assert.equal((await route(s, submit('same-origin'))).status, 303);
  assert.equal((await route(s, request('/store/patron/request', { email: 'invalid' }))).status, 400);
  assert.equal((await route(s, request('/store/patron/request', { email, extra: 'x'.repeat(3000) }))).status, 400);
  assert.equal((await route(s, request('/store/patron/status', {}, undefined, 'POST'))).status, 405);
}));
test('a failed email send removes the unusable link, and a 30-day session expires', () => withSetup(async s => {
  const v = await verify(s);
  await s.db.prepare('UPDATE patron_sessions SET expires_at=0').run();
  assert.equal((await (await route(s, request('/store/patron/status', undefined, v.cookie))).json()).verified, false);
  s.env.COMMISSION_EMAIL.send = async () => { throw Error('Fixture sender failure'); };
  assert.equal((await route(s, request('/store/patron/request', { email }))).status, 503);
  assert.equal(s.db.rows('patron_links').length, 0);
}));
test('Zeffy filters are scoped to the verified email and campaign; provider failures are not eligibility', () => withSetup(async s => {
  assert.equal((await findPatron(s.env, email)).eligible, true);
  const queries = s.calls.map(c => c.url);
  assert.equal(queries[0].searchParams.get('email'), email); assert.equal(queries[1].searchParams.get('campaign'), 'campaign-fixture'); assert.equal(queries[1].searchParams.get('contact'), 'contact-fixture');
  s.setContactEmail('other@example.com'); assert.equal((await findPatron(s.env, email)).eligible, false);
  s.setContactEmail(email); s.setPayments([payment({ contact: 'other' })]); assert.equal((await findPatron(s.env, email)).eligible, false);
  s.setUnavailable(true); await assert.rejects(() => findPatron(s.env, email), /membership_unavailable/);
}));
test('verified patrons get exactly 20% off the poster, with full shipping and immutable checkout amounts', () => withSetup(async s => {
  const v = await verify(s), response = await quote(s, v.cookie), q = await response.json();
  assert.equal(response.status, 200); assert.equal(q.priceCents, 2320); assert.equal(q.originalPriceCents, 2900); assert.equal(q.discountCents, 580); assert.equal(q.shippingCents, 530);
  const row = s.db.rows('store_orders')[0]; assert.equal(row.price_cents, 2900); assert.equal(row.discount_percent, 20); assert.equal(row.patron_email_hash, await patronHash(email));
  await createStoreCheckout(s.env, row);
  const form = new URLSearchParams(s.calls.find(c => c.url.pathname === '/v1/checkout/sessions').body);
  assert.equal(form.get('line_items[0][price_data][unit_amount]'), '2320'); assert.equal(form.get('shipping_options[0][shipping_rate_data][fixed_amount][amount]'), '530');
  assert.match(form.get('line_items[0][price_data][product_data][description]'), /20% monthly patron discount/);
  const paid = { id: 'cs_live_fixture', client_reference_id: row.id, metadata: { store_order_id: row.id }, mode: 'payment', currency: 'usd', livemode: true, payment_status: 'paid',
    amount_subtotal: 2320, amount_total: 2892, total_details: { amount_shipping: 530, amount_discount: 0, amount_tax: 42 }, automatic_tax: { status: 'complete' }, payment_intent: 'pi_fixture' };
  await assert.rejects(() => settleStoreCheckout(s.env, { ...paid, amount_total: 1 }), /payment_mismatch/);
  await settleStoreCheckout(s.env, paid); await settleStoreCheckout(s.env, paid);
  assert.equal(s.calls.filter(c => c.url.pathname === '/v4/orders').length, 1); assert.equal(s.db.rows('store_orders')[0].paid_total_cents, 2892);
}));
test('unverified email, changed delivery email and forged discount fields cannot lower the price', () => withSetup(async s => {
  let response = await quote(s, undefined, address, { discountPercent: 100, discountCents: 2900, patronEmail: email });
  assert.equal((await response.json()).priceCents, 2900);
  const v = await verify(s);
  response = await quote(s, v.cookie, { ...address, email: 'different@example.com' }); assert.equal((await response.json()).discountCents, 0);
  s.setPayments([]); response = await quote(s, v.cookie); assert.equal((await response.json()).discountCents, 0);
}));
test('a Zeffy outage stops a verified patron quote instead of silently charging full price', () => withSetup(async s => {
  const v = await verify(s); s.setUnavailable(true);
  const response = await quote(s, v.cookie); assert.notEqual(response.status, 200); assert.match((await response.json()).error, /patron discount/); assert.equal(s.db.rows('store_orders').length, 0);
}));
test('logout revokes the session, cleanup removes expired private records, and redirects stay local', () => withSetup(async s => {
  const v = await verify(s);
  const response = await route(s, request('/store/patron/logout', {}, v.cookie)); assert.match(response.headers.get('Set-Cookie'), /Max-Age=0/);
  assert.equal((await (await route(s, request('/store/patron/status', undefined, v.cookie))).json()).verified, false);
  await route(s, request('/store/patron/request', { email, returnTo: 'https://evil.invalid/' })); assert.equal(s.db.rows('patron_links')[0].return_path, '/store/muscle/#patron-discount');
  await cleanupPatrons(s.env, at() + 31 * 86400);
  assert.equal(s.db.rows('patron_links').length, 0); assert.equal(s.db.rows('patron_sessions').length, 0); assert.equal(s.db.rows('patron_limits').length, 0);
}));
