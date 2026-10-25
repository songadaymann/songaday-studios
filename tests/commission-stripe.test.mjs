// Paying for a commission: the pay form, Checkout, the webhook, monthly plans that end by
// themselves, and idempotency. Stripe is a fake that answers like the REST API.
import assert from 'node:assert/strict';
import test from 'node:test';
import { STRIPE_VERSION } from '../commission-config.mjs';
import { runCommissionDaily } from '../commission.mjs';
import { PHASE_UPDATE_FIELDS, formEncode, verifyStripeSignature } from '../commission-stripe.mjs';
import { LOCAL, call, commissionEnv, deliver, fakeFetch, makeRequest, signStripe, urlencoded } from './fake-cloudflare.mjs';

const SECRET = 'whsec_test_secret';
const KEY = 'rk_test_key';

// The phase fields the schedule update takes, copied from docs.stripe.com/api/subscription_schedules/
// update (phases). The create endpoint also takes currency; the update refuses it.
const UPDATE_PHASE_FIELDS = ['add_invoice_items', 'application_fee_percent', 'automatic_tax', 'billing_cycle_anchor',
  'billing_thresholds', 'collection_method', 'default_payment_method', 'default_tax_rates', 'description', 'discounts',
  'duration', 'end_date', 'invoice_settings', 'items', 'metadata', 'on_behalf_of', 'proration_behavior', 'start_date',
  'transfer_data', 'trial', 'trial_end'];
const phaseFields = (form) => [...new Set([...form.keys()].map((key) => /^phases\[\d+\]\[([^\]]+)\]/.exec(key)?.[1]).filter(Boolean))];

// A stateful stand-in for the parts of Stripe's API the Worker uses.
function fakeStripe() {
  const state = { sessions: new Map(), subscriptions: new Map(), schedules: new Map(), fail: null, count: 0 };
  const route = [(entry) => entry.url.startsWith('https://api.stripe.com/v1/'), (entry) => {
    const { pathname } = new URL(entry.url);
    const path = pathname.replace('/v1', '');
    if (state.fail?.(entry, path)) return new Response(JSON.stringify({ error: { type: 'api_error', code: 'boom' } }), { status: 500 });
    let match;
    if (entry.method === 'POST' && path === '/checkout/sessions') {
      const id = `cs_test_${++state.count}`;
      return { id, object: 'checkout.session', url: `https://checkout.stripe.com/c/pay/${id}` };
    }
    if (entry.method === 'GET' && (match = /^\/checkout\/sessions\/(.+)$/.exec(path))) return state.sessions.get(match[1]) ?? new Response('{}', { status: 404 });
    if (entry.method === 'GET' && (match = /^\/subscriptions\/(.+)$/.exec(path))) {
      const subscription = state.subscriptions.get(match[1]) ?? { id: match[1], status: 'active', schedule: null };
      return { ...subscription, schedule: subscription.schedule ? state.schedules.get(subscription.schedule) : null };
    }
    if (entry.method === 'DELETE' && (match = /^\/subscriptions\/(.+)$/.exec(path))) {
      if (state.subscriptions.get(match[1])?.status === 'canceled') {
        return new Response(JSON.stringify({ error: { type: 'invalid_request_error', code: 'resource_missing' } }), { status: 404 });
      }
      state.subscriptions.set(match[1], { id: match[1], status: 'canceled', schedule: null });
      return { id: match[1], status: 'canceled' };
    }
    if (entry.method === 'POST' && path === '/subscription_schedules') {
      const sub = entry.form.get('from_subscription');
      const id = `sub_sched_${sub.slice(4)}`;
      const schedule = {
        id, object: 'subscription_schedule', end_behavior: 'release', subscription: sub,
        phases: [{
          start_date: 1793750400, end_date: 1796428800, currency: 'usd', collection_method: 'charge_automatically',
          default_payment_method: 'pm_card_visa', description: 'Song commission #1: 6 monthly payments of $83.34',
          invoice_settings: null, default_tax_rates: [], metadata: {}, billing_cycle_anchor: null,
          items: [{ price: { id: `price_inline_${sub.slice(4)}` }, quantity: 1, metadata: {} }]
        }]
      };
      state.schedules.set(id, schedule);
      state.subscriptions.set(sub, { id: sub, status: 'active', schedule: id });
      return schedule;
    }
    if (entry.method === 'POST' && (match = /^\/subscription_schedules\/([^/]+)\/cancel$/.exec(path))) return { id: match[1], status: 'canceled' };
    if (entry.method === 'POST' && (match = /^\/subscription_schedules\/([^/]+)$/.exec(path))) {
      // Like Stripe: one parameter it doesn't take fails the whole update.
      const unknown = phaseFields(entry.form).filter((field) => !UPDATE_PHASE_FIELDS.includes(field));
      if (unknown.length) {
        return new Response(JSON.stringify({ error: { type: 'invalid_request_error', code: 'parameter_unknown', param: `phases[0][${unknown[0]}]` } }), { status: 400 });
      }
      const schedule = state.schedules.get(match[1]);
      schedule.end_behavior = entry.form.get('end_behavior');
      return schedule;
    }
    return new Response('{}', { status: 404 });
  }];
  return { state, stub: fakeFetch([route]) };
}

const stripeCalls = (stub) => stub.calls.filter((entry) => entry.url.startsWith('https://api.stripe.com/'))
  .map((entry) => `${entry.method} ${new URL(entry.url).pathname}`);

// A delivered request, ready to pay.
async function delivered(overrides = {}, answers = {}) {
  const env = await commissionEnv({ STRIPE_SECRET_KEY: KEY, STRIPE_WEBHOOK_SECRET: SECRET, ...overrides });
  const request = await makeRequest(env, answers);
  await deliver(env, request.id);
  return { env, ...request };
}

