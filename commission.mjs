// songaday.studio/commission: Jonathan's song commissions. A buyer fills in the request form and
// gets their place in line (#N) and a private page. Each morning a cron emails anyone who moved
// up. Jonathan reads the requests in order on /commission/admin (commission-admin.mjs), and
// delivers each song there. The buyer's page then plays it and shows the lyrics; they pay what
// they want through Stripe (commission-stripe.mjs), once or over months, and paying unlocks the
// download. It's a purchase from Jonathan: nothing here says donate, gift or patron.
//
// Requests are in the D1 database bound as COMMISSIONS_DB (schema in commission-migrations/),
// voice memos and songs in the private R2 bucket bound as COMMISSION_FILES, and emails go
// through the outbox table (commission-email.mjs). See README.md, "Commissions".
import { serveMedia } from './media.mjs';
import { isHuman } from './turnstile.mjs';
import {
  CANCELLED_KEEP_DAYS, D1_QUERY_BUDGET, FORM_MAX_BYTES, INTAKE_ALARM_PER_DAY, LIMITS, MAX_OPEN_PER_EMAIL, MEMO_KEEP_DAYS,
  MEMO_MAX_BYTES, OUTBOX_KEEP_DAYS, PLAN_MONTHS, PRICES, REMINDER_DAYS, VIDEO_PRICE_CENTS
} from './commission-config.mjs';
import {
  IN_LINE, OPEN, TOKEN, cleanLine, cleanText, daysBetween, deadlineWatch, dollars, emailKey, later, lineLength,
  loadByShareToken, loadByToken, newToken, newYorkDate, parseDollars, placeInLine, readForm, shortDate, siteOrigin,
  sniffAudio, transitionProblem, visitorKey
} from './commission-core.mjs';
import { SUBJECT_SQL, claimLapsedBefore, emailParts, flushOutbox, queueEmail } from './commission-email.mjs';
import {
  SESSION_ID, StripeError, createCheckout, ensurePlanSchedule, handleStripeWebhook, paymentProblem, settleCheckoutSession, stopPlan, stripe
} from './commission-stripe.mjs';
import { handleAdmin } from './commission-admin.mjs';
import { BARE_PUBLIC_PAGE, BARE_SONG_SHELL, fillPublicPage, fillShell, messagePage, renderSharePage, renderSongPage } from './commission-page.mjs';

export const COMMISSIONS_DATABASE = 'songaday-commissions';
export const COMMISSION_BUCKET = 'songaday-commissions';

// Where commissions were sold before this page, and where /commission still goes until
// requests open here (COMMISSION_REQUESTS), so there's always a way to buy one.
export const BEFORE_OPENING = 'https://jonathanmann.bandcamp.com/merch';

const BUYER_PATH = /^\/commission\/s\/([0-9a-f]{32})(?:\/(pay|quiet|listen|download))?\/?$/;
const SHARE_PATH = /^\/commission\/share\/([0-9a-f]{32})(?:\/(listen|download))?\/?$/;
const SMALL_FORM = 16 * 1024;
const DUPLICATE_MINUTES = 10;

// ---- Responses ------------------------------------------------------------------------------

const PUBLIC_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-cache',
  'Referrer-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
  // The page's own CSP is a meta tag (build.mjs); frame-ancestors only works as a header.
  'Content-Security-Policy': "frame-ancestors 'none'"
};

// Only for the bare pages below, which have no CSP meta tag: no script at all.
const BARE_CSP = "default-src 'none'; style-src 'unsafe-inline'; media-src 'self'; form-action 'self' https://checkout.stripe.com; base-uri 'none'; frame-ancestors 'none'";

// A buyer's page is private: never cached, never indexed, and the token never leaves in a
// Referer (including to Stripe).
const BUYER_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "frame-ancestors 'none'"
};

const BUYER_MEDIA = {
  cacheControl: 'private, no-store',
  headers: {
    'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': 'sandbox',
    'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer'
  }
};

const respond = (request, body, status, headers) =>
  new Response(request.method === 'HEAD' ? null : body, { status, headers });
