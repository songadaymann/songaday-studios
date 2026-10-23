// songaday.studio/press/: Jonathan's press, podcast, radio and TV appearances, newest first.
// The rows come from the "Public" tab of the Google Sheet "jonathan_mann_press_inventory". The
// build renders press/press.json (a committed snapshot of that tab) into press/index.html, and
// when PRESS_CSV_URL is set (wrangler.jsonc) the Worker re-renders it from the tab, published to
// the web as CSV, so a new row shows up without a redeploy. On any failure it keeps the snapshot.
// Nothing from the sheet is trusted as HTML: every value is escaped, and links must be http(s).
import { escapeHtml } from './films.mjs';
import snapshot from './press/press.json' with { type: 'json' };

// The Public tab's header row, in order. update-press.mjs writes press/press.json the same way.
// The CSV must have each of these exactly once: without wallet_only, the wallet-only rows would
// show to everyone.
export const PRESS_COLUMNS = ['id', 'date', 'outlet', 'title', 'kind', 'format', 'subject', 'project', 'url',
  'byline', 'featured', 'wallet_only'];

// The kinds the sheet's formula sorts rows into, and their filter addresses (/press/?kind=tv).
export const PRESS_KINDS = [
  { slug: 'press', label: 'Press' },
  { slug: 'podcasts', label: 'Podcasts & radio' },
  { slug: 'tv', label: 'TV & video' }
];
const KIND_BY_LABEL = new Map(PRESS_KINDS.map((kind) => [kind.label.toLowerCase(), kind]));
export const pressKind = (slug) => PRESS_KINDS.find((kind) => kind.slug === slug)?.slug ?? null;

// The project filter's groups (/press/?project=sec). The sheet's project column is free text, so
// each group lists the values that belong to it, in any case. A value no group lists goes under
// Other, which shows only when it has rows: when one turns up (update-press.mjs names it), add it
// to a group here, or add a group. Everyone sees these labels, so none may use crypto words.
export const PRESS_PROJECTS = [
  { slug: 'song-a-day', label: 'Song A Day', projects: ['Song A Day', 'Song A Day / Hugh Mann', 'Career overview',
    'Selling Song A Day NFTs', 'Crypto Tax Nightmare / Song A Day 6000'] },
  { slug: 'sec', label: 'The SEC lawsuit', projects: ['Suing the SEC'] },
  { slug: 'gamejew', label: 'GameJew', projects: ['GameJew'] },
  { slug: 'coldplay', label: 'Coldplay Canoodle', projects: ['Coldplay Canoodle'] },
  { slug: 'mario-opera', label: 'The Mario Opera', projects: ['The Mario Opera'] },
  { slug: 'wamp', label: 'WAMP', projects: ['WAMP', 'WAMP / AI-built projects'] },
  { slug: 'x-play', label: 'X-Play: The Musical', projects: ['X-Play: The Musical'] }
];
export const PRESS_OTHER = { slug: 'other', label: 'Other' };
const PROJECT_GROUPS = [...PRESS_PROJECTS, PRESS_OTHER];
const GROUP_BY_PROJECT = new Map(PRESS_PROJECTS.flatMap((group) => group.projects.map((project) => [project.toLowerCase(), group])));
export const pressProjectGroup = (project) => GROUP_BY_PROJECT.get(String(project ?? '').trim().toLowerCase()) ?? PRESS_OTHER;
export const pressProject = (slug) => PROJECT_GROUPS.find((group) => group.slug === slug)?.slug ?? null;

// The filters in the page's address (/press/?kind=podcasts&project=sec&year=2024), in that order.
// Each is null when it's missing or isn't one of the page's own, so a made-up address shows the
// whole list. renderPress checks the project and year against the rows too.
const FILTERS = ['kind', 'project', 'year'];
export function pressFilters(params) {
  const year = params.get('year') ?? '';
  return { kind: pressKind(params.get('kind')), project: pressProject(params.get('project')), year: /^\d{4}$/.test(year) ? year : null };
}

// The Worker re-reads the sheet at most every 15 minutes per Cloudflare location, and waits
// this long for it before the page keeps the snapshot. A failed read is remembered for a minute,
// so a slow or broken sheet costs one wait a minute, not one per view.
export const PRESS_CACHE_SECONDS = 900;
export const PRESS_FAILURE_SECONDS = 60;
const FETCH_TIMEOUT_MS = 2000;
// The sheet is about 50 KB and 200 rows. Far more than that is a mistake, and too much to parse
// and render on every view, so it's ignored.
export const PRESS_MAX_BYTES = 1_000_000;
export const PRESS_MAX_ROWS = 2000;
const MAX_URL = 2048;

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