const pay = (env, token, fields, stub) => call(env, `/commission/s/${token}/pay`, urlencoded(fields), stub);

function session({ id = 'cs_test_paid1', requestId = 1, plan = 'once', amount = 30000, months, subscription = null, invoice = null,
  status = 'complete', payment_status = 'paid', reference = requestId } = {}) {
  return {
    id, object: 'checkout.session', status, payment_status, currency: 'usd', amount_total: amount,
    client_reference_id: String(reference), subscription, invoice,
    metadata: { commission_id: String(requestId), plan, ...(months ? { months: String(months) } : {}) }
  };
}

function invoice({ id, requestId = 1, subscription = 'sub_plan1', amount = 8334, months = 6 }) {
  return {
    id, object: 'invoice', amount_paid: amount, currency: 'usd',
    parent: { type: 'subscription_details', subscription_details: { subscription, metadata: { commission_id: String(requestId), months: String(months) } } }
  };
}

let eventCount = 0;
async function webhook(env, type, object, stub, { secret = SECRET, t, mutate } = {}) {
  const body = JSON.stringify({ id: `evt_${++eventCount}`, type, data: { object } });
  const signature = signStripe(body, secret, t);
  const sent = mutate ? mutate(body) : body;
  return call(env, '/commission/stripe', {
    method: 'POST', body: sent, headers: { 'Stripe-Signature': signature, 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(sent)) }
  }, stub);
}

const payments = (env) => env.COMMISSIONS_DB.rows('payments');
const emails = (env, kind) => env.COMMISSIONS_DB.rows('outbox', `kind = '${kind}'`);

test('the pay form refuses amounts below the floor, odd plans and early extras, without calling Stripe', async () => {
  const { env, token } = await delivered();
  const business = await makeRequest(env, { kind: 'business', email: 'biz@example.com', story: 'A theme song for our podcast about maps.' });
  await deliver(env, business.id);
  const cases = [
    [token, { plan: 'once', amount: '199' }, /The least you can pay is \$200\./],
    [token, { plan: 'once', amount: 'other', other: '150' }, /The least you can pay is \$200\./],
    [token, { plan: '3', amount: '199' }, /The least you can pay is \$200\./],
    [business.token, { plan: 'once', amount: 'other', other: '1,499' }, /The least you can pay is \$1,500\./],
    [token, { plan: '4', amount: '300' }, /Pick how you want to pay/],
    [token, { plan: '24', amount: '300' }, /Pick how you want to pay/],
    [token, { plan: 'extra', amount: '50' }, /Pay for the song first/],
    [token, { plan: 'once', amount: '300.50' }, /whole dollars/],
    [token, { plan: 'once', amount: 'other', other: '' }, /whole dollars/],
    [token, { plan: 'once', amount: '60000' }, /The most I can take here is \$50,000/]
  ];
  for (const [which, fields, message] of cases) {
    const { stub } = fakeStripe();
    const response = await pay(env, which, fields, stub);
    assert.equal(response.status, 400, JSON.stringify(fields));
    const html = await response.text();
    assert.match(html, message, JSON.stringify(fields));
    // At the top, where the reloaded page opens, not below the lyrics.
    assert.ok(html.indexOf('role="alert"') < html.indexOf('<audio'), JSON.stringify(fields));
    assert.equal(stub.calls.length, 0, JSON.stringify(fields));
  }
  // Not delivered yet (or pulled back with Undo delivery while their tab was open): nothing to
  // pay for, and the page says why.
  const waiting = await makeRequest(env, { email: 'w@example.com', story: 'Still waiting in line for a song about frogs.' });
  const { stub } = fakeStripe();
  const early = await pay(env, waiting.token, { plan: 'once', amount: '300' }, stub);
  assert.equal(early.status, 400);
  assert.match(await early.text(), /role="alert">Your song isn’t ready to pay for yet\./);
  assert.equal(stub.calls.length, 0);
  // No Stripe key: the page says so.
  const off = await pay({ ...env, STRIPE_SECRET_KEY: '' }, token, { plan: 'once', amount: '300' }, stub);
  assert.equal(off.status, 503);
  assert.match(await off.text(), /Payments aren’t set up yet/);
});

test('paying once sends Checkout exactly these parameters, and goes there', async () => {
  const { env, token, id } = await delivered();
  const { stub } = fakeStripe();
  const response = await pay(env, token, { plan: 'once', amount: '500' }, stub);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('Location'), 'https://checkout.stripe.com/c/pay/cs_test_1');
  assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
  const [checkout] = stub.calls;
  assert.equal(checkout.url, 'https://api.stripe.com/v1/checkout/sessions');
  assert.equal(checkout.headers.get('Authorization'), `Bearer ${KEY}`);
  assert.equal(checkout.headers.get('Stripe-Version'), STRIPE_VERSION);
  assert.equal(checkout.headers.get('Content-Type'), 'application/x-www-form-urlencoded');
  const page = `https://songaday.studio/commission/s/${token}`;
  const params = Object.fromEntries(checkout.form);
  // An hour, so a tab left open on Checkout can't pay for a song pulled back since.
  assert.ok(Math.abs(Number(params.expires_at) - (Date.now() / 1000 + 3600)) < 60, params.expires_at);
  delete params.expires_at;
  assert.deepEqual(params, {
    success_url: `${page}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${page}#pay`,
    client_reference_id: String(id),
    customer_email: 'pat@example.com',
    submit_type: 'pay',
    mode: 'payment',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': '50000',
    'line_items[0][price_data][product_data][name]': 'A song by Jonathan Mann',
    'line_items[0][quantity]': '1',
    'payment_intent_data[description]': `Song commission #${id}`,
    'payment_intent_data[metadata][commission_id]': String(id),
    'metadata[commission_id]': String(id),
    'metadata[plan]': 'once'
  });
  // Nothing is stored until money arrives.
  assert.equal(payments(env).length, 0);
  assert.deepEqual(env.COMMISSION_LIMIT.calls.at(-1), { key: `pay:${token}` });
});

