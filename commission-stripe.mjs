// Payments for songaday.studio/commission, on Jonathan's own Stripe account. Plain fetch to the
// REST API (no SDK), pinned to one API version. Amounts come from our page and go to Checkout as
// price_data, so nothing has to exist in Stripe ahead of time:
// - Stripe's own pay-what-you-want (a Price with custom_unit_amount) can't recur, takes one
//   preset instead of three suggestions, and needs a Price made ahead for every floor.
// - Paying over time is a Checkout subscription that a subscription schedule ends after N
//   months (duration + end_behavior=cancel), Stripe's own installment-plan recipe. Checkout's
//   subscription_data has no end date, and cancel_at would need our own month arithmetic.
// Every fact is written once: payments.ref, plans.subscription_id and outbox.once_key are unique
// and written with ON CONFLICT DO NOTHING, so a replayed webhook, or the return trip racing
// it, changes nothing.
import { AMOUNT_MAX_CENTS, EXTRA_MIN_CENTS, PLAN_MONTHS, STRIPE_VERSION } from './commission-config.mjs';
import { dollars, later, loadRequest, pageUrl } from './commission-core.mjs';
import { flushOutbox, queueEmail } from './commission-email.mjs';

export const SESSION_ID = /^cs_(?:test|live)_[A-Za-z0-9]{1,240}$/;
const SUBSCRIPTION_ID = /^sub_[A-Za-z0-9]{1,250}$/;
const INVOICE_ID = /^in_[A-Za-z0-9]{1,250}$/;
const SCHEDULE_ID = /^sub_sched_[A-Za-z0-9]{1,250}$/;
const TOLERANCE_SECONDS = 300;

export class StripeError extends Error {
  constructor(status, type, code) {
    super(`Stripe answered ${status}${type ? ` (${type}${code ? `, ${code}` : ''})` : ''}`);
    this.status = status;
    this.type = type;
    this.code = code;
  }
}

// {a: {b: [{c: 1}]}} → a[b][0][c]=1, the way Stripe reads form bodies.
export function formEncode(params, prefix = '', out = new URLSearchParams()) {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (typeof value === 'object') formEncode(value, name, out);
    else out.append(name, String(value));
  }
  return out;
}

// One Stripe call. Errors keep only the status, type and code, never the request.
export async function stripe(env, method, path, params, idempotencyKey) {
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Stripe-Version': STRIPE_VERSION,
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {})
    },
    body: params ? formEncode(params).toString() : undefined,
    signal: AbortSignal.timeout(10000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new StripeError(response.status, body.error?.type, body.error?.code);
  return body;
}

const id = (value, pattern) => {
  if (typeof value !== 'string' || !pattern.test(value)) throw new Error('not a Stripe id');
  return encodeURIComponent(value);
};

// What this request can pay right now, or why not. amount is in cents.
export function paymentProblem(request, { plan, amount }, { activePlan = false } = {}) {
  if (request.status !== 'delivered') return 'Your song isn’t ready to pay for yet.';
  if (!Number.isInteger(amount)) return 'Type an amount in whole dollars.';
  if (amount > AMOUNT_MAX_CENTS) return `The most I can take here is ${dollars(AMOUNT_MAX_CENTS)}. Email me for more.`;
  if (plan === 'extra') {
    if (!request.paid_at) return 'Pay for the song first, then you can add more.';
    if (amount < EXTRA_MIN_CENTS) return `The least you can add is ${dollars(EXTRA_MIN_CENTS)}.`;
    return null;
  }
  if (request.paid_at) return 'You’ve already paid for this song. Thank you!';
  if (activePlan) return 'Your monthly payments have already started.';
  if (plan === 'once') return amount < request.floor_cents ? `The least you can pay is ${dollars(request.floor_cents)}.` : null;
  const months = Number(plan);
  if (!PLAN_MONTHS.includes(months)) return 'Pick how you want to pay.';
  if (Math.ceil(amount / months) * months < request.floor_cents) return `The least you can pay is ${dollars(request.floor_cents)}.`;
  return null;
}

