// The Donate button wording test on songaday.studio (the words and the browser side are in
// bar/v1/donate-words.js). Three parts:
//
// - On every studio page but the purchase pages, the Worker gives each Donate button
//   (data-donate="header|band|footer") the visitor's wording and adds bar/v1/donate-page.js,
//   which counts the view and the clicks. A new visitor gets a wording at random, kept in the
//   donate_words cookie (just the letter: no id, nothing else) for 60 days.
// - POST /donate-test/hit adds one view or click to that day's total in donate_counts. The
//   request itself isn't kept: no address, no cookie, no time finer than the day.
// - /commission/admin/donate-test shows the totals, behind the admin's Cloudflare Access check.
//
// The purchase pages (commission, business, conference troubadour, store) keep "Donate": their
// own words say nothing about donating, and "Get a tax break" next to a price would read like a
// promise about the purchase.
import { accessIdentity } from './commission-admin.mjs';
import { PLACES, RUNNING, WORDS, isWords, pickWords } from './bar/v1/donate-words.js';
import projects from './projects.json' with { type: 'json' };

export const COOKIE = 'donate_words';
const COOKIE_DAYS = 60;
const PAGE_SCRIPT = '/bar/v1/donate-page.js';
const PURCHASE = /^\/(?:commission|business|conference-troubadour|store)(?:\/|$)/;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

// The Song A Day sites a count may come from: every site in projects.json and its subdomains.
const SITES = [...new Set(projects.projects.map((project) => {
  try {
    return new URL(project.url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}).filter(Boolean))];

export const knownSite = (host) => typeof host === 'string' && host.length <= 80
  && (LOCAL_HOSTS.has(host) || SITES.some((site) => host === site || host.endsWith('.' + site)));

const isPurchase = (url) => PURCHASE.test(url.pathname.toLowerCase());

function cookieWords(request) {
  const header = request.headers.get('Cookie') ?? '';
  for (const part of header.split(';')) {
    const [name, value] = part.trim().split('=');
    if (name === COOKIE && isWords(value)) return value;
  }
  return null;
}

// This visitor's wording, and whether the cookie needs (re)setting. ?donate_words=c shows c and
// keeps it, so each wording can be looked at.
export function visitorWords(request, url, random = Math.random) {
  const asked = url.searchParams.get('donate_words');
  if (isWords(asked)) return { words: asked, remember: asked !== cookieWords(request) };
  const kept = cookieWords(request);
  if (kept) return { words: kept, remember: false };
  return { words: pickWords(random), remember: true };
}

// Gives a studio page's Donate buttons the visitor's wording. Anything that isn't a full HTML
// page, and the purchase pages, come back as they were.
export function applyDonateTest(request, url, response, random = Math.random) {
  // Node (the tests) has no HTMLRewriter.
  if (typeof HTMLRewriter === 'undefined') return response;
  if (!RUNNING || isPurchase(url) || !response.headers.get('Content-Type')?.includes('text/html')) return response;
  if (request.method !== 'GET' && request.method !== 'HEAD') return response;
  const { words, remember } = visitorWords(request, url, random);
  let buttons = 0;
  const rewritten = new HTMLRewriter()
    .on('[data-donate]', {
      element(element) {
        buttons += 1;
        element.setInnerContent(WORDS[words]);
        element.setAttribute('data-donate-words', words);
      }
    })
    .on('body', {
      element(element) {
        element.onEndTag((end) => {
          if (buttons) end.before(`<script type="module" src="${PAGE_SCRIPT}"></script>`, { html: true });
        });
      }
    })
    .transform(response);
  const page = new Response(rewritten.body, rewritten);
  if (remember) {
    const secure = url.protocol === 'https:' ? '; Secure' : '';
    page.headers.append('Set-Cookie', `${COOKIE}=${words}; Path=/; Max-Age=${COOKIE_DAYS * 86400}; SameSite=Lax; HttpOnly${secure}`);
  }
  return page;
}

// New York's date, the day a count belongs to (as the song numbers are).
const day = (now) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now);

// Checks a count's body: { event, words, place, site }. Returns the row's values, or null.
export function readHit(text) {
  if (typeof text !== 'string' || text.length > 400) return null;
  let hit;
  try {
    hit = JSON.parse(text);
  } catch {
    return null;
  }
  if (!hit || typeof hit !== 'object') return null;
  const { event, words, place = '', site } = hit;
  if (event !== 'view' && event !== 'click') return null;
  if (!isWords(words) || !knownSite(site)) return null;
  if (event === 'view' ? place !== '' : !PLACES.includes(place)) return null;
  return { event, words, place, site: LOCAL_HOSTS.has(site) ? 'local' : site };
}

const PRIVATE_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"
};

// The answer to a count is always the same empty 204, so a bad one learns nothing. Another site
// sends it with sendBeacon, which ignores the answer; the CORS header just keeps a fetch quiet.
const done = () => new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } });

