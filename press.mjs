// songaday.studio/press/: Jonathan's press, podcast, radio and TV appearances, newest first.
// The rows come from the "Public" tab of the Google Sheet "jonathan_mann_press_inventory". The
// build renders press/press.json (a committed snapshot of that tab) into press/index.html, and
// when PRESS_CSV_URL is set (wrangler.jsonc) the Worker re-renders it from the tab, published to
// the web as CSV, so a new row shows up without a redeploy. On any failure it keeps the snapshot.
// Nothing from the sheet is trusted as HTML: every value is escaped, and links must be http(s).
import { escapeHtml } from './films.mjs';
import snapshot from './press/press.json' with { type: 'json' };

// The Public tab's header row, in order. update-press.mjs writes press/press.json the same way.
export const PRESS_COLUMNS = ['id', 'date', 'outlet', 'title', 'kind', 'format', 'subject', 'project', 'url',
  'byline', 'featured', 'wallet_only'];
const REQUIRED = ['id', 'date', 'title', 'url'];

// The kinds the sheet's formula sorts rows into, and their filter addresses (/press/?kind=tv).
export const PRESS_KINDS = [
  { slug: 'press', label: 'Press' },
  { slug: 'podcasts', label: 'Podcasts & radio' },
  { slug: 'tv', label: 'TV & video' }
];
const KIND_BY_LABEL = new Map(PRESS_KINDS.map((kind) => [kind.label.toLowerCase(), kind]));
export const pressKind = (slug) => PRESS_KINDS.find((kind) => kind.slug === slug)?.slug ?? null;

// The Worker re-reads the sheet at most every 15 minutes per Cloudflare location, and waits
// this long for it before the page keeps the snapshot.
export const PRESS_CACHE_SECONDS = 900;
const FETCH_TIMEOUT_MS = 2000;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];
const OUT = '<span class="nav-out" aria-hidden="true">↗</span>';
const LIMITS = { outlet: 120, title: 300, format: 60, subject: 60, project: 80, byline: 160 };

// RFC 4180 CSV, as Google Sheets publishes it: quoted fields can hold commas, quotes ("") and
// line breaks; lines end in \r\n or \n; the file may start with a byte order mark. A quote in
// the middle of an unquoted field is kept as a character. Blank lines are dropped.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let fieldStarted = false;
  const source = String(text).replace(/^\uFEFF/, '');
  const endField = () => { row.push(field); field = ''; fieldStarted = false; };
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char !== '"') field += char;
      else if (source[i + 1] === '"') { field += '"'; i++; }
      else quoted = false;
    } else if (char === '"' && !fieldStarted) {
      quoted = true;
      fieldStarted = true;
    } else if (char === ',') {
      endField();
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i++;
      endField();
      rows.push(row);
      row = [];
    } else {
      field += char;
      fieldStarted = true;
    }
  }
  if (fieldStarted || row.length) {
    endField();
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ''));
}

// Plain one-line text: no control characters, runs of space collapsed, and a length cap.
const clean = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')
  .replace(/\s+/g, ' ').trim().slice(0, max).trim();
const isTrue = (value) => value === true || /^(true|yes|1)$/i.test(String(value ?? '').trim());