// The monthly amount and real total for a plan: $500 over 6 is 6 × $83.34 = $500.04.
export const planAmounts = (amount, months) => ({ monthly: Math.ceil(amount / months), total: Math.ceil(amount / months) * months });

// A Checkout Session for one payment, a monthly plan, or an extra. Product names are generic,
// so the recipient's name never goes to Stripe, and nothing says donate, gift or patron.
export function checkoutParams(env, request, { plan, amount }) {
  const page = pageUrl(env, request);
  const common = {
    success_url: `${page}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${page}#pay`,
    client_reference_id: String(request.id),
    customer_email: request.buyer_email,
    submit_type: 'pay'
  };
  if (plan === 'once' || plan === 'extra') {
    return {
      ...common,
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'usd',
          unit_amount: amount,
          product_data: { name: plan === 'extra' ? 'Extra for your song from Jonathan Mann' : 'A song by Jonathan Mann' }
        },
        quantity: 1
      }],
      payment_intent_data: {
        description: `Song commission #${request.id}${plan === 'extra' ? ' (extra)' : ''}`,
        metadata: { commission_id: String(request.id) }
      },
      metadata: { commission_id: String(request.id), plan }
    };
  }
  const months = Number(plan);
  const { monthly } = planAmounts(amount, months);
  // Checkout shows a subscription as "$x per month" with no end, which reads like a membership.
  // The product name and the line above the button say it ends.
  return {
    ...common,
    mode: 'subscription',
    line_items: [{
      price_data: {
        currency: 'usd',
        unit_amount: monthly,
        recurring: { interval: 'month' },
        product_data: { name: `A song by Jonathan Mann (${months} monthly payments)` }
      },
      quantity: 1
    }],
    custom_text: { submit: { message: `${months} payments of ${dollars(monthly)}, one a month. They stop by themselves after the last one.` } },
    subscription_data: {
      description: `Song commission #${request.id}: ${months} monthly payments of ${dollars(monthly)}`,
      metadata: { commission_id: String(request.id), months: String(months) }
    },
    metadata: { commission_id: String(request.id), plan: 'installments', months: String(months) }
  };
}

export const createCheckout = (env, request, choice) =>
  stripe(env, 'POST', '/checkout/sessions', checkoutParams(env, request, choice));

// Statements for the caller's db.batch: the payment, paid_at (the first payment unlocks the
// download), and the email that announces it, all keyed so a repeat changes nothing.
// A payment on a cancelled request is still recorded, since the money is real; the daily
// summary flags it for a refund, and the buyer isn't told to go download.
export function recordPayment(env, request, payment) {
  const db = env.COMMISSIONS_DB;
  const now = (payment.now ?? new Date()).toISOString();
  const statements = [
    db.prepare(`INSERT INTO payments (request_id, kind, amount_cents, method, ref, subscription_id, note, paid_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (ref) DO NOTHING`)
      .bind(request.id, payment.kind, payment.amount, payment.method ?? 'stripe', payment.ref,
        payment.subscription ?? null, payment.note ?? '', now),
    db.prepare('UPDATE requests SET paid_at = COALESCE(paid_at, ?) WHERE id = ?').bind(now, request.id)
  ];
  const notCancelled = "(SELECT status FROM requests WHERE id = ?) != 'cancelled'";
  const email = (kind, data) => statements.push(queueEmail(env, kind, request, { now: payment.now, ...data }));
  if (payment.kind === 'once' || (payment.kind === 'manual' && payment.email)) {
    email('paid', { amount: payment.amount, onceKey: `paid:${payment.ref}`, when: notCancelled, whenArgs: [request.id] });
  } else if (payment.kind === 'extra') {
    email('extra-thanks', { amount: payment.amount, onceKey: `paid:${payment.ref}`, when: notCancelled, whenArgs: [request.id] });
  } else if (payment.kind === 'installment') {
    // The first payment of a plan gets the thank-you, the last one says it's over, and the ones
    // between get only Stripe's receipt. Both counts run inside the batch, after the insert,
    // so two invoices landing at once can't both miss the last one.
    const count = '(SELECT COUNT(*) FROM payments WHERE subscription_id = ?)';
    email('paid', {
      amount: payment.amount, months: payment.months, onceKey: `paid:${payment.ref}`,
      when: `${notCancelled} AND ${count} = 1`, whenArgs: [request.id, payment.subscription]
    });
    email('plan-finished', {
      months: payment.months, onceKey: `plan-finished:${payment.subscription}`,
      when: `${count} >= ?`, whenArgs: [payment.subscription, payment.months]
    });
  }
  return statements.filter(Boolean);
}

