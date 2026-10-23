import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import worker from '../worker.mjs';
import { PRESS_COLUMNS, PRESS_SNAPSHOT, livePress, parseCsv, pressFromCsv, pressItems, pressMinimum, renderPress,
  renderPressSummary } from '../press.mjs';

const root = new URL('../', import.meta.url);
const snapshot = JSON.parse(await readFile(new URL('press/press.json', root), 'utf8'));
const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-test/pub?gid=1&single=true&output=csv';

// A sheet row with every column, as the Public tab would have it.
const row = (fields = {}) => ({
  id: 'JM-001', date: '2020-05-06', outlet: 'Outlet', title: 'A title', kind: 'Press', format: 'Article',
  subject: 'Music', project: 'Song A Day', url: 'https://example.com/a', byline: '', featured: 'FALSE',
  wallet_only: 'FALSE', ...fields
});
const csvCell = (value) => /[",\r\n]/.test(String(value)) ? `"${String(value).replaceAll('"', '""')}"` : String(value);
const toCsv = (rows, columns = PRESS_COLUMNS) =>
  [columns, ...rows.map((entry) => columns.map((column) => entry[column] ?? ''))].map((cells) => cells.map(csvCell).join(',')).join('\r\n');
// Rows (snapshot items or row()s) as the published CSV, with Google's TRUE and FALSE.
const sheetCsv = (rows) => toCsv(rows.map((entry) => ({ ...entry, featured: String(entry.featured).toUpperCase(),
  wallet_only: String(entry.wallet_only).toUpperCase() })));
const one = (fields) => pressItems([row(fields)]);

test('CSV: quoted commas, quotes and line breaks, CRLF, a byte order mark and blank lines', () => {
  assert.deepEqual(parseCsv('\uFEFFid,title\r\nJM-1,"Hello, world"\r\n\r\nJM-2,"Say ""hi""\nand bye"\nJM-3,\n'), [
    ['id', 'title'], ['JM-1', 'Hello, world'], ['JM-2', 'Say "hi"\nand bye'], ['JM-3', '']
  ]);
  // No newline at the end, an empty quoted field, an empty last field, and a lone \r.
  assert.deepEqual(parseCsv('a,"",c\rx,y,'), [['a', '', 'c'], ['x', 'y', '']]);
  // A quote inside an unquoted field is just a character; text after a closing quote is kept.
  assert.deepEqual(parseCsv('5" record,"quoted"tail'), [['5" record', 'quotedtail']]);
  assert.deepEqual(parseCsv(''), []);
  assert.deepEqual(parseCsv('\n\r\n , \n'), []);
});

test('CSV: columns are found by name, in any order and case; a file without them has no rows', () => {
  const csv = 'URL,Title,ID,Date,Kind,Featured,Wallet_Only\nhttps://example.com/x,"Song, a day",JM-7,2014-07-01,TV & video,TRUE,FALSE\n';
  const { items, problems } = pressFromCsv(csv);
  assert.deepEqual(problems, []);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Song, a day');
  assert.equal(items[0].kind, 'TV & video');
  assert.equal(items[0].featured, true);
  assert.equal(items[0].outlet, 'example.com', 'an empty outlet falls back to the site name');
  assert.equal(items[0].byline, '');

  assert.deepEqual(pressFromCsv('<!doctype html><html><body>Sign in</body></html>').items, []);
  assert.match(pressFromCsv('id,title\nJM-1,x').problems[0], /no date, url column/);
});

test('rows need a JM- id, an http(s) link and a real date', () => {
  assert.equal(one({}).items.length, 1);
  for (const id of ['', 'jm-001', 'XX-001', 'JM-', 'JM-1 2', '=HYPERLINK("x")']) {
    assert.match(one({ id }).problems.join(), /id must start with JM-/, id);
  }
  for (const url of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>1</script>', 'ftp://example.com/',
    '//example.com/a', '/press/', 'example.com', '', 'https://user:pass@example.com/']) {
    assert.match(one({ url }).problems.join(), /url must be an http or https address/, url);
  }
  assert.equal(one({ url: 'http://example.com' }).items[0].url, 'http://example.com/');
  for (const date of ['2025-02-30', '2025-13', '2025-00-10', '25-01-01', '2025/01/01', 'July 2010', '1989', '2999-01-01', '']) {
    assert.match(one({ date }).problems.join(), /date must be/, date);
  }
  for (const date of ['2021', '2009-04', '2024-02-29']) assert.equal(one({ date }).items[0].date, date);
  assert.match(one({ title: '  \n ' }).problems.join(), /title is empty/);
});

