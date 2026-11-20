// Email ownership and Zeffy eligibility are separate checks. A verified email alone never
// grants a discount. Check Zeffy again for each quote; the resulting price is an order snapshot.
import { escapeHtml } from './fumble-page.mjs';

const API = 'https://api.zeffy.com/api/v1/';
const TOKEN = /^[a-f0-9]{64}$/;
const LINK_SECONDS = 15 * 60;
const SESSION_SECONDS = 30 * 86400;
const seconds = () => Math.floor(Date.now() / 1000);
const randomToken = () => [...crypto.getRandomValues(new Uint8Array(32))].map(n => n.toString(16).padStart(2, '0')).join('');
export async function patronHash(text) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map(n => n.toString(16).padStart(2, '0')).join('');
}
export function patronEmail(value) {
  const email = String(value ?? '').trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@\x00-\x1f\x7f]+@[^\s@\x00-\x1f\x7f]+\.[^\s@\x00-\x1f\x7f]+$/.test(email)) throw Error('invalid_email');
  return email;
}
export function patronPercent(env) {
  const value = Number(env.PATRON_DISCOUNT_PERCENT);
  return Number.isInteger(value) && value > 0 && value <= 100 ? value : 0;
}
export const patronReady = env => !!(patronPercent(env) && env.COMMISSIONS_DB && env.ZEFFY_API_KEY && env.ZEFFY_CAMPAIGN_ID && env.COMMISSION_EMAIL && env.COMMISSION_FROM_EMAIL && env.SITE_ORIGIN);
const headers = {
  'Cache-Control': 'private, no-store', 'Vary': 'Cookie', 'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
};
const json = (data, status = 200, extra = {}) => Response.json(data, { status, headers: { ...headers, ...extra } });
const cookieName = env => env.SITE_ORIGIN?.startsWith('https://') ? '__Host-studio_patron' : 'studio_patron_local';
const cookie = (env, token, age) => `${cookieName(env)}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${env.SITE_ORIGIN?.startsWith('https://') ? '; Secure' : ''}`;
const cookieToken = (request, env) => (request.headers.get('Cookie') ?? '').split(';').map(part => part.trim()).find(part => part.startsWith(cookieName(env) + '='))?.slice(cookieName(env).length + 1);

// Month ends clamp to the final day (January 31 -> February 28), rather than overflowing
// into March. A reported recurring period can advance even when the next charge fails:
// never extend a benefit beyond one month after an actual successful payment.
export function monthAfter(timestamp) {
  const d = new Date(timestamp * 1000), day = d.getUTCDate();
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + 1);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return Math.floor(d.getTime() / 1000);
}
export function paidThrough(payment, campaign, at = seconds()) {
  const recurring = payment?.recurring, created = Number(payment?.created);
  if (payment?.campaign_id !== campaign || payment?.status !== 'succeeded' || payment?.type !== 'online' ||
      !Number.isFinite(payment?.amount) || payment.amount <= 0 || payment.refund_status === 'full' || payment.dispute ||
      !recurring?.is_recurring || !['monthly', 'month'].includes(recurring.interval?.toLowerCase()) ||
      !recurring.subscription_id || !Number.isFinite(created) || created <= 0 || created > at) return 0;
  const refunded = (payment.refunds ?? []).reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  if (refunded >= payment.amount) return 0;
  const end = Number(recurring.current_period_end);
  const until = Math.min(monthAfter(created), Number.isFinite(end) && end > created ? end : Infinity);
  return until > at ? until : 0;
}