function httpUrl(value) {
  try {
    const url = new URL(String(value ?? '').trim());
    if ((url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password) return url;
  } catch {}
  return null;
}

// YYYY, YYYY-MM or YYYY-MM-DD: a real calendar date from 1990 to next year.
function validDate(value) {
  const date = String(value ?? '').trim();
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(date);
  if (!match) return null;
  const [year, month = 1, day = 1] = match.slice(1).map((part) => part === undefined ? undefined : Number(part));
  if (year < 1990 || year > new Date().getUTCFullYear() + 1 || month < 1 || month > 12 || day < 1) return null;
  if (day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null;
  return date;
}

// One sheet row as a press item, or the reason it can't be one.
export function checkPressRow(row) {
  const id = clean(row?.id, 40);
  const name = id || 'A row';
  if (!/^JM-[A-Za-z0-9-]+$/.test(id)) return { problem: `${name}: id must start with JM-.` };
  const url = httpUrl(row.url);
  if (!url) return { problem: `${id}: url must be an http or https address.` };
  const date = validDate(row.date);
  if (!date) return { problem: `${id}: date must be YYYY, YYYY-MM or YYYY-MM-DD.` };
  const title = clean(row.title, LIMITS.title);
  if (!title) return { problem: `${id}: title is empty.` };
  const kind = KIND_BY_LABEL.get(clean(row.kind, 40).toLowerCase()) ?? PRESS_KINDS[0];
  return {
    item: {
      id,
      date,
      outlet: clean(row.outlet, LIMITS.outlet) || url.hostname.replace(/^www\./, ''),
      title,
      kind: kind.label,
      format: clean(row.format, LIMITS.format),
      subject: clean(row.subject, LIMITS.subject),
      project: clean(row.project, LIMITS.project),
      url: url.href,
      byline: clean(row.byline, LIMITS.byline),
      featured: isTrue(row.featured),
      wallet_only: isTrue(row.wallet_only)
    }
  };
}

// Rows (objects with the Public tab's columns) as press items, newest first, with a sentence for
// each row that was left out. A repeated id keeps its first row.
export function pressItems(rows) {
  const items = [];
  const problems = [];
  const ids = new Set();
  for (const row of rows) {
    const { item, problem } = checkPressRow(row);
    if (problem) problems.push(problem);
    else if (ids.has(item.id)) problems.push(`${item.id}: id is used twice; the first row is kept.`);
    else {
      ids.add(item.id);
      items.push(item);
    }
  }
  // ISO dates sort as text. Same date: the higher id (the newer row) first, like the sheet.
  const idNumber = (item) => Number(item.id.match(/\d+/)?.[0] ?? 0);
  items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : idNumber(b) - idNumber(a)));
  return { items, problems };
}

// The published CSV as press items. The header row names the columns (any order, any case); a
// file without id, date, title and url columns has no items.
export function pressFromCsv(text) {
  const [header = [], ...lines] = parseCsv(text);
  const names = header.map((cell) => cell.trim().toLowerCase());
  const missing = REQUIRED.filter((column) => !names.includes(column));
  if (missing.length) return { items: [], problems: [`The CSV has no ${missing.join(', ')} column.`] };
  return pressItems(lines.map((cells) => Object.fromEntries(names.map((name, index) => [name, cells[index] ?? '']))));
}

// The committed snapshot, checked the same way as the sheet (build.mjs refuses to build when a
// row is left out).
export const PRESS_SNAPSHOT = pressItems(snapshot);

// The live sheet replaces the snapshot only when it has at least half as many good rows, so an
// emptied or broken tab can't empty the page. (update-press.mjs refreshes the snapshot.)
export const pressMinimum = (snapshotSize) => Math.max(1, Math.ceil(snapshotSize / 2));

// The live Public tab, or null to keep the snapshot. Google answers the published address with
// a redirect to a new one-time address each time, so Cloudflare's fetch cache (cf.cacheTtl, as
// the Films feed uses) wouldn't hit; the CSV is kept in the Cache API under the studio's own
// address instead, for 15 minutes.
export async function livePress(csvUrl, { origin = 'https://songaday.studio', minimum = pressMinimum(PRESS_SNAPSHOT.items.length) } = {}) {
  if (!httpUrl(csvUrl)) return null;
  try {
    const cache = caches.default;
    const key = new Request(`${origin}/press/sheet.csv?source=${encodeURIComponent(csvUrl)}`);
    let csv = await (await cache.match(key))?.text();
    if (csv === undefined) {
      const response = await fetch(csvUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!response.ok) return null;
      csv = await response.text();
      await cache.put(key, new Response(csv, {
        headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': `public, max-age=${PRESS_CACHE_SECONDS}` }
      })).catch(() => {});
    }
    const { items } = pressFromCsv(csv);
    return items.length >= minimum ? items : null;
  } catch {
    return null;
  }
}

function formatDate(date) {
  const [year, month, day] = date.split('-').map(Number);
  if (!month) return String(year);
  return day ? `${MONTHS[month - 1]} ${day}, ${year}` : `${MONTHS[month - 1]} ${year}`;
}

const time = (item) => `<time datetime="${escapeHtml(item.date)}">${formatDate(item.date)}</time>`;
const crypto = (item) => item.wallet_only ? ' data-crypto' : '';
// A group whose every row is wallet-only is itself hidden without a wallet, so no empty heading shows.
const groupCrypto = (items) => items.every((item) => item.wallet_only) ? ' data-crypto' : '';
const kindSlug = (item) => KIND_BY_LABEL.get(item.kind.toLowerCase())?.slug ?? PRESS_KINDS[0].slug;
const link = (item, className, body) =>
  `<a class="${className}" href="${escapeHtml(item.url)}" target="_blank" rel="noopener">${body}</a>`;