// The same code for the return trip from Checkout and for the webhook. Returns 'paid',
// 'pending' (a bank payment still clearing, or a plan whose first invoice hasn't arrived) or
// 'ignored'. With `request`, the session must belong to it: someone with one buyer link can't
// replay another request's session id.
export async function settleCheckoutSession(env, session, { request = null, ctx } = {}) {
  const commissionId = Number(session?.metadata?.commission_id);
  if (!Number.isInteger(commissionId) || commissionId <= 0) return 'ignored';
  if (String(session.client_reference_id) !== String(commissionId)) return 'ignored';
  if (request && request.id !== commissionId) return 'ignored';
  const target = request ?? await loadRequest(env.COMMISSIONS_DB, commissionId);
  if (!target) return 'ignored';
  if (session.status !== 'complete' || session.currency !== 'usd') return 'ignored';
  if (session.payment_status !== 'paid') return session.payment_status === 'unpaid' ? 'pending' : 'ignored';

  const plan = session.metadata.plan;
  if (plan === 'once' || plan === 'extra') {
    if (!(session.amount_total > 0)) return 'ignored';
    await env.COMMISSIONS_DB.batch(recordPayment(env, target, { kind: plan, ref: session.id, amount: session.amount_total }));
    await later(ctx, flushOutbox(env, { requestId: target.id }));
    return 'paid';
  }
  if (plan === 'installments') {
    return settlePlanPayment(env, target, {
      subscription: session.subscription,
      invoice: typeof session.invoice === 'string' ? session.invoice : session.invoice?.id ?? null,
      amount: session.amount_total,
      months: Number(session.metadata.months)
    }, ctx);
  }
  return 'ignored';
}

// One monthly payment, from the return trip or invoice.paid, whichever arrives first. Money is
// recorded before any further Stripe call, so a Stripe hiccup can't hold up the download.
export async function settlePlanPayment(env, request, payment, ctx) {
  const { subscription, invoice, amount, months } = payment;
  if (typeof subscription !== 'string' || !SUBSCRIPTION_ID.test(subscription)) return 'ignored';
  if (!PLAN_MONTHS.includes(months) || !(amount > 0)) return 'ignored';
  if (invoice !== null && !INVOICE_ID.test(invoice)) return 'ignored';
  const db = env.COMMISSIONS_DB;
  const now = payment.now ?? new Date();
  const statements = [
    db.prepare(`INSERT INTO plans (subscription_id, request_id, months, monthly_cents, started_at)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT (subscription_id) DO NOTHING`)
      .bind(subscription, request.id, months, amount, now.toISOString())
  ];
  // Stripe documents the Session's invoice only "if it exists". Without one, invoice.paid
  // (seconds later) records the payment.
  if (invoice) statements.push(...recordPayment(env, request, { kind: 'installment', ref: invoice, amount, subscription, months, now }));
  await db.batch(statements);
  await later(ctx, flushOutbox(env, { requestId: request.id }));
  await ensurePlanSchedule(env, subscription);
  return invoice ? 'paid' : 'pending';
}