test('paying over six months is a subscription of the total over six, rounded up', async () => {
  const { env, token, id } = await delivered();
  const { stub } = fakeStripe();
  await pay(env, token, { plan: '6', amount: '500' }, stub);
  const form = stub.calls[0].form;
  assert.equal(form.get('mode'), 'subscription');
  assert.equal(form.get('line_items[0][price_data][recurring][interval]'), 'month');
  assert.equal(form.get('line_items[0][price_data][unit_amount]'), '8334');
  assert.equal(form.get('line_items[0][price_data][product_data][name]'), 'A song by Jonathan Mann (6 monthly payments)');
  assert.equal(form.get('custom_text[submit][message]'), '6 payments of $83.34, one a month. They stop by themselves after the last one.');
  assert.equal(form.get('subscription_data[metadata][commission_id]'), String(id));
  assert.equal(form.get('subscription_data[metadata][months]'), '6');
  assert.equal(form.get('subscription_data[description]'), `Song commission #${id}: 6 monthly payments of $83.34`);
  assert.equal(form.get('metadata[plan]'), 'installments');
  assert.equal(form.get('metadata[months]'), '6');
  // Stripe answers 400 to submit_type 'pay' in subscription mode, so plans leave the button alone.
  assert.equal(form.get('submit_type'), null);
  assert.equal(form.get('payment_intent_data[description]'), null);

  // $200 over 12 rounds up to $16.67 a month, $200.04 in all: at or above the floor.
  const { stub: twelve } = fakeStripe();
  const response = await pay(env, token, { plan: '12', amount: '200' }, twelve);
  assert.equal(response.status, 303);
  assert.equal(twelve.calls[0].form.get('line_items[0][price_data][unit_amount]'), '1667');
});

test('webhook signatures are checked on the exact bytes, within five minutes', async () => {
  const { env } = await delivered();
  const object = { id: 'evt_obj' };
  assert.equal((await webhook(env, 'ping', object)).status, 200);
  assert.equal((await webhook(env, 'ping', object, null, { secret: 'whsec_wrong' })).status, 400);
  assert.equal((await webhook(env, 'ping', object, null, { mutate: (body) => body.replace('ping', 'pinG') })).status, 400);
  assert.equal((await webhook(env, 'ping', object, null, { t: Math.floor(Date.now() / 1000) - 301 })).status, 400);
  assert.equal((await webhook(env, 'ping', object, null, { t: Math.floor(Date.now() / 1000) - 299 })).status, 200);

  const body = JSON.stringify({ id: 'evt_two', type: 'ping', data: { object } });
  const good = signStripe(body, SECRET).split(',')[1];
  const t = Math.floor(Date.now() / 1000);
  const twoValues = `t=${t},v1=${'0'.repeat(64)},${signStripe(body, SECRET, t).split(',')[1]}`;
  assert.ok(good);
  const response = await call(env, '/commission/stripe', { method: 'POST', body, headers: { 'Stripe-Signature': twoValues, 'Content-Length': String(body.length) } });
  assert.equal(response.status, 200);
  assert.equal((await call(env, '/commission/stripe', { method: 'POST', body, headers: { 'Content-Length': String(body.length) } })).status, 400);

  const noSecret = await webhook({ ...env, STRIPE_WEBHOOK_SECRET: '' }, 'ping', object);
  assert.equal(noSecret.status, 503);
});

test('a byte that isn’t valid UTF-8, signed as sent, still verifies', async () => {
  const raw = new Uint8Array([...Buffer.from('{"id":"evt_x","type":"ping","note":"'), 0xff, ...Buffer.from('"}')]);
  const t = Math.floor(Date.now() / 1000);
  assert.equal(await verifyStripeSignature(raw, signStripe(raw, SECRET, t), SECRET, t), true);
  const { env } = await delivered();
  const response = await call(env, '/commission/stripe', { method: 'POST', body: raw, headers: { 'Stripe-Signature': signStripe(raw, SECRET, t), 'Content-Length': String(raw.length) } });
  assert.equal(response.status, 200);
});

test('a one-off payment is recorded once, however many times Stripe says so', async () => {
  const { env, token, id } = await delivered();
  const { stub } = fakeStripe();
  const paid = session({ requestId: id });
  assert.equal((await webhook(env, 'checkout.session.completed', paid, stub)).status, 200);
  assert.deepEqual(payments(env).map((row) => [row.kind, row.amount_cents, row.method, row.ref]), [['once', 30000, 'stripe', 'cs_test_paid1']]);
  const row = env.COMMISSIONS_DB.one('SELECT status, paid_at FROM requests WHERE id = ?', id);
  assert.equal(row.status, 'delivered');
  assert.ok(row.paid_at);
  const [email] = emails(env, 'paid');
  assert.equal(email.subject, `Thank you. Your song is ready to download (request ${id})`);
  assert.match(email.text, /I got your payment of \$300\. You can download "Siobhan at Forty" from your page now:/);

  await webhook(env, 'checkout.session.completed', paid, stub);
  await webhook(env, 'checkout.session.async_payment_succeeded', paid, stub);
  assert.equal(payments(env).length, 1);
  assert.equal(emails(env, 'paid').length, 1);
  assert.equal((await call(env, `/commission/s/${token}/download`)).status, 200);

  // The return trip, then the webhook; and both at once.
  for (const together of [false, true]) {
    const other = await delivered();
    const { state, stub: stripeStub } = fakeStripe();
    const done = session({ id: 'cs_test_return', requestId: other.id });
    state.sessions.set(done.id, done);
    const trip = () => call(other.env, `/commission/s/${other.token}?session_id=${done.id}`, {}, stripeStub);
    const hook = () => webhook(other.env, 'checkout.session.completed', done, stripeStub);
    if (together) await Promise.all([trip(), hook()]);
    else {
      const response = await trip();
      assert.equal(response.status, 303);
      assert.equal(response.headers.get('Location'), `/commission/s/${other.token}#paid`);
      await hook();
    }
    assert.equal(payments(other.env).length, 1, `together: ${together}`);
    assert.equal(emails(other.env, 'paid').length, 1, `together: ${together}`);
    assert.deepEqual(stripeCalls(stripeStub), ['GET /v1/checkout/sessions/cs_test_return']);
  }
});