const redirect = (location, headers = {}) =>
  new Response(null, { status: 303, headers: { Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', ...headers } });

// A built page through the assets binding (an internal fetch, which run_worker_first doesn't
// send back through the Worker). /commission/ and /commission/song, not .../index.html or
// song.html: under the default html_handling those answer 307s. Without a build, the bare page,
// whose headers then carry the CSP the built page has as a meta tag. Returns { html, headers }.
async function builtPage(env, url, path, fallback, headers) {
  try {
    const response = await env.ASSETS?.fetch(new Request(new URL(path, url)));
    if (response?.ok && response.headers.get('Content-Type')?.includes('text/html')) return { html: await response.text(), headers };
  } catch {
    // fall through to the bare page
  }
  return { html: fallback, headers: { ...headers, 'Content-Security-Policy': BARE_CSP } };
}

async function shellPage(request, env, url, content, status = 200, headers = BUYER_HEADERS) {
  const shell = await builtPage(env, url, '/commission/song', BARE_SONG_SHELL, headers);
  return respond(request, fillShell(shell.html, content), status, shell.headers);
}

const notFound = (request, env, url) => shellPage(request, env, url,
  messagePage('That page isn’t here', 'If you followed a link from one of my emails, check it was copied whole.', '\n<p><a href="/commission">Get a song written for you</a></p>'), 404);

// ---- The public page ------------------------------------------------------------------------

function closedReason(env) {
  if (env.COMMISSION_REQUESTS !== 'open') return 'Requests open soon.';
  if (!env.COMMISSIONS_DB || !env.TURNSTILE_SECRET_KEY) return 'Requests are closed right now. Try again later.';
  return null;
}

async function publicPage(request, env, url) {
  if (env.COMMISSION_REQUESTS !== 'open') {
    return new Response(null, { status: 302, headers: { Location: BEFORE_OPENING, 'Cache-Control': 'no-store' } });
  }
  const page = await builtPage(env, url, '/commission/', BARE_PUBLIC_PAGE, PUBLIC_HEADERS);
  const line = env.COMMISSIONS_DB ? (await lineLength(env.COMMISSIONS_DB)).total : null;
  const filled = fillPublicPage(page.html, { line, closed: closedReason(env), siteKey: env.TURNSTILE_SITE_KEY, sent: url.searchParams.has('sent') });
  return respond(request, filled, 200, page.headers);
}

// ---- Making a request -----------------------------------------------------------------------

// The email must be one plain address: so `to` can only ever name one recipient.
const EMAIL = /^[^\s@,;:<>()[\]"'\\]+@[^\s@,;:<>()[\]"'\\]+\.[^\s@,;:<>()[\]"'\\.]+$/;
const isDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);

export function readAnswers(form) {
  return {
    kind: String(form.get('kind') ?? ''),
    recipient: cleanLine(form.get('recipient')),
    relationship: cleanLine(form.get('relationship')),
    occasion: cleanLine(form.get('occasion')),
    names: cleanText(form.get('names')),
    story: cleanText(form.get('story')),
    leave_out: cleanText(form.get('leave_out')),
    deadline: String(form.get('deadline') ?? '').trim(),
    may_publish: String(form.get('may_publish') ?? ''),
    wants_video: form.get('video') ? 1 : 0,
    buyer_name: cleanLine(form.get('name')),
    buyer_email: String(form.get('email') ?? '').trim().toLowerCase()
  };
}

// Why a request can't go in as written, or null when it can. One plain sentence each.
export function requestProblem(answers, now = new Date()) {
  const tooLong = (value, limit, what) => value.length > limit ? `Keep ${what} under ${limit.toLocaleString('en-US')} characters.` : null;
  if (!['personal', 'business'].includes(answers.kind)) return 'Say whether the song is for a person or a business.';
  if (!answers.recipient) return 'Tell me who the song is for.';
  if (answers.story.length < LIMITS.storyMin) return `Tell me a little more about them (at least ${LIMITS.storyMin} characters).`;
  if (!['yes', 'no'].includes(answers.may_publish)) return 'Say whether it can be that day’s Song A Day.';
  if (!answers.buyer_name) return 'Tell me your name.';
  if (!answers.buyer_email) return 'Tell me your email, so I can send you your song.';
  const problem = tooLong(answers.recipient, LIMITS.recipient, 'who it’s for')
    ?? tooLong(answers.relationship, LIMITS.relationship, 'what they are to you')
    ?? tooLong(answers.occasion, LIMITS.occasion, 'the occasion')
    ?? tooLong(answers.names, LIMITS.names, 'the names')
    ?? tooLong(answers.story, LIMITS.story, 'the story')
    ?? tooLong(answers.leave_out, LIMITS.leave_out, 'what to leave out')
    ?? tooLong(answers.buyer_name, LIMITS.name, 'your name');
  if (problem) return problem;
  // Printable ASCII only: no control or bidi characters, which would reorder the admin's text.
  if (answers.buyer_email.length > LIMITS.email || !EMAIL.test(answers.buyer_email) || !/^[\x21-\x7e]+$/.test(answers.buyer_email)) {
    return 'That email address doesn’t look right. Give one address.';
  }
  if (answers.deadline) {
    if (!isDate(answers.deadline)) return 'Give the deadline as a date.';
    const today = newYorkDate(now);
    if (answers.deadline < today) return 'That deadline has already passed.';
    if (daysBetween(today, answers.deadline) > 731) return 'That deadline is more than two years away. Leave it blank instead.';
  }
  return null;
}

// Makes a request and queues its "received" email in one batch. Returns { id, token, position,
// held }. It's one function so the later monthly song plan can call it too. The new row's id is
// higher than every other, so its place is everyone in line plus one. Two requests at once can
// both count the line before either is in it, so the place is checked again once it's in, and
// the email (not sent yet) corrected. Past INTAKE_ALARM_PER_DAY in 24 hours it's held instead:
// out of line, with an email that repeats nothing they typed, and an alarm to Jonathan.
export async function createRequest(env, answers, { memoKey = null, now = new Date() } = {}) {
  const db = env.COMMISSIONS_DB;
  const token = newToken();
  const floor = PRICES[answers.kind].floor + (answers.wants_video && VIDEO_PRICE_CENTS ? VIDEO_PRICE_CENTS : 0);
  const dayAgo = new Date(now.getTime() - 86_400_000).toISOString();
  const [{ total }, today] = await Promise.all([
    lineLength(db),
    db.prepare('SELECT COUNT(*) AS count FROM requests WHERE requested_at > ?').bind(dayAgo).first('count')
  ]);
  const held = today >= INTAKE_ALARM_PER_DAY;
  const position = total + 1;
  const row = {
    token, share_token: newToken(), status: held ? 'held' : 'requested', kind: answers.kind, floor_cents: floor,
    buyer_name: answers.buyer_name, buyer_email: answers.buyer_email, email_key: emailKey(answers.buyer_email),
    recipient: answers.recipient, relationship: answers.relationship, occasion: answers.occasion, names: answers.names,
    memo_key: memoKey, story: answers.story, leave_out: answers.leave_out, deadline: answers.deadline || null,
    may_publish: answers.may_publish === 'yes' ? 1 : 0, wants_video: answers.wants_video, requested_at: now.toISOString()
  };
  const columns = Object.keys(row);
  const insert = db.prepare(`INSERT INTO requests (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`).bind(...Object.values(row));
  if (held) {
    await db.batch([
      insert,
      queueEmail(env, 'held', row, { now, onceKey: `held:${token}` }),
      queueEmail(env, 'alarm', null, { now, count: today + 1, onceKey: `alarm:${newYorkDate(now)}` })
    ].filter(Boolean));
    const id = await db.prepare('SELECT id FROM requests WHERE token = ?').bind(token).first('id');
    return { id, token, position: null, held: true };
  }
  await db.batch([insert, queueEmail(env, 'received', row, { now, position, onceKey: `received:${token}` })]);
  const id = await db.prepare('SELECT id FROM requests WHERE token = ?').bind(token).first('id');
  const actual = await placeInLine(db, id);
  if (actual !== position) {
    const { subject, text, html } = emailParts(env, 'received', row, { now, position: actual });
    await db.prepare(`UPDATE outbox SET position = ?, subject = ${SUBJECT_SQL}, text = ?, html = ? WHERE once_key = ?
      AND sent_at IS NULL AND claimed_at IS NULL`).bind(actual, subject, token, text, html, `received:${token}`).run();
  }
  return { id, token, position: actual, held: false };
}

async function submit(request, env, url, ctx) {
  const wantsJson = request.headers.get('Accept')?.includes('application/json');
  // Without JavaScript the form posts normally: success goes to the buyer's page, and a problem
  // is a short page (the browser keeps the answers when they go back).
  const reply = (status, error, location) => {
    if (wantsJson) return Response.json(error ? { error } : { ok: true, url: location }, { status, headers: { 'Cache-Control': 'no-store' } });
    if (!error) return redirect(location);
    return shellPage(request, env, url, messagePage('That didn’t go through', error,
      '\n<p>Go back to fix it; your answers are still there.</p>'), status, { ...BUYER_HEADERS, 'Referrer-Policy': 'same-origin' });
  };

  const closed = closedReason(env);
  if (closed) return reply(503, closed);
  // Cheapest checks first. Turnstile is never asked about a request that will be refused.
  const { form, status, error } = await readForm(request, FORM_MAX_BYTES);
  const memoLimit = `The voice memo can be up to ${Math.round(MEMO_MAX_BYTES / 1024 / 1024)} MB.`;
  if (!form) return reply(status, status === 413 ? `That’s too big to send. ${memoLimit}` : error);
  // Bots fill in every field, including this one people can't see.
  if (form.get('website')) return reply(200, null, '/commission');

  const answers = readAnswers(form);
  const now = new Date();
  const problem = requestProblem(answers, now);
  if (problem) return reply(400, problem);
  const memo = form.get('memo');
  let sniffed = null;
  if (memo && typeof memo === 'object' && memo.size > 0) {
    if (memo.size > MEMO_MAX_BYTES) return reply(413, memoLimit);
    sniffed = sniffAudio(new Uint8Array(await memo.slice(0, 12).arrayBuffer()));
    if (!sniffed) return reply(400, 'That voice memo doesn’t look like an audio file. MP3, M4A or WAV, please.');
    if (!env.COMMISSION_FILES) return reply(503, 'Voice memos can’t be sent right now. Leave it off, and spell the names out instead.');
  }

  if (env.COMMISSION_LIMIT) {
    const { success } = await env.COMMISSION_LIMIT.limit({ key: visitorKey(request.headers.get('CF-Connecting-IP')) });
    if (!success) return reply(429, 'Too many at once. Try again in a minute.');
  }
  const db = env.COMMISSIONS_DB;
  // A double click: the same email and story within ten minutes is the request already made.
  // Checked before Turnstile, whose tokens work once, so the second click of a double click
  // lands somewhere friendly instead of a failed human check. It doesn't give out that
  // request's link, though: this check runs before Turnstile, and the link is in their email.
  const since = new Date(now.getTime() - DUPLICATE_MINUTES * 60_000).toISOString();
  const duplicate = await db.prepare(`SELECT 1 FROM requests WHERE buyer_email = ? AND story = ? AND requested_at > ?
    AND status != 'cancelled' LIMIT 1`).bind(answers.buyer_email, answers.story, since).first();
  if (duplicate) return reply(200, null, '/commission?sent#request');

  if (!(await isHuman(env, form.get('cf-turnstile-response'), 'commission'))) {
    return reply(403, 'The human check didn’t go through. Try again.');
  }
  const open = await db.prepare(`SELECT COUNT(*) AS count FROM requests WHERE email_key = ? AND ${OPEN}`)
    .bind(emailKey(answers.buyer_email)).first('count');
  if (open >= MAX_OPEN_PER_EMAIL) {
    const write = env.COMMISSION_REPLY_TO ? `, or write to ${env.COMMISSION_REPLY_TO},` : '';
    return reply(429, `You have ${MAX_OPEN_PER_EMAIL} songs waiting with me already. Reply to one of my emails${write} if you need another.`);
  }

  // The memo goes to R2 after every check passes, just before the insert.
  const memoKey = sniffed ? `memos/${newToken()}.${sniffed.ext}` : null;
  if (memoKey) await env.COMMISSION_FILES.put(memoKey, memo, { httpMetadata: { contentType: sniffed.type } });
  let created;
  try {
    created = await createRequest(env, answers, { memoKey, now });
  } catch (failure) {
    if (memoKey) await env.COMMISSION_FILES.delete(memoKey);
    throw failure;
  }
  console.log('commission request', created.id, created.held ? 'held' : 'in line');
  later(ctx, Promise.all([flushOutbox(env, { requestId: created.id }), created.held ? flushOutbox(env, { kind: 'alarm' }) : null]));
  return reply(200, null, `/commission/s/${created.token}?new`);
}

// ---- The buyer's page -----------------------------------------------------------------------

const stripeReady = (env) => Boolean(env.STRIPE_SECRET_KEY);

async function songPage(request, env, url, r, { status = 200, error = '', choice = null } = {}) {
  const db = env.COMMISSIONS_DB;
  const [{ results: payments }, { results: plans }] = await Promise.all([
    db.prepare('SELECT * FROM payments WHERE request_id = ? ORDER BY id').bind(r.id).all(),
    db.prepare('SELECT * FROM plans WHERE request_id = ? ORDER BY started_at').bind(r.id).all()
  ]);
  const position = ['requested', 'writing'].includes(r.status) ? await placeInLine(db, r.id) : null;
  const content = renderSongPage(r, {
    payments, plans, position, error, choice, stripeReady: stripeReady(env),
    isNew: url.searchParams.has('new'),
    pending: url.searchParams.has('pending') && !r.paid_at
  });
  return shellPage(request, env, url, content, status);
}

// The return from Checkout: settle that session (the same code as the webhook), then show the
// clean page. The id is checked before any Stripe call, or ?session_id=../../customers would
// become a GET elsewhere in Stripe's API under Jonathan's key. Only a delivered song can be
// paid for, and the calls share the buyer link's rate limit, so one link can't be used to
// spend Jonathan's Stripe rate limit; the webhook records the payment either way.
async function returnFromCheckout(env, url, r, ctx) {
  const sessionId = url.searchParams.get('session_id');
  let outcome = 'ignored';
  const allowed = async () => !env.COMMISSION_LIMIT || (await env.COMMISSION_LIMIT.limit({ key: `return:${r.token}` })).success;
  if (SESSION_ID.test(sessionId) && stripeReady(env) && r.status === 'delivered' && await allowed()) {
    try {
      const session = await stripe(env, 'GET', `/checkout/sessions/${encodeURIComponent(sessionId)}`);
      outcome = await settleCheckoutSession(env, session, { request: r, ctx });
    } catch (error) {
      // The money is recorded before any later Stripe call, so the page below is still right.
      console.log('commission return', error instanceof StripeError ? error.status : error?.name);
    }
  }
  const fresh = await loadByToken(env.COMMISSIONS_DB, r.token);
  const path = `/commission/s/${r.token}`;
  return redirect(fresh?.paid_at ? `${path}#paid` : outcome === 'pending' ? `${path}?pending#pay` : `${path}#pay`);
}

async function buyerPost(request, env, url, r, ctx) {
  const { form, status, error } = await readForm(request, SMALL_FORM);
  if (!form) return songPage(request, env, url, r, { status, error });
  const action = form.get('action');
  const db = env.COMMISSIONS_DB;
  const path = `/commission/s/${r.token}`;
  if (action === 'cancel') {
    const problem = transitionProblem(r, 'buyer-cancel');
    if (problem) return shellPage(request, env, url, messagePage('That can’t be cancelled', problem, `\n<p><a href="${path}">Back to your page</a></p>`), 409);
    const at = new Date().toISOString();
    // The email goes in only if this batch's update did (cancelled_at is this moment).
    await db.batch([
      db.prepare(`UPDATE requests SET status = 'cancelled', cancelled_at = ?, cancelled_by = 'buyer' WHERE id = ? AND status IN ('held', 'requested')`).bind(at, r.id),
      queueEmail(env, 'cancelled', r, { by: 'buyer', when: 'EXISTS (SELECT 1 FROM requests WHERE id = ? AND cancelled_at = ?)', whenArgs: [r.id, at] })
    ]);
    later(ctx, flushOutbox(env, { requestId: r.id }));
    return redirect(path);
  }
  if (action === 'updates') {
    await db.prepare('UPDATE requests SET quiet = ? WHERE id = ?').bind(form.get('value') === 'off' ? 1 : 0, r.id).run();
    return redirect(`${path}#updates`);
  }
  if (action === 'stop-plan') {
    const plan = await db.prepare("SELECT * FROM plans WHERE request_id = ? AND status = 'active' ORDER BY started_at DESC LIMIT 1").bind(r.id).first();
    if (plan) {
      if (!stripeReady(env)) return songPage(request, env, url, r, { status: 503, error: 'Payments aren’t set up right now. Reply to any of my emails and I’ll stop them.' });
      let outcome;
      try {
        outcome = await stopPlan(env, plan);
      } catch (failure) {
        console.log('commission stop-plan', failure instanceof StripeError ? failure.status : failure?.name);
        return songPage(request, env, url, r, { status: 502, error: 'That didn’t go through. Try again, or reply to any of my emails.' });
      }
      if (outcome === 'stopped') {
        // Anyone with this link can press it, so the buyer always hears about it.
        const paid = await db.prepare('SELECT COUNT(*) AS count FROM payments WHERE subscription_id = ?').bind(plan.subscription_id).first('count');
        await queueEmail(env, 'plan-stopped', r, { paid, months: plan.months, onceKey: `plan-stopped:${plan.subscription_id}` }).run();
        later(ctx, flushOutbox(env, { requestId: r.id }));
      }
    }
    return redirect(`${path}#paid`);
  }
  return songPage(request, env, url, r, { status: 400, error: 'That didn’t come through. Try again.' });
}

async function buyerPay(request, env, url, r) {
  if (!stripeReady(env)) return songPage(request, env, url, r, { status: 503, error: 'Payments aren’t set up yet. I’ll email you when they are.' });
  const { form, status, error } = await readForm(request, SMALL_FORM);
  if (!form) return songPage(request, env, url, r, { status, error });
  const plan = String(form.get('plan') ?? '');
  const typed = form.get('amount') === 'other' ? form.get('other') : form.get('amount');
  const amount = parseDollars(typed);
  if (!['once', 'extra', ...PLAN_MONTHS.map(String)].includes(plan)) {
    return songPage(request, env, url, r, { status: 400, error: 'Pick how you want to pay.' });
  }
  const activePlan = await env.COMMISSIONS_DB.prepare("SELECT 1 FROM plans WHERE request_id = ? AND status = 'active'").bind(r.id).first();
  const problem = amount === null ? 'Type an amount in whole dollars.' : paymentProblem(r, { plan, amount }, { activePlan: Boolean(activePlan) });
  // The page comes back with what they picked, so a quick second try isn't a different payment.
  if (problem) return songPage(request, env, url, r, { status: 400, error: problem, choice: { plan, amount } });
  if (env.COMMISSION_LIMIT) {
    const { success } = await env.COMMISSION_LIMIT.limit({ key: `pay:${r.token}` });
    if (!success) return songPage(request, env, url, r, { status: 429, error: 'Too many at once. Try again in a minute.' });
  }
  let session;
  try {
    session = await createCheckout(env, r, { plan, amount });
  } catch (failure) {
    console.log('commission checkout', failure instanceof StripeError ? failure.status : failure?.name);
    return songPage(request, env, url, r, { status: 502, error: 'That didn’t go through. Try again in a minute.', choice: { plan, amount } });
  }
  if (typeof session.url !== 'string' || !session.url.startsWith('https://')) {
    return songPage(request, env, url, r, { status: 502, error: 'That didn’t go through. Try again in a minute.', choice: { plan, amount } });
  }
  return redirect(session.url);
}

// "<Title> - Jonathan Mann.mp3", plain ASCII in filename= and the real title in filename*=.
function downloadName(r) {
  const ext = r.audio_key.split('.').pop();
  const name = `${r.title} - Jonathan Mann.${ext}`;
  const ascii = name.normalize('NFKD').replace(/[^\x20-\x7e]/g, '').replace(/["\\/]/g, '').trim() || `Song - Jonathan Mann.${ext}`;
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

async function buyerRoute(request, env, url, ctx, token, sub) {
  const method = request.method;
  const read = method === 'GET' || method === 'HEAD';
  const r = env.COMMISSIONS_DB && TOKEN.test(token) ? await loadByToken(env.COMMISSIONS_DB, token) : null;
  if (!r) return notFound(request, env, url);
  const path = `/commission/s/${token}`;

  if (!sub) {
    if (read) {
      if (url.searchParams.has('session_id')) return returnFromCheckout(env, url, r, ctx);
      return songPage(request, env, url, r);
    }
    if (method === 'POST') return buyerPost(request, env, url, r, ctx);
  } else if (sub === 'pay') {
    if (method === 'POST') return buyerPay(request, env, url, r);
    if (read) return redirect(`${path}#pay`);
  } else if (sub === 'quiet') {
    // One-click unsubscribe (RFC 8058) from the place-in-line email's List-Unsubscribe header.
    if (method === 'POST') {
      await env.COMMISSIONS_DB.prepare('UPDATE requests SET quiet = 1 WHERE id = ?').bind(r.id).run();
      return new Response('<!doctype html><meta charset="utf-8"><title>Done</title><p>Done. No more place-in-line emails. I’ll still email you when your song is done.</p>',
        { headers: BUYER_HEADERS });
    }
    if (read) return redirect(`${path}#updates`);
  } else if (read) {
    // listen and download: only once delivered, never when cancelled; download once paid.
    if (r.status !== 'delivered' || !r.audio_key || !env.COMMISSION_FILES) return notFound(request, env, url);
    if (sub === 'download' && !r.paid_at) return redirect(`${path}#pay`);
    const media = await serveMedia(request, env.COMMISSION_FILES, r.audio_key, {
      ...BUYER_MEDIA,
      disposition: sub === 'download' ? downloadName(r) : 'inline'
    });
    return media ?? notFound(request, env, url);
  }
  const allow = { pay: 'POST', quiet: 'GET, HEAD, POST', listen: 'GET, HEAD', download: 'GET, HEAD' }[sub] ?? 'GET, HEAD, POST';
  return new Response(null, { status: 405, headers: { Allow: allow, 'Cache-Control': 'no-store' } });
}

// The page a buyer passes on: only once delivered, and the download only once paid.
async function shareRoute(request, env, url, token, sub) {
  const read = request.method === 'GET' || request.method === 'HEAD';
  if (!read) return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' } });
  const r = env.COMMISSIONS_DB ? await loadByShareToken(env.COMMISSIONS_DB, token) : null;
  if (!r || r.status !== 'delivered') return notFound(request, env, url);
  if (!sub) return shellPage(request, env, url, renderSharePage(r));
  if (!r.audio_key || !env.COMMISSION_FILES) return notFound(request, env, url);
  if (sub === 'download' && !r.paid_at) return redirect(`/commission/share/${token}`);
  const media = await serveMedia(request, env.COMMISSION_FILES, r.audio_key, {
    ...BUYER_MEDIA,
    disposition: sub === 'download' ? downloadName(r) : 'inline'
  });
  return media ?? notFound(request, env, url);
}

// ---- Routing --------------------------------------------------------------------------------

// Answers everything under /commission, or returns null for other paths.
export async function handleCommission(request, env, url, ctx) {
  const { pathname } = url;
  if (!/^\/+commission(?:\/|$)/i.test(pathname)) return null;
  const tidy = pathname.replace(/\/{2,}/g, '/').toLowerCase();
  // Any spelling of the admin gets the Access check before anything else.
  if (/^\/commission\/admin(?:\/|$)/.test(tidy)) return handleAdmin(request, env, url, ctx);

  const method = request.method;
  if (pathname === '/commission' || pathname === '/commission/') {
    if (method === 'POST') return submit(request, env, url, ctx);
    if (method === 'GET' || method === 'HEAD') return publicPage(request, env, url);
    return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD, POST' } });
  }
  // /Commission, /COMMISSION/ and the like land on the page.
  if (tidy.replace(/\/+$/, '') === '/commission') {
    return new Response(null, { status: 302, headers: { Location: '/commission' + url.search, 'Cache-Control': 'no-store' } });
  }
  if (pathname === '/commission/stripe') {
    if (method === 'POST') return handleStripeWebhook(request, env, ctx);
    return new Response(null, { status: 405, headers: { Allow: 'POST' } });
  }
  const buyer = BUYER_PATH.exec(pathname);
  if (buyer) return buyerRoute(request, env, url, ctx, buyer[1], buyer[2]);
  const shared = SHARE_PATH.exec(pathname);
  if (shared) return shareRoute(request, env, url, shared[1], shared[2]);
  return notFound(request, env, url);
}

// ---- The daily run --------------------------------------------------------------------------

// Cron (wrangler.jsonc triggers), once a day: place-in-line emails, the one payment reminder,
// Jonathan's summary, then the outbox. Every email it queues has a once_key made of the request
// and the New York date, so a second run the same day, even an overlapping one, adds nothing.
export async function runCommissionDaily(env, now = new Date()) {
  const db = env.COMMISSIONS_DB;
  if (!db) return { skipped: true };
  const runStart = now.toISOString();
  const today = newYorkDate(now);

  // A place-in-line email still unsent from an earlier day is out of date by now: drop it.
  await db.prepare(`DELETE FROM outbox WHERE kind = 'moved' AND sent_at IS NULL AND failed_at IS NULL
    AND (claimed_at IS NULL OR claimed_at < ?) AND once_key NOT LIKE ?`).bind(claimLapsedBefore(now), `%:${today}`).run();

  // One pass over the line, in order. What someone was last told is the place on their newest
  // email that actually went out.
  const { results: line } = await db.prepare(`SELECT r.*,
      (SELECT o.position FROM outbox o WHERE o.request_id = r.id AND o.position IS NOT NULL
         AND o.sent_at IS NOT NULL ORDER BY o.id DESC LIMIT 1) AS told
    FROM requests r WHERE r.${IN_LINE} ORDER BY r.id`).all();
  const emails = [];
  line.forEach((row, index) => {
    const position = index + 1;
    if (row.status !== 'requested') return;               // being written: no place-in-line emails
    if (row.quiet) return;                                // they turned them off
    if (newYorkDate(row.requested_at) === today) return;  // they got their number today already
    if (row.told == null || position >= row.told) return; // only when it went down from what they last heard
    emails.push(queueEmail(env, 'moved', row, { now, position, was: row.told, onceKey: `moved:${row.id}:${today}` }));
  });

  // The one "your song is waiting" nudge, REMINDER_DAYS after delivery, if unpaid.
  const remindBefore = new Date(now.getTime() - REMINDER_DAYS * 86_400_000).toISOString();
  const { results: waiting } = await db.prepare(`SELECT * FROM requests WHERE status = 'delivered' AND paid_at IS NULL
    AND archived_at IS NULL AND reminded_at IS NULL AND delivered_at <= ?`).bind(remindBefore).all();
  for (const row of waiting) {
    emails.push(db.prepare('UPDATE requests SET reminded_at = ? WHERE id = ? AND reminded_at IS NULL').bind(runStart, row.id));
    // Keyed by the delivery, so a song redelivered after Undo delivery gets its own reminder.
    emails.push(queueEmail(env, 'reminder', row, { now, onceKey: `reminder:${row.id}:${row.delivered_at}` }));
  }
  if (emails.length) await db.batch(emails);

  // A plan whose schedule never got made would bill every month for good. The webhook retries
  // for three days; this keeps trying after that.
  if (stripeReady(env)) {
    const { results: unended } = await db.prepare(`SELECT subscription_id FROM plans WHERE status = 'active'
      AND schedule_id IS NULL AND started_at < ?`).bind(new Date(now.getTime() - 3_600_000).toISOString()).all();
    for (const plan of unended) {
      try {
        await ensurePlanSchedule(env, plan.subscription_id);
      } catch (error) {
        console.log('commission daily plan', error instanceof StripeError ? error.status : error?.name);
      }
    }
  }

  const summary = await dailySummary(env, now, today);
  if (summary) await summary.run();

  const removed = await forget(env, now);

  // What the run has used so far, generously (the queries above, plus the batch's statements),
  // so the flush can stop before the invocation's D1 limit.
  const sent = await flushOutbox(env, { now, budget: D1_QUERY_BUDGET - 60 - emails.length - removed * 2 });

  console.log('commission daily', `moved+reminders ${emails.length}`, `sent ${sent.sent}`, `removed ${removed}`);
  return { queued: emails.length, removed, ...sent };
}

const RETENTION_BATCH = 100;

// What's kept, and for how long (README, "Where things live"): voice memos until MEMO_KEEP_DAYS
// after their song is delivered or the request cancelled; requests cancelled with no payment,
// with their emails and files, for CANCELLED_KEEP_DAYS; emails, sent or not, for
// OUTBOX_KEEP_DAYS, except the emails with a place in line for someone still in it, the newest of
// which is what they were last told.
// Returns how many requests and memos it removed.
async function forget(env, now) {
  const db = env.COMMISSIONS_DB;
  const files = env.COMMISSION_FILES;
  const daysAgo = (days) => new Date(now.getTime() - days * 86_400_000).toISOString();

  const memoBefore = daysAgo(MEMO_KEEP_DAYS);
  const { results: memos } = await db.prepare(`SELECT id, memo_key FROM requests WHERE memo_key IS NOT NULL
    AND ((status = 'delivered' AND delivered_at < ?) OR (status = 'cancelled' AND cancelled_at < ?)) LIMIT ?`)
    .bind(memoBefore, memoBefore, RETENTION_BATCH).all();
  if (memos.length && files) {
    await files.delete(memos.map((row) => row.memo_key));
    await db.batch(memos.map((row) => db.prepare('UPDATE requests SET memo_key = NULL WHERE id = ? AND memo_key = ?').bind(row.id, row.memo_key)));
  }

  // Payments are money records, so a request with any stays (Delete for good in the admin
  // clears its answers).
  const { results: gone } = await db.prepare(`SELECT id, memo_key, audio_key FROM requests r WHERE status = 'cancelled'
    AND cancelled_at < ? AND NOT EXISTS (SELECT 1 FROM payments WHERE request_id = r.id)
    AND NOT EXISTS (SELECT 1 FROM plans WHERE request_id = r.id) LIMIT ?`).bind(daysAgo(CANCELLED_KEEP_DAYS), RETENTION_BATCH).all();
  if (gone.length) {
    const keys = gone.flatMap((row) => [row.memo_key, row.audio_key]).filter(Boolean);
    if (keys.length && files) await files.delete(keys);
    await db.batch(gone.flatMap((row) => [
      db.prepare('DELETE FROM outbox WHERE request_id = ?').bind(row.id),
      db.prepare("DELETE FROM requests WHERE id = ? AND status = 'cancelled'").bind(row.id)
    ]));
  }

  const keepAfter = daysAgo(OUTBOX_KEEP_DAYS);
  await db.prepare(`DELETE FROM outbox WHERE (sent_at < ? OR failed_at < ? OR (sent_at IS NULL AND created_at < ?))
    AND NOT (sent_at IS NOT NULL AND position IS NOT NULL AND request_id IN (SELECT id FROM requests WHERE ${IN_LINE}))`)
    .bind(keepAfter, keepAfter, keepAfter).run();
  return memos.length + gone.length;
}

// Jonathan's summary email, when something happened since the last one, or null.
async function dailySummary(env, now, today) {
  const db = env.COMMISSIONS_DB;
  if (!env.COMMISSION_NOTIFY_TO) return null;
  const last = await db.prepare("SELECT created_at FROM outbox WHERE kind = 'summary' ORDER BY id DESC LIMIT 1").first('created_at');
  const since = last ?? new Date(now.getTime() - 86_400_000).toISOString();
  const runStart = now.toISOString();
  const all = async (sql, ...args) => (await db.prepare(sql).bind(...args).all()).results;
  const hourAgo = new Date(now.getTime() - 3_600_000).toISOString();
  const [fresh, deadlines, payments, ended, inLine, unpaid, stuck, failed, notDelivered, twice, unended, overpaid, held] = await Promise.all([
    all('SELECT id, kind, occasion, deadline, buyer_name, wants_video FROM requests WHERE requested_at > ? ORDER BY id', since),
    deadlineWatch(db, today),
    all('SELECT amount_cents FROM payments WHERE paid_at > ?', since),
    all('SELECT status FROM plans WHERE ended_at > ?', since),
    db.prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(status = 'writing'), 0) AS writing FROM requests WHERE ${IN_LINE}`).first(),
    db.prepare("SELECT COUNT(*) AS count FROM requests WHERE status = 'delivered' AND paid_at IS NULL AND archived_at IS NULL").first('count'),
    db.prepare('SELECT COUNT(*) AS count FROM outbox WHERE sent_at IS NULL AND failed_at IS NULL AND created_at < ?').bind(runStart).first('count'),
    db.prepare('SELECT COUNT(*) AS count FROM outbox WHERE failed_at IS NOT NULL AND failed_at > ?').bind(since).first('count'),
    // Paid for a song that isn't there: cancelled, or back in line after Undo delivery.
    all(`SELECT DISTINCT p.request_id AS id, r.status FROM payments p JOIN requests r ON r.id = p.request_id
      WHERE r.status != 'delivered' AND p.paid_at > ?`, since),
    // Paid twice: more than one one-off payment or plan, with one of them new.
    all(`SELECT r.id FROM requests r WHERE
      (SELECT COUNT(*) FROM payments WHERE request_id = r.id AND kind = 'once') + (SELECT COUNT(*) FROM plans WHERE request_id = r.id) > 1
      AND (EXISTS (SELECT 1 FROM payments WHERE request_id = r.id AND kind = 'once' AND paid_at > ?)
        OR EXISTS (SELECT 1 FROM plans WHERE request_id = r.id AND started_at > ?))`, since, since),
    // Plans that nothing will end, which the check above couldn't fix: these bill every month.
    all(`SELECT request_id AS id FROM plans WHERE status = 'active' AND schedule_id IS NULL AND started_at < ?`, hourAgo),
    all(`SELECT p.request_id AS id FROM plans p WHERE (SELECT COUNT(*) FROM payments WHERE subscription_id = p.subscription_id) > p.months`),
    db.prepare("SELECT COUNT(*) AS count FROM requests WHERE status = 'held'").first('count')
  ]);
  const news = fresh.length + deadlines.length + payments.length + ended.length + stuck + failed + notDelivered.length
    + twice.length + unended.length + overpaid.length + held;
  if (!news) return null;
  const paidSum = payments.reduce((sum, payment) => sum + payment.amount_cents, 0);
  const finished = ended.filter((plan) => plan.status === 'finished').length;
  const lines = [
    `New since the last summary: ${fresh.length}`,
    ...fresh.map((row) => `  #${row.id} · ${row.kind} · ${row.occasion || 'no occasion'}${row.deadline ? ` · deadline ${row.deadline}` : ''}${row.wants_video ? ' · video' : ''} · ${row.buyer_name}`),
    `In line: ${inLine.total} (${inLine.writing} being written)`,
    ...(held ? [`Held, waiting for you to let them in: ${held}`] : []),
    `Deadlines in the next 7 days, or at risk:${deadlines.length ? '' : ' none'}`,
    ...deadlines.map((row) => `  #${row.position} in line, request ${row.id}, ${shortDate(row.deadline, now)} (${row.days === 0 ? 'today' : `${row.days} day${row.days === 1 ? '' : 's'}`})${row.risk ? ', at risk' : ''}: ${siteOrigin(env)}/commission/admin/${row.id}`),
    `Delivered, not paid: ${unpaid}`,
    `Paid since the last summary: ${payments.length} payment${payments.length === 1 ? '' : 's'}, ${dollars(paidSum)}`,
    `Monthly plans finished: ${finished} · stopped early: ${ended.length - finished}`,
    `Emails that haven't gone out: ${stuck} · failed: ${failed}`
  ];
  const look = [
    ...notDelivered.map((row) => `#${row.id} was paid ${row.status === 'cancelled' ? 'after it was cancelled' : 'while it was back in line'}`),
    ...twice.map((row) => `#${row.id} was paid twice`),
    ...unended.map((row) => `#${row.id} has a monthly plan with no end set`),
    ...overpaid.map((row) => `#${row.id} has a monthly plan with more payments than months`)
  ];
  if (look.length) lines.push(`Needs a look: ${look.join(' · ')}`);
  return queueEmail(env, 'summary', null, {
    now, lines, onceKey: `summary:${today}`,
    subject: `Commissions: ${fresh.length} new, ${payments.length} paid (${dollars(paidSum)}), ${inLine.total} in line`
  });
}