async function zeffyList(env, resource, query, fetcher, maxPages = 3) {
  const items = [], cursors = new Set();
  for (let page = 0; page < maxPages; page++) {
    const response = await fetcher(API + resource + '?' + query, {
      headers: { Authorization: `Bearer ${env.ZEFFY_API_KEY}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) throw Error('membership_unavailable');
    const list = await response.json();
    if (!Array.isArray(list.data)) throw Error('membership_unavailable');
    items.push(...list.data);
    if (!list.has_more) return items;
    if (!list.next_cursor || cursors.has(list.next_cursor)) throw Error('membership_unavailable');
    cursors.add(list.next_cursor); query.set('starting_after', list.next_cursor);
  }
  throw Error('membership_unavailable');
}
export async function findPatron(env, email, { at = seconds(), fetcher = fetch } = {}) {
  if (!env.ZEFFY_API_KEY || !env.ZEFFY_CAMPAIGN_ID) throw Error('membership_unavailable');
  email = patronEmail(email);
  const contacts = await zeffyList(env, 'contacts', new URLSearchParams({ email, limit: '100' }), fetcher, 2);
  // Only the verified donation email qualifies. Do not merge Gmail dots or plus aliases.
  const ids = [...new Set(contacts.filter(c => String(c.email ?? '').trim().toLowerCase() === email).map(c => c.id).filter(id => typeof id === 'string' && id.length <= 100))];
  if (ids.length > 5) throw Error('membership_unavailable');
  let until = 0;
  for (const contact of ids) {
    const payments = await zeffyList(env, 'payments', new URLSearchParams({ contact, campaign: env.ZEFFY_CAMPAIGN_ID,
      status: 'succeeded', type: 'online', 'created[gte]': String(at - 35 * 86400), limit: '100' }), fetcher);
    for (const payment of payments) {
      if (payment.contact === contact) until = Math.max(until, paidThrough(payment, env.ZEFFY_CAMPAIGN_ID, at));
    }
  }
  return { eligible: until > at, paidThrough: until };
}
export async function patronSession(request, env, at = seconds()) {
  const token = cookieToken(request, env);
  if (!env.COMMISSIONS_DB || !TOKEN.test(token ?? '')) return null;
  return env.COMMISSIONS_DB.prepare('SELECT email,expires_at FROM patron_sessions WHERE token_hash=? AND expires_at>?').bind(await patronHash(token), at).first();
}
export async function patronPrice(request, env, email, priceCents) {
  const none = { discountCents: 0, discountPercent: 0, patronEmailHash: null };
  if (!patronPercent(env)) return none;
  const session = await patronSession(request, env);
  if (!session || session.email !== patronEmail(email)) return none;
  if (!patronReady(env)) throw Error('membership_unavailable');
  const membership = await findPatron(env, session.email);
  if (!membership.eligible) return none;
  const percent = patronPercent(env);
  return { discountCents: Math.round(priceCents * percent / 100), discountPercent: percent, patronEmailHash: await patronHash(session.email) };
}

async function readBody(request, form = false) {
  const reader = request.body?.getReader();
  if (!reader) throw Error('invalid_request');
  let bytes = new Uint8Array();
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    if (bytes.length + value.length > 2048) { await reader.cancel(); throw Error('invalid_request'); }
    const next = new Uint8Array(bytes.length + value.length); next.set(bytes); next.set(value, bytes.length); bytes = next;
  }
  const text = new TextDecoder().decode(bytes);
  return form ? Object.fromEntries(new URLSearchParams(text)) : JSON.parse(text);
}
function returnPath(value, origin) {
  const url = new URL(String(value ?? '/store/muscle/'), origin);
  const clean = new URL('/store/muscle/', origin);
  if (url.origin === origin && url.pathname === clean.pathname) {
    for (const key of ['figure', 'size', 'frame']) if (url.searchParams.has(key)) clean.searchParams.set(key, url.searchParams.get(key).slice(0, 30));
  }
  return clean.pathname + clean.search + '#patron-discount';
}
async function allowEmail(env, email, at) {
  const key = await patronHash('email:' + email);
  const row = await env.COMMISSIONS_DB.prepare(`INSERT INTO patron_limits(key,attempts,expires_at) VALUES(?,1,?)
    ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN patron_limits.expires_at<=? THEN 1 ELSE patron_limits.attempts+1 END,
    expires_at=CASE WHEN patron_limits.expires_at<=? THEN excluded.expires_at ELSE patron_limits.expires_at END
    RETURNING attempts`).bind(key, at + 900, at, at).first();
  return row.attempts <= 3;
}
function html(title, content, status = 200) {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · Song A Day Studio</title><style>body{font:18px/1.5 system-ui,sans-serif;background:#080808;color:#fff;max-width:34rem;margin:4rem auto;padding:0 1.5rem}h1{line-height:1.15}a{color:inherit}button{font:inherit;padding:.8rem 1rem;cursor:pointer}p{overflow-wrap:anywhere}</style></head><body><a href="/store/muscle/">Song A Day Studio</a><h1>${escapeHtml(title)}</h1>${content}</body></html>`, { status, headers: { ...headers, 'Content-Type': 'text/html;charset=utf-8' } });
}
export async function cleanupPatrons(env, at = seconds()) {
  if (!env.COMMISSIONS_DB) return;
  // Expiry must still run when the discount is disabled. Older databases used by
  // local commission-only previews may not have the patron migration yet.
  const exists = await env.COMMISSIONS_DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='patron_sessions'").first();
  if (!exists) return;
  await env.COMMISSIONS_DB.batch(['patron_links', 'patron_sessions', 'patron_limits'].map(table => env.COMMISSIONS_DB.prepare(`DELETE FROM ${table} WHERE expires_at<=?`).bind(at)));
}
export async function handlePatron(request, env, url) {
  if (!['/store/patron/request', '/store/patron/verify', '/store/patron/status', '/store/patron/logout'].includes(url.pathname)) return null;
  if (!patronReady(env)) return json({ error: 'Patron discounts are unavailable right now. Please try again later.' }, 503);
  const verify = url.pathname === '/store/patron/verify';
  if (!['GET', 'POST'].includes(request.method) || (!verify && request.method !== (url.pathname.endsWith('/status') ? 'GET' : 'POST'))) return json({ error: 'Method not allowed.' }, 405);
  // Chrome can send Origin:null for a form on a no-referrer page. Its Fetch Metadata
  // still proves a same-origin navigation; allow that only for the single-use link form.
  const fromSameOrigin = request.headers.get('Origin') === url.origin ||
    (verify && request.headers.get('Sec-Fetch-Site') === 'same-origin' && ['null', null].includes(request.headers.get('Origin')));
  if (url.origin !== env.SITE_ORIGIN || (request.method === 'POST' && !fromSameOrigin)) return json({ error: 'Please reload the store.' }, 403);
  if (env.PATRON_LIMIT && !(await env.PATRON_LIMIT.limit({ key: request.headers.get('CF-Connecting-IP') ?? 'unknown' })).success) return json({ error: 'Please wait a minute and try again.' }, 429);
  try {
    const at = seconds();
    if (url.pathname.endsWith('/status')) {
      const session = await patronSession(request, env, at);
      if (!session) return json({ verified: false, eligible: false, percent: patronPercent(env) });
      return json({ verified: true, email: session.email, percent: patronPercent(env), ...await findPatron(env, session.email, { at }) });
    }
    if (url.pathname.endsWith('/logout')) {
      const token = cookieToken(request, env);
      if (TOKEN.test(token ?? '')) await env.COMMISSIONS_DB.prepare('DELETE FROM patron_sessions WHERE token_hash=?').bind(await patronHash(token)).run();
      return json({ verified: false }, 200, { 'Set-Cookie': cookie(env, '', 0) });
    }
    if (url.pathname.endsWith('/request')) {
      if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw Error('invalid_request');
      const data = await readBody(request), email = patronEmail(data.email);
      const accepted = { message: 'Check your inbox for a link to verify your email. It expires in 15 minutes.' };
      // Identical response for patrons and non-patrons. Zeffy is only queried after ownership
      // is proved, so neither status responses nor sending times disclose donor membership.
      if (!await allowEmail(env, email, at)) return json(accepted);
      const token = randomToken(), hash = await patronHash(token);
      await env.COMMISSIONS_DB.prepare('INSERT INTO patron_links(token_hash,email,return_path,expires_at) VALUES(?,?,?,?)').bind(hash, email, returnPath(data.returnTo, url.origin), at + LINK_SECONDS).run();
      const link = `${env.SITE_ORIGIN}/store/patron/verify?token=${token}`;
      try {
        await env.COMMISSION_EMAIL.send({ to: email, from: { email: env.COMMISSION_FROM_EMAIL, name: env.COMMISSION_FROM_NAME || 'Jonathan Mann' },
          ...(env.COMMISSION_REPLY_TO ? { replyTo: env.COMMISSION_REPLY_TO } : {}),
          subject: 'Verify your email for your poster patron discount',
          text: `Verify your email to check your ${patronPercent(env)}% monthly patron discount on posters:\n\n${link}\n\nThis link expires in 15 minutes and works once. If you did not request it, you can ignore this email.\n\nJonathan Mann`,
          html: `<p>Verify your email to check your <strong>${patronPercent(env)}% monthly patron discount on posters</strong>.</p><p><a href="${link}">Verify my email</a></p><p>This link expires in 15 minutes and works once. If you did not request it, you can ignore this email.</p><p>Jonathan Mann</p>` });
      } catch {
        await env.COMMISSIONS_DB.prepare('DELETE FROM patron_links WHERE token_hash=?').bind(hash).run();
        throw Error('email_unavailable');
      }
      return json(accepted);
    }
    const data = request.method === 'POST' ? await readBody(request, true) : { token: url.searchParams.get('token') };
    if (!TOKEN.test(data.token ?? '')) throw Error('invalid_link');
    const hash = await patronHash(data.token);
    if (request.method === 'GET') {
      const row = await env.COMMISSIONS_DB.prepare('SELECT email FROM patron_links WHERE token_hash=? AND expires_at>?').bind(hash, at).first();
      if (!row) throw Error('invalid_link');
      // Email scanners may follow GET links. Only an explicit, same-origin confirmation
      // consumes the link or creates a browser session.
      return html('Verify your email', `<p>Continue as <strong>${escapeHtml(row.email)}</strong> to check your monthly patron discount on posters.</p><form method="post" action="/store/patron/verify"><input type="hidden" name="token" value="${data.token}"><button type="submit">Verify my email</button></form><p>Your email will be remembered on this device for 30 days.</p>`);
    }
    const token = randomToken(), sessionHash = await patronHash(token);
    const result = await env.COMMISSIONS_DB.batch([
      env.COMMISSIONS_DB.prepare(`INSERT INTO patron_sessions(token_hash,email,expires_at) SELECT ?,email,? FROM patron_links WHERE token_hash=? AND expires_at>?`).bind(sessionHash, at + SESSION_SECONDS, hash, at),
      env.COMMISSIONS_DB.prepare('DELETE FROM patron_links WHERE token_hash=? AND expires_at>? RETURNING return_path').bind(hash, at)
    ]);
    const row = result[1].results?.[0];
    if (!result[0].meta.changes || !row) throw Error('invalid_link');
    return new Response(null, { status: 303, headers: { ...headers, Location: row.return_path, 'Set-Cookie': cookie(env, token, SESSION_SECONDS) } });
  } catch (error) {
    if (error.message === 'invalid_link') return html('This link has expired', '<p>Please return to the poster store and request a fresh verification link.</p><p><a href="/store/muscle/#patron-discount">Back to posters</a></p>', 400);
    if (error.message === 'invalid_email' || error.message === 'invalid_request' || error instanceof SyntaxError) return json({ error: 'Please enter a valid email address.' }, 400);
    console.log('patron discount', error.message === 'email_unavailable' ? 'email unavailable' : 'check unavailable');
    return json({ error: 'We couldn’t check your patron discount right now. Please try again before checking out.' }, 503);
  }
}