test('a session is ignored unless it belongs to this request, is complete, paid, and in dollars', async () => {
  const { env, token, id } = await delivered();
  const other = await makeRequest(env, { email: 'o@example.com', story: 'Another request entirely, about a llama.' });
  const { state, stub } = fakeStripe();
  const cases = [
    session({ requestId: id, reference: other.id }),
    session({ requestId: id, status: 'open', payment_status: 'unpaid' }),
    { ...session({ requestId: id }), currency: 'eur' },
    session({ requestId: 999 })
  ];
  for (const object of cases) await webhook(env, 'checkout.session.completed', object, stub);
  // Someone with this link replaying another request's session.
  const theirs = session({ id: 'cs_test_theirs', requestId: other.id });
  state.sessions.set(theirs.id, theirs);
  await call(env, `/commission/s/${token}?session_id=${theirs.id}`, {}, stub);
  assert.equal(payments(env).length, 0);

  // A bank payment still clearing: the page says it's on its way.
  const clearing = session({ id: 'cs_test_clearing', requestId: id, payment_status: 'unpaid' });
  state.sessions.set(clearing.id, clearing);
  const response = await call(env, `/commission/s/${token}?session_id=${clearing.id}`, {}, stub);
  assert.equal(response.headers.get('Location'), `/commission/s/${token}?pending#pay`);
  assert.match(await (await call(env, `/commission/s/${token}?pending`)).text(), /Your payment is on its way\. The download unlocks as soon as it clears\./);
  await webhook(env, 'checkout.session.async_payment_succeeded', { ...clearing, payment_status: 'paid' }, stub);
  assert.equal(payments(env).length, 1);
});

test('an archived, unpaid request can still be paid', async () => {
  const { env, token, id } = await delivered();
  env.COMMISSIONS_DB.exec("UPDATE requests SET archived_at = '2026-10-23T00:00:00Z' WHERE id = ?", id);
  const { stub } = fakeStripe();
  assert.equal((await pay(env, token, { plan: 'once', amount: '300' }, stub)).status, 303);
  await webhook(env, 'checkout.session.completed', session({ requestId: id }), stub);
  assert.equal((await call(env, `/commission/s/${token}/download`)).status, 200);
});

test('a monthly plan records its first payment, then gets a schedule that ends it after six months', async () => {
  const { env, token, id } = await delivered();
  const { stub } = fakeStripe();
  const plan = session({ id: 'cs_test_plan', requestId: id, plan: 'installments', amount: 8334, months: 6, subscription: 'sub_plan1', invoice: 'in_first' });
  assert.equal((await webhook(env, 'checkout.session.completed', plan, stub)).status, 200);
  assert.deepEqual(payments(env).map((row) => [row.kind, row.amount_cents, row.ref, row.subscription_id]), [['installment', 8334, 'in_first', 'sub_plan1']]);
  const [row] = env.COMMISSIONS_DB.rows('plans');
  assert.equal(row.months, 6);
  assert.equal(row.monthly_cents, 8334);
  assert.equal(row.schedule_id, 'sub_sched_plan1');
  assert.equal(row.status, 'active');
  assert.deepEqual(stripeCalls(stub), ['GET /v1/subscriptions/sub_plan1', 'POST /v1/subscription_schedules', 'POST /v1/subscription_schedules/sub_sched_plan1']);
  assert.equal(new URL(stub.calls[0].url).searchParams.get('expand[]'), 'schedule');
  assert.equal(stub.calls[1].form.get('from_subscription'), 'sub_plan1');
  assert.equal(stub.calls[1].headers.get('Idempotency-Key'), 'plan-sub_plan1-schedule');
  const update = stub.calls[2].form;
  assert.equal(update.get('end_behavior'), 'cancel');
  assert.equal(update.get('proration_behavior'), 'none');
  assert.equal(update.get('phases[0][duration][interval]'), 'month');
  assert.equal(update.get('phases[0][duration][interval_count]'), '6');
  assert.equal(update.get('phases[0][start_date]'), '1793750400');
  assert.equal(update.get('phases[0][items][0][price]'), 'price_inline_plan1');
  assert.equal(update.get('phases[0][items][0][quantity]'), '1');
  assert.equal(update.get('phases[0][default_payment_method]'), 'pm_card_visa');
  assert.equal(update.get('phases[0][description]'), 'Song commission #1: 6 monthly payments of $83.34');
  assert.equal(update.get('phases[0][metadata][commission_id]'), String(id));
  assert.equal(update.get('phases[0][end_date]'), null);
  assert.equal(update.get('phases[0][currency]'), null, 'the update refuses currency');
  for (const field of phaseFields(update)) assert.ok(PHASE_UPDATE_FIELDS.has(field) && UPDATE_PHASE_FIELDS.includes(field), field);

  const [thanks] = emails(env, 'paid');
  assert.match(thanks.text, /I got your first payment of \$83\.34\. The other 5 come out once a month and stop by themselves after the last one\./);
  const html = await (await call(env, `/commission/s/${token}`)).text();
  assert.match(html, /1 of 6 monthly payments of \$83\.34 made/);
  assert.match(html, /Stop the rest of my payments\?/);
  assert.equal((await call(env, `/commission/s/${token}/download`)).status, 200);

  // A replay makes no Stripe calls.
  stub.calls.length = 0;
  await webhook(env, 'checkout.session.completed', plan, stub);
  assert.deepEqual(stripeCalls(stub), []);
  assert.equal(payments(env).length, 1);

  // A try that failed between the two schedule calls is finished by the retry: only the update.
  const half = await delivered();
  const halfStripe = fakeStripe();
  halfStripe.state.fail = (entry, path) => entry.method === 'POST' && path.startsWith('/subscription_schedules/');
  const halfPlan = session({ id: 'cs_test_half', requestId: half.id, plan: 'installments', amount: 8334, months: 6, subscription: 'sub_half', invoice: 'in_half' });
  assert.equal((await webhook(half.env, 'checkout.session.completed', halfPlan, halfStripe.stub)).status, 500);
  assert.equal(payments(half.env).length, 1, 'the money is recorded before the schedule');
  halfStripe.state.fail = null;
  halfStripe.stub.calls.length = 0;
  assert.equal((await webhook(half.env, 'checkout.session.completed', halfPlan, halfStripe.stub)).status, 200);
  assert.deepEqual(stripeCalls(halfStripe.stub), ['GET /v1/subscriptions/sub_half', 'POST /v1/subscription_schedules/sub_sched_half']);
  assert.equal(payments(half.env).length, 1);
  assert.equal(half.env.COMMISSIONS_DB.one('SELECT schedule_id FROM plans').schedule_id, 'sub_sched_half');
});

