// What monthly patrons give each month, added up from Zeffy's payments API (read with the
// ZEFFY_API_KEY secret). Private for now: only /commission/admin/monthly shows it, behind the
// same Cloudflare Access check as the rest of the admin. The public pages still name the goals
// only (patronage.mjs).
//
// Nothing here keeps or shows who gave. Each payment is cut down to its amount, date, campaign
// and recurring details the moment it is read, and the page shows totals.
//
// Zeffy's own bar counts everything ever given. The goal is dollars a month, so this counts one
// charge from every monthly gift still running: the payments of the last WINDOW_DAYS days, with
// two charges from the same gift counted once.
import { accessIdentity } from './commission-admin.mjs';
import { MONTHLY_GOALS, dollars } from './patronage.mjs';

const PAYMENTS_URL = 'https://api.zeffy.com/api/v1/payments';
// A monthly gift is charged once a month, so a little over a month of payments holds one charge
// from each.
export const WINDOW_DAYS = 32;
const PAGE_SIZE = 100;
// 3,000 payments in a month is far more than this form sees; past that, say so instead of looping.
const MAX_PAGES = 30;
// A gift that has since been stopped can still have a charge inside the window.
const STOPPED = /cancel|ended|expired|inactive|stopped|paused/;

const PRIVATE_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"
};

const escapeHtml = (text) => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

// The parts of a payment the totals need, and nothing about the person who paid.
const trim = (payment) => ({
  id: String(payment?.id ?? ''),
  created: Number(payment?.created) || 0,
  cents: Number(payment?.amount) || 0,
  currency: String(payment?.currency ?? '').toLowerCase(),
  refunded: payment?.refund_status === 'full',
  campaign: String(payment?.campaign_id ?? ''),
  title: String(payment?.description ?? ''),
  recurring: payment?.recurring?.is_recurring ? {
    interval: String(payment.recurring.interval ?? '').toLowerCase(),
    status: String(payment.recurring.status ?? '').toLowerCase(),
    gift: String(payment.recurring.subscription_id ?? '')
  } : null
});

// Zeffy said no. `code` is Zeffy's own word for why (invalid_api_key, rate_limit_exceeded…).
export class ZeffyError extends Error {
  constructor(status, code) {
    super(`Zeffy answered ${status}${code ? ` (${code})` : ''}.`);
    this.status = status;
    this.code = code;
  }
}

// Every successful payment of the last WINDOW_DAYS days, trimmed.
export async function readPayments(env, { now = Date.now(), fetcher = fetch } = {}) {
  const since = Math.floor(now / 1000) - WINDOW_DAYS * 86400;
  const payments = [];
  let cursor = '';
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const query = new URLSearchParams({ status: 'succeeded', limit: String(PAGE_SIZE), 'created[gte]': String(since) });
    if (cursor) query.set('starting_after', cursor);
    const response = await fetcher(`${PAYMENTS_URL}?${query}`, {
      headers: { Authorization: `Bearer ${env.ZEFFY_API_KEY}`, Accept: 'application/json' }
    });
    if (!response.ok) {
      const problem = await response.json().catch(() => null);
      throw new ZeffyError(response.status, String(problem?.error?.code ?? '').slice(0, 60));
    }
    const list = await response.json();
    for (const payment of Array.isArray(list?.data) ? list.data : []) payments.push(trim(payment));
    if (!list?.has_more || !list?.next_cursor) return payments;
    cursor = String(list.next_cursor);
  }
  throw new ZeffyError(200, 'too_many_pages');
}

// The totals, overall and campaign by campaign. With `campaign` (a Zeffy campaign id), only that
// campaign's payments count.
export function monthlySummary(payments, { campaign = '' } = {}) {
  const counted = payments.filter((payment) => !payment.refunded && (!campaign || payment.campaign === campaign));
  const campaigns = new Map();
  const row = (payment) => {
    if (!campaigns.has(payment.campaign)) {
      campaigns.set(payment.campaign, { id: payment.campaign, title: payment.title, monthlyCents: 0, monthlyGifts: 0, oneTimeCents: 0, oneTimeGifts: 0 });
    }
    return campaigns.get(payment.campaign);
  };
  const gifts = new Set();
  // Newest first, so the charge kept for a gift is its latest.
  for (const payment of [...counted].sort((a, b) => b.created - a.created)) {
    if (!payment.recurring) {
      row(payment).oneTimeCents += payment.cents;
      row(payment).oneTimeGifts += 1;
    } else if (payment.recurring.interval.startsWith('month') && !STOPPED.test(payment.recurring.status)) {
      const gift = payment.recurring.gift || payment.id;
      if (gifts.has(gift)) continue;
      gifts.add(gift);
      row(payment).monthlyCents += payment.cents;
      row(payment).monthlyGifts += 1;
    }
  }
  const rows = [...campaigns.values()].sort((a, b) => b.monthlyCents - a.monthlyCents || a.title.localeCompare(b.title));
  const sum = (key) => rows.reduce((total, entry) => total + entry[key], 0);
  const distinct = (values) => [...new Set(values.filter(Boolean))].sort();
  return {
    days: WINDOW_DAYS,
    monthly: { cents: sum('monthlyCents'), gifts: sum('monthlyGifts') },
    oneTime: { cents: sum('oneTimeCents'), gifts: sum('oneTimeGifts') },
    campaigns: rows,
    // What Zeffy sent, so a surprise in its wording (a new interval, a new status) shows up here.
    seen: {
      payments: payments.length,
      intervals: distinct(payments.map((payment) => payment.recurring?.interval)),
      statuses: distinct(payments.map((payment) => payment.recurring?.status)),
      currencies: distinct(payments.map((payment) => payment.currency))
    }
  };
}