// The schedule update unsets any current-phase field it leaves out ("Stripe unsets omitted
// parameters"), so the price, quantity and start date go back, and so does every other field
// set on the phase. Dropping default_payment_method would leave months 2 to N with no card.
const idOf = (value) => typeof value === 'string' ? value : value?.id;
const CARRIED = ['default_payment_method', 'description', 'collection_method', 'currency', 'on_behalf_of',
  'billing_cycle_anchor', 'application_fee_percent'];

export function scheduleUpdate(schedule, plan) {
  const phase = schedule.phases[0];
  const carried = {};
  for (const field of CARRIED) {
    const value = idOf(phase[field]) ?? (typeof phase[field] === 'number' ? phase[field] : null);
    if (value !== null && value !== undefined) carried[field] = value;
  }
  if (phase.invoice_settings?.days_until_due != null) carried.invoice_settings = { days_until_due: phase.invoice_settings.days_until_due };
  if (phase.default_tax_rates?.length) carried.default_tax_rates = phase.default_tax_rates.map(idOf);
  if (phase.transfer_data?.destination) carried.transfer_data = { destination: idOf(phase.transfer_data.destination), amount_percent: phase.transfer_data.amount_percent ?? undefined };
  return {
    end_behavior: 'cancel',
    proration_behavior: 'none',
    phases: [{
      ...carried,
      start_date: phase.start_date,
      items: phase.items.map((item) => ({ price: idOf(item.price), quantity: item.quantity ?? 1 })),
      duration: { interval: 'month', interval_count: plan.months },
      metadata: { ...phase.metadata, commission_id: String(plan.request_id), months: String(plan.months) }
    }]
  };
}

// Makes sure a plan's subscription ends by itself after its last month. It works from Stripe's
// own state, not idempotency keys alone: those last 24 hours, webhook retries go on for three
// days, and a second from_subscription on a subscription with a schedule is an error.
export async function ensurePlanSchedule(env, subscriptionId) {
  const db = env.COMMISSIONS_DB;
  const plan = await db.prepare('SELECT * FROM plans WHERE subscription_id = ?').bind(subscriptionId).first();
  if (!plan || plan.schedule_id || plan.status !== 'active') return plan;
  const sub = id(subscriptionId, SUBSCRIPTION_ID);
  const subscription = await stripe(env, 'GET', `/subscriptions/${sub}?expand%5B%5D=schedule`);
  if (subscription.status === 'canceled') return plan;
  let schedule = subscription.schedule ?? null;
  if (typeof schedule === 'string') schedule = await stripe(env, 'GET', `/subscription_schedules/${id(schedule, SCHEDULE_ID)}`);
  if (!schedule) {
    schedule = await stripe(env, 'POST', '/subscription_schedules', { from_subscription: subscriptionId }, `plan-${subscriptionId}-schedule`);
  }
  // Just made, or left by a try that failed between the two calls.
  if (schedule.end_behavior !== 'cancel') {
    schedule = await stripe(env, 'POST', `/subscription_schedules/${id(schedule.id, SCHEDULE_ID)}`, scheduleUpdate(schedule, plan));
  }
  await db.prepare('UPDATE plans SET schedule_id = ? WHERE subscription_id = ? AND schedule_id IS NULL')
    .bind(schedule.id, subscriptionId).run();
  return { ...plan, schedule_id: schedule.id };
}

// The buyer stops the rest of their monthly payments (honor system: the song stays theirs).
export async function stopPlan(env, plan, now = new Date()) {
  if (plan.schedule_id) {
    // Both default to true here, which would credit unused time and raise a final invoice.
    await stripe(env, 'POST', `/subscription_schedules/${id(plan.schedule_id, SCHEDULE_ID)}/cancel`, { invoice_now: false, prorate: false });
  } else {
    await stripe(env, 'DELETE', `/subscriptions/${id(plan.subscription_id, SUBSCRIPTION_ID)}`);
  }
  await env.COMMISSIONS_DB.prepare(`UPDATE plans SET status = 'stopped', ended_at = ? WHERE subscription_id = ? AND status = 'active'`)
    .bind(now.toISOString(), plan.subscription_id).run();
}