export async function handleDonateTest(request, env, url, { now = new Date() } = {}) {
  if (url.pathname === '/donate-test/hit') {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Max-Age': '86400' } });
    if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } });
    if (!RUNNING || !env.COMMISSIONS_DB) return done();
    if (env.DONATE_LIMIT && !(await env.DONATE_LIMIT.limit({ key: request.headers.get('CF-Connecting-IP') ?? 'unknown' })).success) return done();
    const hit = readHit(await request.text().catch(() => ''));
    if (!hit) return done();
    await env.COMMISSIONS_DB.prepare(`INSERT INTO donate_counts (day, words, site, place, event, count) VALUES (?, ?, ?, ?, ?, 1)
      ON CONFLICT (day, words, site, place, event) DO UPDATE SET count = count + 1`)
      .bind(day(now), hit.words, hit.site, hit.place, hit.event).run();
    return done();
  }

  if (url.pathname !== '/commission/admin/donate-test') return null;
  if (!await accessIdentity(request, env, url)) return new Response('Unauthorized', { status: 401, headers: { ...PRIVATE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' } });
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405, headers: { ...PRIVATE_HEADERS, Allow: 'GET, HEAD' } });
  const { results } = await env.COMMISSIONS_DB.prepare('SELECT day, words, site, place, event, count FROM donate_counts').all();
  const summary = summarize(results);
  if (url.searchParams.get('format') === 'json') return Response.json(summary, { headers: PRIVATE_HEADERS });
  return new Response(resultsPage(summary), { headers: { ...PRIVATE_HEADERS, 'Content-Type': 'text/html; charset=utf-8' } });
}

// Two-sided test of a wording's click rate against "Donate"'s: the normal approximation, which
// is fair once each side has a few hundred views. Returns p, or null when it can't say.
export function pValue(clicksA, viewsA, clicksB, viewsB) {
  if (viewsA < 1 || viewsB < 1) return null;
  const pooled = (clicksA + clicksB) / (viewsA + viewsB);
  const spread = Math.sqrt(pooled * (1 - pooled) * (1 / viewsA + 1 / viewsB));
  if (!spread) return null;
  const z = Math.abs(clicksA / viewsA - clicksB / viewsB) / spread;
  return 2 * (1 - normal(z));
}

// The standard normal's cumulative distribution (Abramowitz and Stegun 26.2.17).
function normal(z) {
  const t = 1 / (1 + 0.2316419 * z);
  const tail = 0.3989423 * Math.exp(-z * z / 2) * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return 1 - tail;
}

export function summarize(rows) {
  const blank = () => ({ views: 0, clicks: 0, places: Object.fromEntries(PLACES.map((place) => [place, 0])) });
  const byWords = Object.fromEntries(Object.keys(WORDS).map((key) => [key, blank()]));
  const sites = {};
  const days = new Set();
  for (const row of rows) {
    const entry = byWords[row.words];
    if (!entry) continue;
    days.add(row.day);
    if (row.event === 'view') entry.views += row.count;
    else {
      entry.clicks += row.count;
      if (row.place in entry.places) entry.places[row.place] += row.count;
    }
    sites[row.site] ??= { views: 0, clicks: 0 };
    sites[row.site][row.event === 'view' ? 'views' : 'clicks'] += row.count;
  }
  const control = byWords.a;
  const sorted = [...days].sort();
  return {
    from: sorted[0] ?? null,
    to: sorted.at(-1) ?? null,
    words: Object.entries(byWords).map(([key, entry]) => ({
      key,
      label: WORDS[key],
      ...entry,
      rate: entry.views ? entry.clicks / entry.views : null,
      p: key === 'a' ? null : pValue(entry.clicks, entry.views, control.clicks, control.views)
    })),
    sites
  };
}

const escapeHtml = (text) => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const percent = (rate) => rate === null ? '–' : `${(rate * 100).toFixed(2)}%`;
const whole = (number) => number.toLocaleString('en-US');

// What the p value means for a reader who doesn't want statistics.
function verdict(entry, control) {
  if (entry.key === 'a') return 'the one to beat';
  if (entry.views < 500 || control.views < 500) return 'too early';
  if (entry.p === null || entry.p >= 0.05) return 'no clear difference yet';
  return entry.rate > control.rate ? 'clicked more than Donate' : 'clicked less than Donate';
}

function resultsPage(summary) {
  const control = summary.words[0];
  const rows = summary.words.map((entry) => `<tr><td>${escapeHtml(entry.label)}</td><td class="n">${whole(entry.views)}</td><td class="n">${whole(entry.clicks)}</td><td class="n">${percent(entry.rate)}</td><td>${verdict(entry, control)}</td></tr>`).join('\n');
  const placeRows = PLACES.map((place) => `<tr><td>${place}</td>${summary.words.map((entry) => `<td class="n">${whole(entry.places[place])}</td>`).join('')}</tr>`).join('\n');
  const siteRows = Object.entries(summary.sites).sort((a, b) => b[1].views - a[1].views)
    .map(([site, entry]) => `<tr><td>${escapeHtml(site)}</td><td class="n">${whole(entry.views)}</td><td class="n">${whole(entry.clicks)}</td></tr>`).join('\n');
  const span = summary.from ? `${summary.from} to ${summary.to}, New York dates.` : 'Nothing counted yet.';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Donate button test · Commissions</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:44rem;margin:2rem auto;padding:0 1rem}table{border-collapse:collapse;margin:0 0 2rem}th,td{text-align:left;padding:.25rem 1rem .25rem 0}td.n,th.n{text-align:right}</style>
</head>
<body>
<p><a href="/commission/admin">Commissions</a></p>
<h1>Donate button test</h1>
<p>${span} A view is one page load; a click is one press of a Donate button.</p>
<table>
<tr><th>Wording</th><th class="n">Views</th><th class="n">Clicks</th><th class="n">Click rate</th><th></th></tr>
${rows}
</table>
<h2>Clicks by button</h2>
<table>
<tr><th></th>${summary.words.map((entry) => `<th class="n">${escapeHtml(entry.label)}</th>`).join('')}</tr>
${placeRows}
</table>
<h2>By site</h2>
<table>
<tr><th>Site</th><th class="n">Views</th><th class="n">Clicks</th></tr>
${siteRows}
</table>
<p>“No clear difference yet” until a wording has at least 500 views and its click rate differs from Donate’s by more than chance would explain (p under 0.05).</p>
</body>
</html>`;
}