async function planWithInvoices(order) {
  const { env, token, id } = await delivered();
  const { stub } = fakeStripe();
  const plan = session({ id: 'cs_test_plan', requestId: id, plan: 'installments', amount: 8334, months: 6, subscription: 'sub_plan1', invoice: 'in_1' });
  const invoices = [1, 2, 3, 4, 5, 6].map((n) => invoice({ id: `in_${n}`, requestId: id }));
  await order({ env, stub, plan, invoices });
  return { env, token, id, stub };
}

test('six monthly payments: six rows, and one last-payment email on the sixth, in any order', async () => {
  const orders = {
    'session first': async ({ env, stub, plan, invoices }) => {
      await webhook(env, 'checkout.session.completed', plan, stub);
      for (const item of invoices) await webhook(env, 'invoice.paid', item, stub);
    },
    'first invoice before the session': async ({ env, stub, plan, invoices }) => {
      await webhook(env, 'invoice.paid', invoices[0], stub);
      await webhook(env, 'checkout.session.completed', plan, stub);
      for (const item of invoices.slice(1)) await webhook(env, 'invoice.paid', item, stub);
    },
    'fifth and sixth at once': async ({ env, stub, plan, invoices }) => {
      await webhook(env, 'checkout.session.completed', plan, stub);
      for (const item of invoices.slice(1, 4)) await webhook(env, 'invoice.paid', item, stub);
      await Promise.all([webhook(env, 'invoice.paid', invoices[4], stub), webhook(env, 'invoice.paid', invoices[5], stub)]);
    }
  };
  for (const [name, order] of Object.entries(orders)) {
    const { env } = await planWithInvoices(order);
    assert.deepEqual(payments(env).map((row) => row.ref).sort(), ['in_1', 'in_2', 'in_3', 'in_4', 'in_5', 'in_6'], name);
    assert.ok(payments(env).every((row) => row.kind === 'installment' && row.subscription_id === 'sub_plan1'), name);
    assert.equal(emails(env, 'paid').length, 1, name);
    const finished = emails(env, 'plan-finished');
    assert.equal(finished.length, 1, name);
    assert.match(finished[0].text, /That was the last of your 6 payments for "Siobhan at Forty"\. Nothing more will be charged\./);
    assert.equal(env.COMMISSIONS_DB.rows('plans').length, 1, name);
  }

  const { env, stub, token } = await planWithInvoices(orders['session first']);
  await webhook(env, 'customer.subscription.deleted', { id: 'sub_plan1', object: 'subscription' }, stub);
  assert.equal(env.COMMISSIONS_DB.one('SELECT status FROM plans').status, 'finished');
  assert.match(await (await call(env, `/commission/s/${token}`)).text(), /All 6 monthly payments are done\. Thank you\./);
});

test('a plan that ends after two payments is stopped, and the download stays unlocked', async () => {
  const { env, token, stub } = await planWithInvoices(async ({ env, stub, plan, invoices }) => {
    await webhook(env, 'checkout.session.completed', plan, stub);
    await webhook(env, 'invoice.paid', invoices[1], stub);
  });
  await webhook(env, 'customer.subscription.deleted', { id: 'sub_plan1', object: 'subscription' }, stub);
  assert.equal(env.COMMISSIONS_DB.one('SELECT status FROM plans').status, 'stopped');
  assert.equal(emails(env, 'plan-finished').length, 0);
  assert.equal((await call(env, `/commission/s/${token}/download`)).status, 200);
  assert.match(await (await call(env, `/commission/s/${token}`)).text(), /Your monthly payments are stopped\. The song is still yours\./);
});