// The opening line, in Jonathan's words. Wallet-only rows aren't counted: they're crypto parts.
export function renderPressSummary(items) {
  const shown = items.filter((item) => !item.wallet_only);
  const first = shown.reduce((year, item) => Math.min(year, Number(item.date.slice(0, 4))), Infinity);
  const since = Number.isFinite(first) ? `, since ${first}` : '';
  return `Press, podcasts, radio and TV about me and what I make${since}. ${shown.length.toLocaleString('en-US')} so far.`;
}

function statusLine(shown, total, kind) {
  return kind ? `Showing ${shown.toLocaleString('en-US')} of ${total.toLocaleString('en-US')}.` : `Showing all ${total.toLocaleString('en-US')}.`;
}

// A featured piece is one link: outlet and date, then the title.
function featuredCard(item) {
  return `    <li${crypto(item)}>${link(item, 'press-card', `
      <span class="press-card-meta"><span class="press-outlet">${escapeHtml(item.outlet)}</span> <span class="press-date">${time(item)}</span></span>
      <strong class="press-card-title">${escapeHtml(item.title)}${OUT}</strong>
    `)}</li>`;
}

// Filtered-out rows stay in the page, marked hidden, so the page script can show them again
// without a reload. The layout is on an inner element: the wallet gate's display: revert would
// undo it on the li.
function listItem(item, kind) {
  const hidden = kind && kindSlug(item) !== kind ? ' hidden' : '';
  const format = item.format ? `<span class="press-format">${escapeHtml(item.format)}</span>` : '';
  const byline = item.byline ? ` · ${escapeHtml(item.byline)}` : '';
  return `      <li class="press-item" data-kind="${kindSlug(item)}"${crypto(item)}${hidden}><div class="press-row">
        <p class="press-source"><span class="press-outlet">${escapeHtml(item.outlet)}</span>${format}</p>
        ${link(item, 'press-title', `${escapeHtml(item.title)}${OUT}`)}
        <p class="press-meta">${time(item)}${byline}</p>
      </div></li>`;
}

// The page under the opening line: featured pieces, then every row by year with the kind
// filters. The filters are links (/press/?kind=podcasts), which the Worker answers with the
// other kinds hidden, so they work without JavaScript; press-page.js filters in place.
export function renderPress(items, { kind = null } = {}) {
  const selected = pressKind(kind);
  const matches = (item) => !selected || kindSlug(item) === selected;
  const featured = items.filter((item) => item.featured);
  const featuredHtml = featured.length ? `<section class="press-featured"${groupCrypto(featured)} aria-labelledby="press-featured-title">
  <h2 id="press-featured-title">Featured</h2>
  <ul class="press-cards">
${featured.map(featuredCard).join('\n')}
  </ul>
</section>
` : '';

  const years = [];
  for (const item of items) {
    const year = item.date.slice(0, 4);
    if (years.at(-1)?.year !== year) years.push({ year, items: [] });
    years.at(-1).items.push(item);
  }
  const filters = [{ slug: '', label: 'All' }, ...PRESS_KINDS].map(({ slug, label }) => {
    const current = (slug || null) === selected ? ' aria-current="page"' : '';
    const href = slug ? `/press/?kind=${slug}#press-list` : '/press/#press-list';
    return `    <a href="${href}" data-kind="${slug}"${current}>${escapeHtml(label)}</a>`;
  }).join('\n');
  // Counted as a visitor without a wallet sees it; the page script recounts for wallets.
  const everyone = items.filter((item) => !item.wallet_only);
  const status = statusLine(everyone.filter(matches).length, everyone.length, selected);
  const yearsHtml = years.map(({ year, items: rows }) => {
    const hidden = rows.some((item) => matches(item) && !item.wallet_only) ? '' : ' hidden';
    return `  <section class="press-year"${groupCrypto(rows)}${hidden} aria-labelledby="press-${year}">
    <h3 id="press-${year}">${year}</h3>
    <ul>
${rows.map((item) => listItem(item, selected)).join('\n')}
    </ul>
  </section>`;
  }).join('\n');

  return `${featuredHtml}<section class="press-list" id="press-list" aria-labelledby="press-list-title">
  <h2 id="press-list-title">Everything, newest first</h2>
  <nav class="press-filters" aria-label="Show">
${filters}
  </nav>
  <p class="press-status" role="status">${status}</p>
${yearsHtml}
</section>`;
}