test('rows are cleaned up: plain one-line text, a known kind, true or false', () => {
  const [item] = one({ title: '  Two\nlines\t and\u0000 tabs  ', outlet: 'x'.repeat(500), kind: 'Radio', featured: 'true',
    wallet_only: 'TRUE', byline: ' Jane  Doe ' }).items;
  assert.equal(item.title, 'Two lines and tabs');
  assert.equal(item.outlet.length, 120);
  assert.equal(item.kind, 'Press', 'an unknown kind counts as Press');
  assert.equal(item.featured, true);
  assert.equal(item.wallet_only, true);
  assert.equal(item.byline, 'Jane Doe');
  assert.equal(one({ kind: 'podcasts & RADIO' }).items[0].kind, 'Podcasts & radio');
  assert.equal(one({ featured: 'FALSE', wallet_only: '' }).items[0].featured, false);
});

test('rows come out newest first, and a repeated id keeps its first row', () => {
  const { items, problems } = pressItems([
    row({ id: 'JM-001', date: '2010' }), row({ id: 'JM-002', date: '2010-07-16' }), row({ id: 'JM-010', date: '2010-07-16' }),
    row({ id: 'JM-003', date: '2010-07' }), row({ id: 'JM-004', date: '2026-01-31' }), row({ id: 'JM-002', title: 'Again' })
  ]);
  assert.deepEqual(items.map((item) => item.id), ['JM-004', 'JM-010', 'JM-002', 'JM-003', 'JM-001']);
  assert.equal(items.find((item) => item.id === 'JM-002').date, '2010-07-16');
  assert.deepEqual(problems, ['JM-002: id is used twice; the first row is kept.']);
});

test('press/press.json is the Public tab: every row valid, in order, and it survives a trip through CSV', () => {
  assert.deepEqual(PRESS_SNAPSHOT.problems, []);
  assert.deepEqual(PRESS_SNAPSHOT.items, snapshot, 'the snapshot is already clean and sorted');
  assert.equal(snapshot.length, 184);
  for (const entry of snapshot) assert.deepEqual(Object.keys(entry), PRESS_COLUMNS, entry.id);
  assert.equal(snapshot.filter((entry) => entry.featured).length, 22);
  assert.deepEqual(snapshot.filter((entry) => entry.wallet_only).map((entry) => entry.id), ['JM-112']);
  assert.deepEqual(pressFromCsv('\uFEFF' + sheetCsv(snapshot)).items, snapshot);
});