test('stopping a plan cancels its schedule without prorating, or deletes the subscription when there is none', async () => {
  const { env, token, stub } = await planWithInvoices(async ({ env, stub, plan }) => {
    await webhook(env, 'checkout.session.completed', plan, stub);
  });
  stub.calls.length = 0;
  const response = await call(env, `/commission/s/${token}`, urlencoded({ action: 'stop-plan' }), stub);
  assert.equal(response.status, 303);
  assert.deepEqual(stripeCalls(stub), ['POST /v1/subscription_schedules/sub_sched_plan1/cancel']);
  assert.equal(stub.calls[0].form.get('invoice_now'), 'false');
  assert.equal(stub.calls[0].form.get('prorate'), 'false');
  assert.equal(env.COMMISSIONS_DB.one('SELECT status FROM plans').status, 'stopped');
  // Stripe's own event afterwards agrees.
  await webhook(env, 'customer.subscription.deleted', { id: 'sub_plan1' }, stub);
  assert.equal(env.COMMISSIONS_DB.one('SELECT status FROM plans').status, 'stopped');

  const bare = await delivered();
  bare.env.COMMISSIONS_DB.exec(`INSERT INTO plans (subscription_id, request_id, months, monthly_cents, started_at) VALUES ('sub_bare', ?, 3, 10000, '2026-10-23T00:00:00Z')`, bare.id);
  const { stub: bareStub } = fakeStripe();
  await call(bare.env, `/commission/s/${bare.token}`, urlencoded({ action: 'stop-plan' }), bareStub);
  assert.deepEqual(stripeCalls(bareStub), ['DELETE /v1/subscriptions/sub_bare']);
  assert.equal(bare.env.COMMISSIONS_DB.one('SELECT status FROM plans').status, 'stopped');
});

test('two plans started from two tabs each get their own schedule', async () => {
  const { env, id } = await delivered();
  const { stub } = fakeStripe();
  await webhook(env, 'checkout.session.completed', session({ id: 'cs_test_tab1', requestId: id, plan: 'installments', amount: 10000, months: 3, subscription: 'sub_tab1', invoice: 'in_tab1' }), stub);
  await webhook(env, 'checkout.session.completed', session({ id: 'cs_test_tab2', requestId: id, plan: 'installments', amount: 10000, months: 3, subscription: 'sub_tab2', invoice: 'in_tab2' }), stub);
  assert.deepEqual(env.COMMISSIONS_DB.rows('plans').map((plan) => [plan.subscription_id, plan.schedule_id]), [['sub_tab1', 'sub_sched_tab1'], ['sub_tab2', 'sub_sched_tab2']]);
});

test('unknown events, and events with no commission, change nothing', async () => {
  const { env } = await delivered();
  const { stub } = fakeStripe();
  for (const [type, object] of [
    ['charge.refunded', { id: 'ch_1' }],
    ['checkout.session.completed', { id: 'cs_test_other', status: 'complete', payment_status: 'paid', metadata: {} }],
    ['invoice.paid', { id: 'in_other', amount_paid: 500, currency: 'usd', parent: null }],
    ['invoice.paid', invoice({ id: 'in_unknown', requestId: 999 })],
    ['customer.subscription.deleted', { id: 'sub_unknown' }]
  ]) {
    const response = await webhook(env, type, object, stub);
    assert.equal(response.status, 200, type);
  }
  assert.equal(payments(env).length, 0);
  assert.equal(stub.calls.length, 0);
});

test('a Stripe error on the schedule fails the webhook after the payment is recorded, and the retry finishes it', async () => {
  const { env, id } = await delivered();
  const { state, stub } = fakeStripe();
  state.fail = (entry, path) => path === '/subscription_schedules';
  const plan = session({ id: 'cs_test_plan', requestId: id, plan: 'installments', amount: 8334, months: 6, subscription: 'sub_plan1', invoice: 'in_1' });
  assert.equal((await webhook(env, 'checkout.session.completed', plan, stub)).status, 500);
  assert.equal(payments(env).length, 1);
  assert.equal(env.COMMISSIONS_DB.one('SELECT schedule_id FROM plans').schedule_id, null);
  state.fail = null;
  assert.equal((await webhook(env, 'checkout.session.completed', plan, stub)).status, 200);
  assert.equal(payments(env).length, 1);
  assert.equal(emails(env, 'paid').length, 1);
  assert.equal(env.COMMISSIONS_DB.one('SELECT schedule_id FROM plans').schedule_id, 'sub_sched_plan1');
});

test('after paying, "pay what it was worth" takes any extra amount', async () => {
  const { env, token, id } = await delivered();
  const { stub } = fakeStripe();
  await webhook(env, 'checkout.session.completed', session({ requestId: id }), stub);
  const html = await (await call(env, `/commission/s/${token}`)).text();
  assert.match(html, /Pay what it was worth/);
  assert.match(html, /Did the song mean more than you paid\? You can add any amount\./);
  assert.match((await (await pay(env, token, { plan: 'once', amount: '300' }, stub)).text()), /already paid/);
  stub.calls.length = 0;
  const response = await pay(env, token, { plan: 'extra', amount: '75' }, stub);
  assert.equal(response.status, 303);
  const form = stub.calls[0].form;
  assert.equal(form.get('mode'), 'payment');
  assert.equal(form.get('metadata[plan]'), 'extra');
  assert.equal(form.get('line_items[0][price_data][product_data][name]'), 'Extra for your song from Jonathan Mann');
  assert.equal(form.get('line_items[0][price_data][unit_amount]'), '7500');
  await webhook(env, 'checkout.session.completed', session({ id: 'cs_test_extra', requestId: id, plan: 'extra', amount: 7500 }), stub);
  assert.deepEqual(payments(env).map((row) => row.kind), ['once', 'extra']);
  const [thanks] = emails(env, 'extra-thanks');
  assert.match(thanks.text, /I got your extra \$75 for "Siobhan at Forty"\. Thank you\. It means a lot\./);
  assert.match(await (await call(env, `/commission/s/${token}`)).text(), /You’ve paid \$375\./);
});