// Plain one-line text: no control characters, runs of space collapsed, and a length cap. The
// invisible text-direction marks and overrides (which can flip how the rest of a line reads),
// zero-width spaces and byte order marks are removed. The zero-width joiners stay: emoji need them.
const clean = (value, max) => String(value ?? '')
  .replace(/[\u061c\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
  .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')
  .replace(/\s+/g, ' ').trim().slice(0, max).trim();

// TRUE or FALSE, as Sheets writes a checkbox or a comparison (true or false in press.json); empty
// is FALSE. Anything else is null and the row is left out, so a wallet-only row can't show to
// everyone because its box held "x" or "yes".
function flag(value) {
  if (typeof value === 'boolean') return value;
  const text = String(value ?? '').trim().toLowerCase();
  return text === 'true' ? true : text === 'false' || text === '' ? false : null;
}

function httpUrl(value) {
  try {
    const url = new URL(String(value ?? '').trim());
    if ((url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password) return url;
  } catch {}
  return null;
}

// YYYY, YYYY-MM or YYYY-MM-DD: a real calendar date from 1990 to next year. This reads the clock,
// so it must only run inside a request: in a Worker the clock reads 1970 while the module loads.
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
  if (url.href.length > MAX_URL) return { problem: `${id}: url is longer than ${MAX_URL.toLocaleString('en-US')} characters.` };
  const date = validDate(row.date);
  if (!date) return { problem: `${id}: date must be YYYY, YYYY-MM or YYYY-MM-DD.` };
  const title = clean(row.title, LIMITS.title);
  if (!title) return { problem: `${id}: title is empty.` };
  const featured = flag(row.featured);
  const walletOnly = flag(row.wallet_only);
  if (featured === null || walletOnly === null) return { problem: `${id}: featured and wallet_only must be TRUE, FALSE or empty.` };
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
      featured,
      wallet_only: walletOnly
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

// The published CSV as press items. The header row names the columns, in any order and any case,
// and must have each of PRESS_COLUMNS exactly once; other columns are ignored. A file without
// them, or with more than PRESS_MAX_ROWS rows, has no items.
export function pressFromCsv(text) {
  const [header = [], ...lines] = parseCsv(text);
  const names = header.map((cell) => cell.trim().toLowerCase());
  const count = (column) => names.filter((name) => name === column).length;
  const missing = PRESS_COLUMNS.filter((column) => count(column) === 0);
  if (missing.length) return { items: [], problems: [`The CSV has no ${missing.join(', ')} column.`] };
  const repeated = PRESS_COLUMNS.filter((column) => count(column) > 1);
  if (repeated.length) return { items: [], problems: [`The CSV has more than one ${repeated.join(', ')} column.`] };
  if (lines.length > PRESS_MAX_ROWS) {
    return { items: [], problems: [`The CSV has ${lines.length.toLocaleString('en-US')} rows, more than ${PRESS_MAX_ROWS.toLocaleString('en-US')}.`] };
  }
  const index = new Map(PRESS_COLUMNS.map((column) => [column, names.indexOf(column)]));
  return pressItems(lines.map((cells) => Object.fromEntries(PRESS_COLUMNS.map((column) => [column, cells[index.get(column)] ?? '']))));
}

// The committed snapshot, checked the same way as the sheet (build.mjs refuses to build when a
// row is left out). It's checked on first use, not when the module loads, because the date check
// reads the clock.
let checkedSnapshot;
export const pressSnapshot = () => (checkedSnapshot ??= pressItems(snapshot));

// The live sheet replaces the snapshot only when it has at least half as many good rows, so an
// emptied or broken tab can't empty the page. (update-press.mjs refreshes the snapshot.)
export const pressMinimum = (snapshotSize) => Math.max(1, Math.ceil(snapshotSize / 2));

// The CSV's text, or null when the sheet can't be read or is over PRESS_MAX_BYTES. The body is
// read in pieces and dropped once it's too big, so a huge file is never held whole. The timeout
// covers the body too.
async function readSheet(csvUrl) {
  try {
    const response = await fetch(csvUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok || Number(response.headers.get('Content-Length')) > PRESS_MAX_BYTES) {
      await response.body?.cancel().catch(() => {});
      return null;
    }
    if (!response.body) return '';
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let size = 0;
    let text = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      size += value.byteLength;
      if (size > PRESS_MAX_BYTES) {
        await reader.cancel().catch(() => {});
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
  } catch {
    return null;
  }
}

// The live Public tab, or null to keep the snapshot. Google answers the published address with
// a redirect to a new one-time address each time, so Cloudflare's fetch cache (cf.cacheTtl, as
// the Films feed uses) wouldn't hit; the CSV is kept in the Cache API under the studio's own
// address instead, for 15 minutes, and a failed read is kept there as a marker for a minute.
export async function livePress(csvUrl, { origin = 'https://songaday.studio', minimum = pressMinimum(pressSnapshot().items.length) } = {}) {
  if (!httpUrl(csvUrl)) return null;
  try {
    const cache = caches.default;
    const key = new Request(`${origin}/press/sheet.csv?source=${encodeURIComponent(csvUrl)}`);
    const cached = await cache.match(key);
    if (cached?.headers.get('X-Press-Failed')) return null;
    let csv = await cached?.text();
    if (csv === undefined) {
      csv = await readSheet(csvUrl);
      const failed = csv === null;
      await cache.put(key, new Response(csv ?? '', {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Cache-Control': `public, max-age=${failed ? PRESS_FAILURE_SECONDS : PRESS_CACHE_SECONDS}`,
          ...(failed && { 'X-Press-Failed': '1' })
        }
      })).catch(() => {});
      if (failed) return null;
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
const hidden = (hide) => hide ? ' hidden' : '';
const kindSlug = (item) => KIND_BY_LABEL.get(item.kind.toLowerCase())?.slug ?? PRESS_KINDS[0].slug;
// What a row is filed under, for each filter.
const filedUnder = (item) => ({ kind: kindSlug(item), project: pressProjectGroup(item.project).slug, year: item.date.slice(0, 4) });
const link = (item, className, body) =>
  `<a class="${className}" href="${escapeHtml(item.url)}" target="_blank" rel="noopener">${body}</a>`;
// The address of a set of filters, as the Worker reads it: /press/?kind=tv&year=2010#press-list.
// The values are the page's own slugs and years, so nothing needs escaping but the &.
const filterHref = (filters) => {
  const query = FILTERS.filter((name) => filters[name]).map((name) => `${name}=${filters[name]}`).join('&amp;');
  return `/press/${query && `?${query}`}#press-list`;
};

// A count the page script updates once the wallet gate decides: wallet-only rows count only for
// browsers that show them.
const count = (n) => `<span data-press-count>${n.toLocaleString('en-US')}</span>`;
const forEveryone = (items) => items.filter((item) => !item.wallet_only);

// The opening line, in Jonathan's words. Wallet-only rows aren't counted: they're crypto parts.
export function renderPressSummary(items) {
  const shown = forEveryone(items);
  const first = shown.reduce((year, item) => Math.min(year, Number(item.date.slice(0, 4))), Infinity);
  const since = Number.isFinite(first) ? ` since ${first}` : '';
  return `Press, podcasts, radio and TV about me and what I make${since}: ${count(shown.length)} ${shown.length === 1 ? 'piece' : 'pieces'} so far.`;
}

// A featured piece is one link: outlet and date, then the title.
function featuredCard(item) {
  return `    <li${crypto(item)}>${link(item, 'press-card', `
      <span class="press-card-meta"><span class="press-outlet">${escapeHtml(item.outlet)}</span> <span class="press-date">${time(item)}</span></span>
      <strong class="press-card-title">${escapeHtml(item.title)}${OUT}</strong>
    `)}</li>`;
}

// The newest featured pieces show; the rest wait behind "13 more featured", so the full list
// isn't three phone screens down.
const FEATURED_SHOWN = 8;

function renderFeatured(featured, hide) {
  if (!featured.length) return '';
  const more = featured.slice(FEATURED_SHOWN);
  const moreHtml = more.length ? `
  <details class="press-more"${groupCrypto(more)}>
    <summary><span data-press-more-count>${forEveryone(more).length}</span> more featured</summary>
    <ul class="press-cards">
${more.map(featuredCard).join('\n')}
    </ul>
  </details>` : '';
  return `<section class="press-featured"${groupCrypto(featured)}${hidden(hide)} aria-labelledby="press-featured-title">
  <h2 id="press-featured-title">Featured</h2>
  <ul class="press-cards">
${featured.slice(0, FEATURED_SHOWN).map(featuredCard).join('\n')}
  </ul>${moreHtml}
</section>
`;
}

// Filtered-out rows stay in the page, marked hidden, so the page script can show them again
// without a reload. The layout is on an inner element: the wallet gate's display: revert would
// undo it on the li.
function listItem(item, filed, hide) {
  const format = item.format ? `<span class="press-format">${escapeHtml(item.format)}</span>` : '';
  const byline = item.byline ? ` · ${escapeHtml(item.byline)}` : '';
  return `      <li class="press-item" data-kind="${filed.kind}" data-project="${filed.project}" data-year="${filed.year}"${crypto(item)}${hidden(hide)}><div class="press-row">
        <p class="press-source"><span class="press-outlet">${escapeHtml(item.outlet)}</span>${format}</p>
        ${link(item, 'press-title', `${escapeHtml(item.title)}${OUT}`)}
        <p class="press-meta">${time(item)}${byline}</p>
      </div></li>`;
}

// The page under the opening line: a link down to the list, the featured pieces, then every row
// by year with the filters: kind links, and project and year menus. Together they're an address
// (/press/?kind=podcasts&project=sec&year=2024) that the Worker answers with the other rows
// hidden, so they work without JavaScript (the menus' Show button sends them); press-page.js
// filters in place. Any filter hides the featured pieces, and the link down past them.
export function renderPress(items, filters = {}) {
  const rows = items.map((item) => ({ item, filed: filedUnder(item) }));
  const years = [];
  for (const row of rows) {
    if (years.at(-1)?.year !== row.filed.year) years.push({ year: row.filed.year, rows: [] });
    years.at(-1).rows.push(row);
  }
  // A project or year is a filter only when some row is filed under it.
  const chosen = { kind: pressKind(filters.kind) };
  for (const name of ['project', 'year']) chosen[name] = rows.some(({ filed }) => filed[name] === filters[name]) ? filters[name] : null;
  const on = FILTERS.some((name) => chosen[name]);
  // Whether a row passes every filter that's on, or every one but `except`.
  const matches = ({ filed }, except) => FILTERS.every((name) => name === except || !chosen[name] || filed[name] === chosen[name]);
  const featured = items.filter((item) => item.featured);
  const everyone = rows.filter(({ item }) => !item.wallet_only);
  const jump = featured.length
    ? `<p class="press-jump"${hidden(on)}><a href="#press-list">All ${count(everyone.length)}, newest first <span aria-hidden="true">↓</span></a></p>\n`
    : '';

  const kinds = [{ slug: '', label: 'All' }, ...PRESS_KINDS].map(({ slug, label }) => {
    const current = (slug || null) === chosen.kind ? ' aria-current="page"' : '';
    return `    <a href="${filterHref({ ...chosen, kind: slug })}" data-kind="${slug}"${current}>${escapeHtml(label)}</a>`;
  }).join('\n');
  // Each menu choice counts the rows it would show with the other filters as they are, as a
  // visitor without a wallet sees them (the page script recounts for wallets). One at 0 can still
  // be picked, so going from one project or year to another never takes two steps. A choice no row
  // is filed under isn't there, and one whose rows are all wallet-only is a crypto part, which
  // can't be picked without a wallet either (some phones show a hidden option anyway).
  const menu = (name, label, all, choices) => {
    const options = choices.map((choice) => {
      const own = rows.filter(({ filed }) => filed[name] === choice.slug);
      if (!own.length) return '';
      const n = own.filter((row) => !row.item.wallet_only && matches(row, name)).length;
      const walletOnly = groupCrypto(own.map(({ item }) => item));
      const state = `${walletOnly}${walletOnly && ' disabled'}${choice.slug === chosen[name] ? ' selected' : ''}`;
      return `\n        <option value="${choice.slug}"${state}>${escapeHtml(choice.label)} (${n.toLocaleString('en-US')})</option>`;
    }).join('');
    return `    <label class="press-pick-${name}"><span>${label}</span>
      <select name="${name}">
        <option value="">${all}</option>${options}
      </select>
    </label>`;
  };
  // The menus send the kind along with them.
  const keepKind = chosen.kind ? `\n    <input type="hidden" name="kind" value="${chosen.kind}">` : '';
  // Counted as a visitor without a wallet sees it; the page script recounts for wallets. With no
  // filter on there's no count line (the opening line has the total) and nothing to clear.
  const status = on
    ? `Showing ${everyone.filter((row) => matches(row)).length.toLocaleString('en-US')} of ${everyone.length.toLocaleString('en-US')}.`
    : '';
  const yearsHtml = years.map(({ year, rows: inYear }) => {
    const empty = !inYear.some((row) => matches(row) && !row.item.wallet_only);
    return `  <section class="press-year"${groupCrypto(inYear.map(({ item }) => item))}${hidden(empty)} aria-labelledby="press-${year}">
    <h3 id="press-${year}">${year}</h3>
    <ul>
${inYear.map((row) => listItem(row.item, row.filed, !matches(row))).join('\n')}
    </ul>
  </section>`;
  }).join('\n');

  return `${jump}${renderFeatured(featured, on)}<section class="press-list" id="press-list" aria-labelledby="press-list-title">
  <h2 id="press-list-title">All of it, newest first</h2>
  <nav class="press-filters" aria-label="Show">
${kinds}
  </nav>
  <form class="press-pick" action="/press/#press-list" method="get">${keepKind}
${menu('project', 'Project', 'All projects', PROJECT_GROUPS)}
${menu('year', 'Year', 'All years', years.map(({ year }) => ({ slug: year, label: year })))}
    <button type="submit">Show</button>
  </form>
  <div class="press-status-row">
    <p class="press-status" role="status">${status}</p>
    <a class="press-clear" href="/press/#press-list"${hidden(!on)}>Clear filters</a>
  </div>
${yearsHtml}
</section>`;
}