test('nothing from the sheet reaches the page as HTML', () => {
  const evil = '<img src=x onerror="alert(1)"> & \'quoted\'';
  const { items } = pressItems([row({ title: evil, outlet: evil, byline: evil, format: evil, featured: 'TRUE',
    url: 'https://example.com/"><script>alert(1)</script>' })]);
  const html = renderPress(items) + renderPressSummary(items);
  assert.doesNotMatch(html, /<img|<script|onerror="/);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt; &amp; &#39;quoted&#39;/);
  assert.match(html, /href="https:\/\/example\.com\/%22%3E%3Cscript%3Ealert\(1\)%3C\/script%3E" target="_blank" rel="noopener"/);
  // Every link on the page is to the press piece (http/https) or a filter on this page.
  for (const [, href] of html.matchAll(/href="([^"]*)"/g)) assert.match(href, /^(https?:\/\/|\/press\/)/, href);
});

test('the page: featured first, every row by year, links that open in a new tab', () => {
  const html = renderPress(PRESS_SNAPSHOT.items);
  assert.ok(html.indexOf('id="press-featured-title"') < html.indexOf('id="press-list-title"'));
  assert.equal((html.match(/class="press-card"/g) ?? []).length, 22);
  assert.equal((html.match(/class="press-item"/g) ?? []).length, 184);
  assert.equal((html.match(/target="_blank" rel="noopener"/g) ?? []).length, 22 + 184);
  const years = [...html.matchAll(/<h3 id="press-(\d{4})">/g)].map((match) => Number(match[1]));
  assert.deepEqual(years, [...years].sort((a, b) => b - a));
  assert.equal(years[0], 2026);
  assert.equal(years.at(-1), 2006);
  // Each row: outlet, the linked title, the date, the byline when there is one, and the format.
  assert.match(html, /<span class="press-outlet">Reuters<\/span><span class="press-format">Wire article<\/span><\/p>\s*<a class="press-title" href="https:\/\/www\.reuters\.com\/[^"]+" target="_blank" rel="noopener">US judge rejects NFT artists&#39; lawsuit against SEC<span class="nav-out" aria-hidden="true">↗<\/span><\/a>\s*<p class="press-meta"><time datetime="2025-09-30">September 30, 2025<\/time> · [^<]+<\/p>/);
  assert.match(html, /<time datetime="2009-04">April 2009<\/time>/);
  assert.match(html, /<time datetime="2021">2021<\/time><\/p>/, 'a row with no byline has just the date');
  assert.match(html, /<span class="press-card-meta"><span class="press-outlet">TIME<\/span> <span class="press-date"><time datetime="2023-08-22">August 22, 2023<\/time><\/span><\/span>\s*<strong class="press-card-title">How an Unknown Country Singer/);
  // No filter: nothing hidden, All is the current filter.
  assert.doesNotMatch(html, / hidden[ >]/);
  assert.match(html, /<a href="\/press\/#press-list" data-kind="" aria-current="page">All<\/a>/);
  assert.match(html, /<p class="press-status" role="status">Showing all 183\.<\/p>/);
  assert.match(renderPressSummary(PRESS_SNAPSHOT.items), /^Press, podcasts, radio and TV about me and what I make, since 2006\. 183 so far\.$/);
});

test('wallet-only rows are crypto parts: behind data-crypto, and not counted', () => {
  const html = renderPress(PRESS_SNAPSHOT.items);
  assert.equal((html.match(/data-crypto/g) ?? []).length, 1);
  assert.match(html, /<li class="press-item" data-kind="press" data-crypto><div class="press-row">\s*<p class="press-source"><span class="press-outlet">OpenSea<\/span>/);

  const items = pressItems([row({ id: 'JM-001', date: '2024-01-01', wallet_only: 'TRUE', featured: 'TRUE' }),
    row({ id: 'JM-002', date: '2023-01-01' })]).items;
  const small = renderPress(items);
  // A featured wallet-only piece, and a year with only wallet-only rows, wait for a wallet too.
  assert.match(small, /<section class="press-featured" data-crypto aria-labelledby="press-featured-title">\s*<h2[^>]*>Featured<\/h2>\s*<ul class="press-cards">\s*<li data-crypto>/);
  assert.match(small, /<section class="press-year" data-crypto hidden aria-labelledby="press-2024">/);
  assert.match(small, /<section class="press-year" aria-labelledby="press-2023">/);
  assert.match(small, /Showing all 1\./);
  assert.match(renderPressSummary(items), /since 2023\. 1 so far\./);
  assert.doesNotMatch(renderPress(items.slice(1)), /press-featured/, 'no featured section when nothing is featured');
});

test('a kind filter hides the other rows and the years left empty, and marks its link', () => {
  const html = renderPress(PRESS_SNAPSHOT.items, { kind: 'tv' });
  const shown = [...html.matchAll(/<li class="press-item" data-kind="(\w+)"( data-crypto)?( hidden)?>/g)];
  assert.equal(shown.length, 184);
  assert.ok(shown.every(([, kind, , hidden]) => (kind === 'tv') === !hidden));
  assert.equal(shown.filter(([, kind]) => kind === 'tv').length, 8);
  assert.match(html, /<a href="\/press\/\?kind=tv#press-list" data-kind="tv" aria-current="page">TV &amp; video<\/a>/);
  assert.doesNotMatch(html, /data-kind="" aria-current/);
  assert.match(html, /Showing 8 of 183\./);
  // A year is hidden exactly when it has no TV row.
  const years = new Set(snapshot.map((entry) => entry.date.slice(0, 4)));
  const tvYears = new Set(snapshot.filter((entry) => entry.kind === 'TV & video').map((entry) => entry.date.slice(0, 4)));
  assert.ok(tvYears.size > 1 && tvYears.size < years.size);
  for (const year of years) {
    assert.match(html, new RegExp(`<section class="press-year"${tvYears.has(year) ? '' : ' hidden'} aria-labelledby="press-${year}">`), year);
  }
  // Featured pieces aren't filtered, and an unknown kind is the whole list.
  assert.equal((html.match(/class="press-card"/g) ?? []).length, 22);
  assert.equal(renderPress(PRESS_SNAPSHOT.items, { kind: 'nope' }), renderPress(PRESS_SNAPSHOT.items));
  assert.match(renderPress(PRESS_SNAPSHOT.items, { kind: 'podcasts' }), /Showing 29 of 183\./);
});

// A stand-in for the Workers Cache API.
function fakeCache() {
  const store = new Map();
  return {
    store,
    default: {
      async match(request) { return store.has(request.url) ? new Response(store.get(request.url)) : undefined; },
      async put(request, response) { store.set(request.url, await response.text()); }
    }
  };
}

async function withFetch(handler, run) {
  const realFetch = globalThis.fetch;
  const realCaches = globalThis.caches;
  const fetched = [];
  const cache = fakeCache();
  globalThis.caches = cache;
  globalThis.fetch = async (url, init) => { fetched.push(String(url)); return handler(url, init); };
  try {
    return await run({ fetched, cache });
  } finally {
    globalThis.fetch = realFetch;
    if (realCaches === undefined) delete globalThis.caches;
    else globalThis.caches = realCaches;
  }
}

test('the live sheet is read, cached for 15 minutes, and checked before it replaces the snapshot', async () => {
  const live = [row({ id: 'JM-205', date: '2026-10-22', title: 'Brand new', featured: 'TRUE' }), ...snapshot.slice(0, 100)];
  await withFetch(async () => new Response(sheetCsv(live)), async ({ fetched, cache }) => {
    const items = await livePress(CSV_URL);
    assert.equal(items.length, 101);
    assert.equal(items[0].title, 'Brand new');
    assert.deepEqual(fetched, [CSV_URL]);
    const [key] = cache.store.keys();
    assert.equal(key, `https://songaday.studio/press/sheet.csv?source=${encodeURIComponent(CSV_URL)}`);
    // The second visit within the cache time doesn't ask Google again.
    assert.equal((await livePress(CSV_URL)).length, 101);
    assert.equal(fetched.length, 1);
  });

  // Not set, or not a web address: the sheet isn't asked at all.
  await withFetch(async () => new Response(sheetCsv(snapshot)), async ({ fetched }) => {
    for (const csvUrl of [undefined, '', 'javascript:alert(1)', 'file:///etc/passwd']) assert.equal(await livePress(csvUrl), null);
    assert.deepEqual(fetched, []);
  });
});

test('on any failure, or too few good rows, the live sheet is ignored', async () => {
  const failures = [
    () => new Response('nope', { status: 500 }),
    () => new Response('<!doctype html><title>Sign in</title>'),
    () => new Response(sheetCsv(snapshot.slice(0, pressMinimum(snapshot.length) - 1))),
    () => new Response(sheetCsv(snapshot.map((entry) => ({ ...entry, url: 'javascript:alert(1)' })))),
    () => { throw new TypeError('network down'); },
    () => { throw new DOMException('The operation timed out.', 'TimeoutError'); }
  ];
  for (const failure of failures) {
    await withFetch(failure, async ({ cache }) => {
      assert.equal(await livePress(CSV_URL), null, String(failure));
      if (cache.store.size) assert.equal(await livePress(CSV_URL), null, 'a cached bad file stays ignored');
    });
  }
  assert.equal(pressMinimum(184), 92);
  await withFetch(() => new Response(sheetCsv(snapshot.slice(0, 92))), async () => {
    assert.equal((await livePress(CSV_URL)).length, 92);
  });
  // The fetch has a timeout.
  await withFetch((url, init) => {
    assert.ok(init.signal instanceof AbortSignal);
    return new Response(sheetCsv(snapshot));
  }, () => livePress(CSV_URL));
});

// The Worker's /press/ page, with a stand-in HTMLRewriter that records the handlers.
async function pressPage(path, env = {}) {
  const handlers = [];
  globalThis.HTMLRewriter = class {
    on(selector, handler) { handlers.push({ selector, handler }); return this; }
    transform(response) { return response; }
  };
  try {
    const response = await worker.fetch(new Request('https://songaday.studio' + path), {
      ...env,
      ASSETS: { fetch: async () => new Response('<div id="press"></div>', { headers: { 'Content-Type': 'text/html' } }) }
    });
    const fill = async (selector) => {
      const entry = handlers.find((item) => item.selector === selector);
      if (!entry) return null;
      let html = null;
      await entry.handler.element({ setInnerContent(content, options) { html = content; assert.deepEqual(options, { html: true }); } });
      return html;
    };
    return { response, list: await fill('#press'), summary: await fill('#press-summary') };
  } finally {
    delete globalThis.HTMLRewriter;
  }
}

test('/press/ keeps the built page, swaps in the live sheet, and filters by kind without JavaScript', async () => {
  // No sheet yet, no filter: the built page as it is.
  const built = await pressPage('/press/');
  assert.equal(built.response.status, 200);
  assert.equal(built.list, null);
  assert.equal(built.summary, null);

  // ?kind= re-renders the snapshot with the other kinds hidden.
  const filtered = await pressPage('/press/?kind=podcasts');
  assert.equal(filtered.list, renderPress(PRESS_SNAPSHOT.items, { kind: 'podcasts' }));
  assert.equal(filtered.summary, null);
  assert.equal((await pressPage('/press/?kind=<script>')).list, null);

  const live = [row({ id: 'JM-205', date: '2026-10-22', title: 'Brand new' }), ...snapshot.slice(0, 100)];
  await withFetch(async () => new Response(sheetCsv(live)), async ({ fetched }) => {
    const page = await pressPage('/press/?kind=press', { PRESS_CSV_URL: CSV_URL });
    assert.match(page.list, /Brand new/);
    assert.match(page.list, /aria-current="page">Press<\/a>/);
    // JM-112, in the first 100, is wallet-only, so it isn't counted.
    assert.match(page.summary, /^Press, podcasts, radio and TV about me and what I make, since 2014\. 100 so far\.$/);
    assert.deepEqual(fetched, [CSV_URL]);
  });

  // A failing sheet leaves the built page alone.
  await withFetch(async () => new Response('blocked', { status: 403 }), async () => {
    const page = await pressPage('/press/', { PRESS_CSV_URL: CSV_URL });
    assert.equal(page.list, null);
    assert.equal(page.summary, null);
  });

  // HEAD and other pages don't ask the sheet.
  await withFetch(async () => new Response(sheetCsv(snapshot)), async ({ fetched }) => {
    globalThis.HTMLRewriter = class { on() { return this; } transform(response) { return response; } };
    try {
      const env = { PRESS_CSV_URL: CSV_URL, ASSETS: { fetch: async () => new Response('<p></p>', { headers: { 'Content-Type': 'text/html' } }) } };
      await worker.fetch(new Request('https://songaday.studio/press/', { method: 'HEAD' }), env);
      await worker.fetch(new Request('https://songaday.studio/now/'), env);
    } finally {
      delete globalThis.HTMLRewriter;
    }
    assert.deepEqual(fetched, []);
  });
});

test('/press is a folder page, and /podcasts, /interviews and /media go to it', async () => {
  const env = { ASSETS: { fetch: async () => new Response('asset', { headers: { 'Content-Type': 'image/png' } }) } };
  for (const [spelling, location] of [['/press', '/press/'], ['/Press', '/press/'], ['/PRESS/', '/press/'], ['/press?kind=tv', '/press/?kind=tv'],
    ['/podcasts', '/press/'], ['/Interviews/', '/press/'], ['/media', '/press/'], ['/media?from=bio', '/press/?from=bio']]) {
    const response = await worker.fetch(new Request('https://songaday.studio' + spelling), env);
    assert.equal(response.status, 302, spelling);
    assert.equal(response.headers.get('Location'), location, spelling);
    assert.equal(response.headers.get('Cache-Control'), 'no-store', spelling);
  }
  assert.equal((await worker.fetch(new Request('https://songaday.studio/press/'), env)).status, 200);
});

test('the build writes press/index.html with the studio header and footer, and production copies it', async () => {
  const out = await mkdtemp(path.join(tmpdir(), 'songaday-studio-press-'));
  try {
    await promisify(execFile)(process.execPath, [fileURLToPath(new URL('build.mjs', root)), '--out', out], {
      env: { ...process.env, SONGADAY_OFFLINE: '1' }
    });
    const read = (page) => readFile(path.join(out, page), 'utf8');
    const [home, films, everything, now, press] = await Promise.all(['index.html', 'films/index.html', 'everything/index.html',
      'now/index.html', 'press/index.html'].map(read));
    assert.match(press, /<title>Press · Song A Day Studio<\/title>/);
    assert.match(press, /<meta property="og:url" content="https:\/\/songaday\.studio\/press\/">/);
    assert.match(press, /<h1>Press<\/h1>\s*<p id="press-summary">Press, podcasts, radio and TV about me and what I make, since 2006\. 183 so far\.<\/p>/);
    assert.match(press, /<div class="press" id="press">\s*<section class="press-featured"/);
    assert.match(press, /<li class="press-item" data-kind="press" data-crypto>/);
    assert.match(press, /\[data-crypto\] \{ display: none !important; \}/);
    // The filter script, then the wallet gate, inlined once.
    assert.ok(press.indexOf('press.addEventListener("click"') < press.indexOf('applyWalletGate();'));
    assert.equal((press.match(/function applyWalletGate/g) ?? []).length, 1);
    assert.doesNotMatch(press, /\{\{|patreon/i);
    // The studio header (nothing marked current) and footer, and the footer links here everywhere.
    const nav = (html) => html.match(/<nav class="site-sections"[\s\S]*?<\/nav>/)[0];
    assert.equal(nav(press), nav(everything));
    assert.doesNotMatch(press.match(/<header class="site-header">[\s\S]*?<\/header>/)[0], /aria-current/);
    for (const page of [home, films, everything, now, press]) {
      assert.match(page, /<a href="\/now\/">Now<\/a>\s*<a href="\/press\/">Press<\/a>/);
    }
  } finally {
    await rm(out, { recursive: true, force: true });
  }
  const script = await readFile(new URL('build-production.mjs', root), 'utf8');
  assert.ok(script.includes("cp('press/index.html', 'dist/press/index.html')"));
  const ignored = await readFile(new URL('.gitignore', root), 'utf8');
  assert.match(ignored, /^\/press\/index\.html$/m);
});