test('nothing sent to Stripe names the recipient or says donate, gift or patron', async () => {
  const { env, token } = await delivered({}, { recipient: 'Siobhan Q. Recipient' });
  const { stub } = fakeStripe();
  for (const fields of [{ plan: 'once', amount: '300' }, { plan: '3', amount: '300' }, { plan: '12', amount: '1000' }]) {
    await pay(env, token, fields, stub);
  }
  env.COMMISSIONS_DB.exec("UPDATE requests SET paid_at = '2026-10-23T00:00:00Z'");
  await pay(env, token, { plan: 'extra', amount: '20' }, stub);
  assert.equal(stub.calls.length, 4);
  for (const entry of stub.calls) {
    const text = decodeURIComponent(entry.body);
    assert.doesNotMatch(text, /Siobhan|Recipient/);
    assert.doesNotMatch(text, /donat|gift|tax-deductible|patron/i);
    assert.doesNotMatch(entry.form.get('submit_type') ?? '', /donate/);
  }
});

test('form encoding nests the way Stripe reads it', () => {
  assert.equal(decodeURIComponent(formEncode({ a: { b: [{ c: 1 }, { d: 'x y' }] }, skip: null, n: false }).toString()),
    'a[b][0][c]=1&a[b][1][d]=x+y&n=false');
});

test('a schedule that arrives late still ends the plan after its last month', async () => {
  const { env, stub, state } = await (async () => {
    const made = await delivered();
    const fake = fakeStripe();
    // The restricted key lacks the schedule permission for the first two months.
    fake.state.fail = (entry, path) => path.startsWith('/subscription_schedules');
    const plan = session({ id: 'cs_test_late', requestId: made.id, plan: 'installments', amount: 8334, months: 6, subscription: 'sub_late', invoice: 'in_1' });
    assert.equal((await webhook(made.env, 'checkout.session.completed', plan, fake.stub)).status, 500);
    assert.equal((await webhook(made.env, 'invoice.paid', invoice({ id: 'in_2', requestId: made.id, subscription: 'sub_late' }), fake.stub)).status, 500);
    fake.state.fail = null;
    fake.stub.calls.length = 0;
    assert.equal((await webhook(made.env, 'invoice.paid', invoice({ id: 'in_3', requestId: made.id, subscription: 'sub_late' }), fake.stub)).status, 200);
    return { ...made, ...fake };
  })();
  assert.equal(payments(env).length, 3);
  const update = stub.calls.find((entry) => /\/subscription_schedules\/sub_sched_late$/.test(new URL(entry.url).pathname)).form;
  // Payments 3, 4, 5 and 6 are left, counting this period's: four months from here.
  assert.equal(update.get('phases[0][duration][interval_count]'), '4');
  assert.equal(env.COMMISSIONS_DB.one('SELECT schedule_id FROM plans').schedule_id, 'sub_sched_late');
  assert.equal(state.schedules.get('sub_sched_late').end_behavior, 'cancel');
});