const utf8 = (text) => new TextEncoder().encode(text);
const hexBytes = (hex) => Uint8Array.from(hex.match(/../g), (pair) => parseInt(pair, 16));

// Stripe-Signature: "t=1730000000,v1=ab12…,v1=…". The bytes are verified as they arrived:
// decoding and re-encoding them could change a stray invalid byte, and fail a genuine event.
// The secret (whsec_...) is used as its own UTF-8 bytes. Several v1 values cover secret rolls.
export async function verifyStripeSignature(raw, header, secret, nowSeconds = Date.now() / 1000) {
  const t = Number(/(?:^|,)\s*t=(\d+)/.exec(header ?? '')?.[1]);
  if (!t || Math.abs(nowSeconds - t) > TOLERANCE_SECONDS) return false;
  const key = await crypto.subtle.importKey('raw', utf8(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const prefix = utf8(`${t}.`);
  const signed = new Uint8Array(prefix.length + raw.length);
  signed.set(prefix);
  signed.set(raw, prefix.length);
  for (const [, hex] of (header ?? '').matchAll(/(?:^|,)\s*v1=([0-9a-f]{64})/g)) {
    // crypto.subtle.verify compares in constant time.
    if (await crypto.subtle.verify('HMAC', key, hexBytes(hex), signed)) return true;
  }
  return false;
}

// POST /commission/stripe. Logs carry only the event type, its id and the outcome.
export async function handleStripeWebhook(request, env, ctx) {
  if (!env.STRIPE_WEBHOOK_SECRET || !env.COMMISSIONS_DB) return new Response('Not set up', { status: 503 });
  if (Number(request.headers.get('Content-Length')) > 1024 * 1024) return new Response('Too big', { status: 413 });
  const raw = new Uint8Array(await request.arrayBuffer());
  if (!(await verifyStripeSignature(raw, request.headers.get('Stripe-Signature'), env.STRIPE_WEBHOOK_SECRET))) {
    return new Response('Bad signature', { status: 400 });
  }
  let event;
  try {
    event = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return new Response('Bad body', { status: 400 });
  }
  let outcome = 'ignored';
  try {
    outcome = await handleEvent(env, event, ctx);
  } catch (error) {
    console.log('commission stripe', event.type, event.id, 'error', error instanceof StripeError ? error.status : error?.name);
    return new Response('Try again', { status: 500 });
  }
  console.log('commission stripe', event.type, event.id, outcome);
  return new Response('ok');
}

async function handleEvent(env, event, ctx) {
  const object = event?.data?.object;
  switch (event?.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      return settleCheckoutSession(env, object, { ctx });
    case 'invoice.paid': {
      const details = object?.parent?.subscription_details;
      const commissionId = Number(details?.metadata?.commission_id);
      if (!Number.isInteger(commissionId) || !(object.amount_paid > 0) || object.currency !== 'usd') return 'ignored';
      const request = await loadRequest(env.COMMISSIONS_DB, commissionId);
      if (!request) return 'ignored';
      return settlePlanPayment(env, request, {
        subscription: idOf(details.subscription),
        invoice: object.id,
        amount: object.amount_paid,
        months: Number(details.metadata.months)
      }, ctx);
    }
    case 'customer.subscription.deleted': {
      // Stopped means stopped by the buyer, or by Stripe after failed retries. The download
      // stays unlocked either way: it's the honor system.
      const result = await env.COMMISSIONS_DB.prepare(`UPDATE plans SET status = CASE
          WHEN (SELECT COUNT(*) FROM payments WHERE subscription_id = ?) >= months THEN 'finished' ELSE 'stopped' END,
          ended_at = ? WHERE subscription_id = ? AND status = 'active'`)
        .bind(object?.id, new Date().toISOString(), object?.id).run();
      return result.meta.changes ? 'ended' : 'ignored';
    }
    default:
      return 'ignored';
  }
}