const money = (cents) => dollars(Math.round(cents / 100));
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

function page(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)} · Commissions</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:44rem;margin:2rem auto;padding:0 1rem}table{border-collapse:collapse}th,td{text-align:left;padding:.25rem 1rem .25rem 0}td.n,th.n{text-align:right}.big{font-size:2rem;font-weight:700;margin:.5rem 0}</style>
</head>
<body>
<p><a href="/commission/admin">Commissions</a></p>
<h1>${escapeHtml(title)}</h1>
${body}
</body>
</html>
`;
}

function summaryPage(summary, { campaign }) {
  const goal = MONTHLY_GOALS.first;
  const percent = Math.round((summary.monthly.cents / 100 / goal) * 100);
  const table = summary.campaigns.length > 1 || !campaign ? `<h2>By campaign</h2>
<table>
<tr><th>Campaign</th><th class="n">A month</th><th class="n">Monthly gifts</th><th class="n">One-time</th><th>Zeffy id</th></tr>
${summary.campaigns.map((entry) => `<tr><td>${escapeHtml(entry.title || '(no title)')}</td><td class="n">${money(entry.monthlyCents)}</td><td class="n">${entry.monthlyGifts}</td><td class="n">${money(entry.oneTimeCents)}</td><td><code>${escapeHtml(entry.id)}</code></td></tr>`).join('\n')}
</table>` : '';
  return page('Monthly giving', `<p class="big">${money(summary.monthly.cents)} a month</p>
<p>From ${plural(summary.monthly.gifts, 'monthly gift')}: ${percent}% of the first goal of ${dollars(goal)} a month.</p>
<p>One-time gifts in the last ${summary.days} days: ${money(summary.oneTime.cents)} across ${plural(summary.oneTime.gifts, 'gift')}.</p>
${campaign ? '' : '<p>Every campaign in the Zeffy account is counted. To count one only, set <code>ZEFFY_CAMPAIGN_ID</code> to its id below.</p>'}
${table}
<p>Read from Zeffy just now: ${plural(summary.seen.payments, 'payment')} in the last ${summary.days} days. Recurring intervals seen: ${escapeHtml(summary.seen.intervals.join(', ') || 'none')}. Statuses: ${escapeHtml(summary.seen.statuses.join(', ') || 'none')}. Currencies: ${escapeHtml(summary.seen.currencies.join(', ') || 'none')}.</p>
<p>Only this page shows these numbers. Nothing on the public site does.</p>`);
}

// /commission/admin/monthly, and nothing else (null hands the request on).
export async function handleMonthlyGiving(request, env, url) {
  if (url.pathname !== '/commission/admin/monthly') return null;
  if (!await accessIdentity(request, env, url)) return new Response('Unauthorized', { status: 401, headers: { ...PRIVATE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' } });
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405, headers: { ...PRIVATE_HEADERS, Allow: 'GET, HEAD' } });
  const html = (body, status = 200) => new Response(body, { status, headers: { ...PRIVATE_HEADERS, 'Content-Type': 'text/html; charset=utf-8' } });
  if (!env.ZEFFY_API_KEY) return html(page('Monthly giving', '<p>The Zeffy key isn’t set (ZEFFY_API_KEY).</p>'), 503);
  const campaign = String(env.ZEFFY_CAMPAIGN_ID ?? '').trim();
  let summary;
  try {
    summary = monthlySummary(await readPayments(env), { campaign });
  } catch (error) {
    const why = error instanceof ZeffyError
      ? (error.code === 'invalid_api_key' ? 'Zeffy refused the key. If a new key was generated in Zeffy, the old one stopped working: put the new one in with wrangler secret put ZEFFY_API_KEY.' : error.message)
      : 'Zeffy couldn’t be reached.';
    return html(page('Monthly giving', `<p>${escapeHtml(why)}</p>`), 502);
  }
  if (url.searchParams.get('format') === 'json') return Response.json(summary, { headers: PRIVATE_HEADERS });
  return html(summaryPage(summary, { campaign }));
}