test('the daily run ends a plan whose payments are all in but has no schedule, and the summary says so until then', async () => {
  const { env, id } = await delivered();
  const { state, stub } = fakeStripe();
  // A Stripe outage that outlasts the webhook's retries.
  state.fail = (entry, path) => path.startsWith('/subscription_schedules') || entry.method === 'DELETE';
  await webhook(env, 'checkout.session.completed', session({ id: 'cs_test_all', requestId: id, plan: 'installments', amount: 10000, months: 3, subscription: 'sub_all', invoice: 'in_a1' }), stub);
  for (const n of [2, 3]) await webhook(env, 'invoice.paid', invoice({ id: `in_a${n}`, requestId: id, subscription: 'sub_all', amount: 10000, months: 3 }), stub);
  env.COMMISSIONS_DB.exec("UPDATE plans SET started_at = '2026-08-01T00:00:00Z'");

  // Still failing: the summary flags it, the page says it's done.
  const realFetch = globalThis.fetch;
  globalThis.fetch = stub.fetch;
  try {
    await runCommissionDaily(env, new Date('2026-11-03T14:00:00Z'));
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.match(env.COMMISSIONS_DB.one("SELECT text FROM outbox WHERE kind = 'summary'").text, new RegExp(`#${id} has a monthly plan with no end set`));
  const admin = await (await call(env, '/commission/admin?show=plans', {}, null, LOCAL)).text();
  assert.match(admin, /NO END SET/);

  // Fixed: every payment is in, so the subscription is cancelled now rather than scheduled.
  state.fail = null;
  stub.calls.length = 0;
  globalThis.fetch = stub.fetch;
  try {
    await runCommissionDaily(env, new Date('2026-11-04T14:00:00Z'));
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.deepEqual(stripeCalls(stub), ['GET /v1/subscriptions/sub_all', 'DELETE /v1/subscriptions/sub_all']);
  await webhook(env, 'customer.subscription.deleted', { id: 'sub_all', object: 'subscription' }, stub);
  assert.equal(env.COMMISSIONS_DB.one('SELECT status FROM plans').status, 'finished');
});

test('once the last monthly payment is in, the page says it’s done and offers no stop', async () => {
  const { env, token } = await planWithInvoices(async ({ env, stub, plan, invoices }) => {
    await webhook(env, 'checkout.session.completed', plan, stub);
    for (const item of invoices.slice(1)) await webhook(env, 'invoice.paid', item, stub);
  });
  assert.equal(env.COMMISSIONS_DB.one('SELECT status FROM plans').status, 'active', 'Stripe ends it a month later');
  const html = await (await call(env, `/commission/s/${token}`)).text();
  assert.match(html, /All 6 monthly payments are done\. Thank you\./);
  assert.doesNotMatch(html, /Stop the rest of my payments/);
});

test('stopping a plan Stripe already ended records that instead of failing', async () => {
  const { env, token, stub, id } = await planWithInvoices(async ({ env, stub, plan }) => {
    await webhook(env, 'checkout.session.completed', plan, stub);
  });
  env.COMMISSIONS_DB.exec('UPDATE plans SET schedule_id = NULL');
  // Stripe ended it, and its customer.subscription.deleted never arrived.
  await stub.fetch('https://api.stripe.com/v1/subscriptions/sub_plan1', { method: 'DELETE' });
  stub.calls.length = 0;
  const response = await call(env, `/commission/s/${token}`, urlencoded({ action: 'stop-plan' }), stub);
  assert.equal(response.status, 303);
  assert.deepEqual(stripeCalls(stub), ['DELETE /v1/subscriptions/sub_plan1', 'GET /v1/subscriptions/sub_plan1']);
  assert.equal(env.COMMISSIONS_DB.one('SELECT status FROM plans WHERE request_id = ?', id).status, 'stopped');
});

test('the return trip calls Stripe only for a delivered song, within the link’s rate limit', async () => {
  const { env, token, id } = await delivered();
  const { state, stub } = fakeStripe();
  const done = session({ id: 'cs_test_trip', requestId: id });
  state.sessions.set(done.id, done);
  env.COMMISSION_LIMIT.limit = async () => ({ success: false });
  let response = await call(env, `/commission/s/${token}?session_id=${done.id}`, {}, stub);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('Location'), `/commission/s/${token}#pay`);
  assert.equal(stub.calls.length, 0, 'limited');

  env.COMMISSION_LIMIT.limit = async () => ({ success: true });
  const waiting = await makeRequest(env, { email: 'w@example.com', story: 'Still in line, about a heron called Bill.' });
  response = await call(env, `/commission/s/${waiting.token}?session_id=cs_test_whatever`, {}, stub);
  assert.equal(response.status, 303);
  assert.equal(stub.calls.length, 0, 'not delivered');
});

test('a payment for a song pulled back with Undo delivery is recorded and flagged, with no email', async () => {
  const { env, id } = await delivered();
  await call(env, `/commission/admin/${id}`, urlencoded({ action: 'undeliver' }, { Origin: LOCAL }), null, LOCAL);
  const { stub } = fakeStripe();
  await webhook(env, 'checkout.session.completed', session({ requestId: id }), stub);
  assert.equal(payments(env).length, 1);
  assert.equal(emails(env, 'paid').length, 0);
  env.COMMISSIONS_DB.exec("UPDATE payments SET paid_at = '2026-11-03T13:00:00.000Z'");
  await runCommissionDaily(env, new Date('2026-11-03T14:00:00Z'));
  assert.match(env.COMMISSIONS_DB.one("SELECT text FROM outbox WHERE kind = 'summary'").text, new RegExp(`#${id} was paid while it was back in line`));
});

test('a webhook body is counted as it arrives: a chunked one past 1 MB is refused unread', async () => {
  const { env } = await delivered();
  let pulled = 0;
  const body = new ReadableStream({
    pull(controller) {
      pulled++;
      if (pulled > 40) return controller.close();
      controller.enqueue(new Uint8Array(64 * 1024));
    }
  });
  const response = await call(env, '/commission/stripe', { method: 'POST', body, duplex: 'half', headers: { 'Stripe-Signature': 't=1,v1=00' } });
  assert.equal(response.status, 413);
  assert.ok(pulled < 40, `stopped after ${pulled} chunks`);
  const declared = await call(env, '/commission/stripe', { method: 'POST', body: '{}', headers: { 'Content-Length': String(2 * 1024 * 1024) } });
  assert.equal(declared.status, 413);
});

test('stopping a plan from the page emails the buyer, since anyone with the link can press it', async () => {
  const { env, token } = await planWithInvoices(async ({ env, stub, plan, invoices }) => {
    await webhook(env, 'checkout.session.completed', plan, stub);
    await webhook(env, 'invoice.paid', invoices[1], stub);
  });
  const { stub } = fakeStripe();
  await call(env, `/commission/s/${token}`, urlencoded({ action: 'stop-plan' }), stub);
  const [stopped] = emails(env, 'plan-stopped');
  assert.match(stopped.subject, /^Your monthly payments are stopped \(request \d+\)$/);
  assert.match(stopped.text, /2 of 6 went through\. Nothing more will be charged\./);
  assert.match(stopped.text, /If you didn't stop them, reply and tell me\./);
  const [paid] = emails(env, 'paid');
  assert.match(paid.text, /Keep that link to yourself/);
  assert.match(paid.text, /\/commission\/share\/[0-9a-f]{32}/);
});


test('a refused payment comes back with the buyer’s own choice, and the choices say "or more"', async () => {
  const { env, token } = await delivered();
  const { stub } = fakeStripe();
  let html = await (await call(env, `/commission/s/${token}`)).text();
  assert.match(html, /value="1000"> \$1,000 or more<\/label>/);
  assert.match(html, /placeholder="200 or more"/);
  assert.match(html, /value="300" checked/);
  assert.match(html, /value="once" checked/);
  // The lyrics come before the pay box, so a phone shows them under the player.
  assert.ok(html.indexOf('id="lyrics-title"') < html.indexOf('id="pay-title"'));
  assert.match(html, /If you spread it out, the download unlocks after the first payment/);

  const response = await pay(env, token, { plan: '6', amount: 'other', other: '150' }, stub);
  assert.equal(response.status, 400);
  html = await response.text();
  assert.match(html, /The least you can pay is \$200\./);
  assert.match(html, /value="6" checked/);
  assert.doesNotMatch(html, /value="once" checked|value="300" checked/);
  assert.match(html, /value="other" checked/);
  assert.match(html, /name="other"[^>]*value="150"/);
  const kept = await (await pay(env, token, { plan: '3', amount: '500' }, (() => { const f = fakeStripe(); f.state.fail = () => true; return f.stub; })())).text();
  assert.match(kept, /value="3" checked/);
  assert.match(kept, /value="500" checked/);
});
