import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import worker from '../worker.mjs';
import { PRESS_COLUMNS, PRESS_MAX_BYTES, PRESS_MAX_ROWS, PRESS_OTHER, PRESS_PROJECTS, livePress, parseCsv, pressFilters,
  pressFromCsv, pressItems, pressMinimum, pressProjectGroup, pressSnapshot, renderPress, renderPressSummary } from '../press.mjs';

const root = new URL('../', import.meta.url);
const snapshot = JSON.parse(await readFile(new URL('press/press.json', root), 'utf8'));
const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-test/pub?gid=1&single=true&output=csv';
const checked = pressSnapshot();

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
// The rows a rendered page lists, as the filters see them, and the years whose heading shows.
const listed = (html) => [...html.matchAll(/<li class="press-item" data-kind="(\w+)" data-project="([\w-]+)" data-year="(\d{4})"( data-crypto)?( hidden)?>/g)]
  .map(([, kind, project, year, crypto, hidden]) => ({ kind, project, year, walletOnly: Boolean(crypto), hidden: Boolean(hidden) }));
const shownYears = (html) => [...html.matchAll(/<section class="press-year"( data-crypto)?( hidden)? aria-labelledby="press-(\d{4})">/g)]
  .filter(([, , hidden]) => !hidden).map(([, , , year]) => year);
// A menu's choices as [value, attributes, text].
const menu = (html, name) => [...html.split(`<select name="${name}">`)[1].split('</select>')[0]
  .matchAll(/<option value="([^"]*)"([^>]*)>([^<]*)<\/option>/g)].map(([, value, attributes, label]) => [value, attributes, label]);

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
  const csv = 'URL,Title,ID,Date,Kind,Featured,Wallet_Only,Outlet,Format,Subject,Project,Byline,Notes\n' +
    'https://example.com/x,"Song, a day",JM-7,2014-07-01,TV & video,TRUE,FALSE,,TV segment,Music,Song A Day,,private note\n';
  const { items, problems } = pressFromCsv(csv);
  assert.deepEqual(problems, []);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Song, a day');
  assert.equal(items[0].kind, 'TV & video');
  assert.equal(items[0].featured, true);
  assert.equal(items[0].outlet, 'example.com', 'an empty outlet falls back to the site name');
  assert.equal(items[0].byline, '');

  assert.equal(items[0].format, 'TV segment');
  assert.ok(!('notes' in items[0]), 'a column the page doesn\'t use is ignored');

  assert.deepEqual(pressFromCsv('<!doctype html><html><body>Sign in</body></html>').items, []);
  assert.match(pressFromCsv('id,title\nJM-1,x').problems[0], /no date, outlet, kind, format, subject, project, url, byline, featured, wallet_only column/);
});

test('CSV: every column must be there exactly once, so a wallet-only row can never lose its flag', () => {
  const rows = snapshot.slice(0, 120);
  assert.ok(rows.some((entry) => entry.wallet_only), 'JM-112 is in these rows');
  assert.equal(pressFromCsv(sheetCsv(rows)).items.length, 120);
  const withHeader = (header) => [header.join(','), ...sheetCsv(rows).split('\r\n').slice(1)].join('\r\n');
  // No wallet_only, the sheet's own "Wallet only", or wallet_only twice (the last copy empty).
  const without = PRESS_COLUMNS.filter((column) => column !== 'wallet_only');
  for (const header of [without, [...without, 'Wallet only'], [...PRESS_COLUMNS, 'wallet_only']]) {
    const { items, problems } = pressFromCsv(withHeader(header));
    assert.deepEqual(items, [], header.join());
    assert.match(problems[0], /no wallet_only column|more than one wallet_only column/);
  }
  assert.match(pressFromCsv('ID,' + PRESS_COLUMNS.join(',') + '\n').problems[0], /more than one id column/);
});

test('CSV: more than PRESS_MAX_ROWS rows is a mistake, and has no rows', () => {
  const many = (count) => sheetCsv(Array.from({ length: count }, (_, index) => row({ id: `JM-${index + 1}` })));
  assert.equal(pressFromCsv(many(PRESS_MAX_ROWS)).items.length, PRESS_MAX_ROWS);
  const { items, problems } = pressFromCsv(many(PRESS_MAX_ROWS + 1));
  assert.deepEqual(items, []);
  assert.match(problems[0], /2,001 rows, more than 2,000/);
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
  assert.equal(one({ url: 'https://example.com/' + 'a'.repeat(2028) }).items.length, 1, '2,048 characters is fine');
  assert.match(one({ url: 'https://example.com/' + 'a'.repeat(2029) }).problems.join(), /url is longer than 2,048 characters/);
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
  assert.equal(one({ featured: false, wallet_only: true }).items[0].wallet_only, true, 'press.json has real booleans');
  // Anything but TRUE, FALSE or empty leaves the row out, rather than guess.
  for (const value of ['x', '✓', 'Y', 'yes', '1', 'checked', 'FALSE?']) {
    assert.match(one({ wallet_only: value }).problems.join(), /featured and wallet_only must be TRUE, FALSE or empty/, value);
    assert.match(one({ featured: value }).problems.join(), /featured and wallet_only must be TRUE, FALSE or empty/, value);
  }
  // Invisible text-direction overrides, marks, zero-width spaces and byte order marks are removed;
  // the zero-width joiner in an emoji stays.
  const [hidden] = one({ title: 'Song\u202e A Day\u202c \u2066x\u2069\u200b\u200e\u200f\ufeff\u061c!', outlet: 'Pride \u{1f3f3}\ufe0f\u200d\u{1f308}' }).items;
  assert.equal(hidden.title, 'Song A Day x!');
  assert.equal(hidden.outlet, 'Pride \u{1f3f3}\ufe0f\u200d\u{1f308}');
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
  assert.deepEqual(checked.problems, []);
  assert.deepEqual(checked.items, snapshot, 'the snapshot is already clean and sorted');
  assert.equal(snapshot.length, 183);
  for (const entry of snapshot) assert.deepEqual(Object.keys(entry), PRESS_COLUMNS, entry.id);
  assert.equal(snapshot.filter((entry) => entry.featured).length, 21);
  assert.deepEqual(snapshot.filter((entry) => entry.wallet_only).map((entry) => entry.id), ['JM-112']);
  // TIME's piece on Oliver Anthony (JM-084) mentions the response song in one sentence. The sheet
  // marks it "Mention only", so it's off the page.
  assert.ok(!snapshot.some((entry) => entry.id === 'JM-084' || entry.title.includes('Unknown Country Singer')));
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
  // Every link on the page is to the press piece (http/https), a filter, or down to the list.
  for (const [, href] of html.matchAll(/href="([^"]*)"/g)) assert.match(href, /^(https?:\/\/|\/press\/|#press-list$)/, href);
});

test('the page: featured first, every row by year, links that open in a new tab', () => {
  const html = renderPress(checked.items);
  assert.ok(html.indexOf('id="press-featured-title"') < html.indexOf('id="press-list-title"'));
  assert.match(html, /^<p class="press-jump"><a href="#press-list">All <span data-press-count>182<\/span>, newest first <span aria-hidden="true">↓<\/span><\/a><\/p>/);
  assert.match(html, /<h2 id="press-list-title">All of it, newest first<\/h2>/);
  // The eight newest featured pieces, then the other 13 behind a summary that works without JavaScript.
  assert.equal((html.match(/class="press-card"/g) ?? []).length, 21);
  const [lead, more] = html.split('<details class="press-more">');
  assert.equal((lead.match(/class="press-card"/g) ?? []).length, 8);
  assert.match(more, /^\s*<summary><span data-press-more-count>13<\/span> more featured<\/summary>/);
  assert.equal((more.split('</details>')[0].match(/class="press-card"/g) ?? []).length, 13);
  const featuredDates = [...html.matchAll(/class="press-date"><time datetime="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(featuredDates, [...featuredDates].sort().reverse(), 'featured, newest first');
  assert.equal((html.match(/class="press-item"/g) ?? []).length, 183);
  assert.equal((html.match(/target="_blank" rel="noopener"/g) ?? []).length, 21 + 183);
  const years = [...html.matchAll(/<h3 id="press-(\d{4})">/g)].map((match) => Number(match[1]));
  assert.deepEqual(years, [...years].sort((a, b) => b - a));
  assert.equal(years[0], 2026);
  assert.equal(years.at(-1), 2006);
  // Each row: outlet, the linked title, the date, the byline when there is one, and the format.
  assert.match(html, /<span class="press-outlet">Reuters<\/span><span class="press-format">Wire article<\/span><\/p>\s*<a class="press-title" href="https:\/\/www\.reuters\.com\/[^"]+" target="_blank" rel="noopener">US judge rejects NFT artists&#39; lawsuit against SEC<span class="nav-out" aria-hidden="true">↗<\/span><\/a>\s*<p class="press-meta"><time datetime="2025-09-30">September 30, 2025<\/time> · [^<]+<\/p>/);
  assert.match(html, /<time datetime="2009-04">April 2009<\/time>/);
  assert.match(html, /<time datetime="2021">2021<\/time><\/p>/, 'a row with no byline has just the date');
  assert.match(html, /<span class="press-card-meta"><span class="press-outlet">Vanity Fair<\/span> <span class="press-date"><time datetime="2020-09-04">September 4, 2020<\/time><\/span><\/span>\s*<strong class="press-card-title">Even James Comey Endorses/);
  // No filter: no row, year or featured piece hidden, All is the current filter, and there's
  // nothing to clear.
  assert.doesNotMatch(html, /<(li|section|p)[^>]* hidden[ >]/);
  assert.match(html, /<a href="\/press\/#press-list" data-kind="" aria-current="page">All<\/a>/);
  assert.match(html, /<p class="press-status" role="status"><\/p>/, 'no count line on All: the opening line has it');
  assert.match(html, /<a class="press-clear" href="\/press\/#press-list" hidden>Clear filters<\/a>/);
  assert.equal(renderPressSummary(checked.items),
    'Press, podcasts, radio and TV about me and what I make since 2006: <span data-press-count>182</span> pieces so far.');
});

test('wallet-only rows are crypto parts: behind data-crypto, and not counted', () => {
  const html = renderPress(checked.items);
  assert.equal((html.match(/data-crypto/g) ?? []).length, 1);
  assert.match(html, /<li class="press-item" data-kind="press" data-project="song-a-day" data-year="2024" data-crypto><div class="press-row">\s*<p class="press-source"><span class="press-outlet">OpenSea<\/span>/);

  const items = pressItems([row({ id: 'JM-001', date: '2024-01-01', wallet_only: 'TRUE', featured: 'TRUE' }),
    row({ id: 'JM-002', date: '2023-01-01' })]).items;
  const small = renderPress(items);
  // A featured wallet-only piece, and a year with only wallet-only rows, wait for a wallet too.
  assert.match(small, /<section class="press-featured" data-crypto aria-labelledby="press-featured-title">\s*<h2[^>]*>Featured<\/h2>\s*<ul class="press-cards">\s*<li data-crypto>/);
  assert.match(small, /<section class="press-year" data-crypto hidden aria-labelledby="press-2024">/);
  assert.match(small, /<section class="press-year" aria-labelledby="press-2023">/);
  assert.match(small, /<p class="press-status" role="status"><\/p>/);
  assert.match(small, /All <span data-press-count>1<\/span>, newest first/);
  assert.match(renderPressSummary(items), /since 2023: <span data-press-count>1<\/span> piece so far\./);
  // A wallet-only piece among the more featured isn't in their count either.
  const featured = pressItems(Array.from({ length: 10 }, (_, index) => row({ id: `JM-${index + 1}`, date: `2020-01-${String(10 - index).padStart(2, '0')}`,
    featured: 'TRUE', wallet_only: index === 9 ? 'TRUE' : 'FALSE' }))).items;
  assert.match(renderPress(featured), /<details class="press-more">\s*<summary><span data-press-more-count>1<\/span> more featured<\/summary>[\s\S]*<li data-crypto>/);
  assert.doesNotMatch(renderPress(items.slice(1)), /press-featured/, 'no featured section when nothing is featured');
});

test('a kind filter hides the other rows and the years left empty, and marks its link', () => {
  const html = renderPress(checked.items, { kind: 'tv' });
  const shown = listed(html);
  assert.equal(shown.length, 183);
  assert.ok(shown.every(({ kind, hidden }) => (kind === 'tv') === !hidden));
  assert.equal(shown.filter(({ kind }) => kind === 'tv').length, 8);
  assert.match(html, /<a href="\/press\/\?kind=tv#press-list" data-kind="tv" aria-current="page">TV &amp; video<\/a>/);
  assert.doesNotMatch(html, /data-kind="" aria-current/);
  assert.match(html, /Showing 8 of 182\./);
  // A year is hidden exactly when it has no TV row.
  const years = new Set(snapshot.map((entry) => entry.date.slice(0, 4)));
  const tvYears = new Set(snapshot.filter((entry) => entry.kind === 'TV & video').map((entry) => entry.date.slice(0, 4)));
  assert.ok(tvYears.size > 1 && tvYears.size < years.size);
  for (const year of years) {
    assert.match(html, new RegExp(`<section class="press-year"${tvYears.has(year) ? '' : ' hidden'} aria-labelledby="press-${year}">`), year);
  }
  // The featured pieces, and the link down past them, wait for the whole list; an unknown kind is
  // the whole list.
  assert.match(html, /<p class="press-jump" hidden>/);
  assert.match(html, /<section class="press-featured" hidden aria-labelledby="press-featured-title">/);
  assert.equal((html.match(/class="press-card"/g) ?? []).length, 21, 'still there, for the page script');
  assert.equal(renderPress(checked.items, { kind: 'nope' }), renderPress(checked.items));
  assert.match(renderPress(checked.items, { kind: 'podcasts' }), /Showing 29 of 182\./);
});

test('the project groups: every value the sheet uses, in any case; anything else is Other', () => {
  const group = (project) => pressProjectGroup(project).slug;
  for (const [project, slug] of [['Song A Day', 'song-a-day'], ['Song A Day / Hugh Mann', 'song-a-day'], ['Career overview', 'song-a-day'],
    ['Selling Song A Day NFTs', 'song-a-day'], ['Crypto Tax Nightmare / Song A Day 6000', 'song-a-day'], ['Suing the SEC', 'sec'],
    ['GameJew', 'gamejew'], ['Coldplay Canoodle', 'coldplay'], ['The Mario Opera', 'mario-opera'], ['WAMP', 'wamp'],
    ['WAMP / AI-built projects', 'wamp'], ['X-Play: The Musical', 'x-play'], ['  suing THE sec ', 'sec']]) {
    assert.equal(group(project), slug, project);
  }
  for (const project of ['The Museum of Fumbled Bags', 'Song A Day!', 'WAMP /', '', undefined, null]) assert.equal(group(project), 'other', String(project));
  assert.deepEqual(pressProjectGroup('Nope'), { slug: 'other', label: 'Other' });
  // Every project in the snapshot has a group, so Other isn't on the page today.
  assert.deepEqual(snapshot.filter((entry) => group(entry.project) === 'other').map((entry) => entry.id), []);
  // Short, stable, unique slugs, and labels without crypto words: everyone sees them.
  const groups = [...PRESS_PROJECTS, PRESS_OTHER];
  assert.equal(new Set(groups.map(({ slug }) => slug)).size, groups.length);
  for (const { slug, label } of groups) {
    assert.match(slug, /^[a-z][a-z0-9-]{1,15}$/, slug);
    assert.doesNotMatch(label, /nft|crypto|token|wallet|opensea|ether|mint|chain|coin/i, label);
  }
});

test('the project and year menus: counts, the newest year first, and only what has rows', () => {
  const html = renderPress(checked.items);
  assert.deepEqual(menu(html, 'project'), [['', '', 'All projects'], ['song-a-day', '', 'Song A Day (134)'], ['sec', '', 'The SEC lawsuit (15)'],
    ['gamejew', '', 'GameJew (14)'], ['coldplay', '', 'Coldplay Canoodle (12)'], ['mario-opera', '', 'The Mario Opera (4)'],
    ['wamp', '', 'WAMP (2)'], ['x-play', '', 'X-Play: The Musical (1)']]);
  const years = [...new Set(snapshot.map((entry) => entry.date.slice(0, 4)))];
  assert.equal(years.length, 20);
  const yearMenu = menu(html, 'year');
  assert.deepEqual(yearMenu.map(([value]) => value), ['', ...years], 'every year with a row, newest first (no 2008)');
  assert.deepEqual(yearMenu.slice(0, 4), [['', '', 'All years'], ['2026', '', '2026 (3)'], ['2025', '', '2025 (22)'], ['2024', '', '2024 (13)']]);
  // Each menu adds up to the whole list, as a visitor without a wallet sees it.
  for (const name of ['project', 'year']) {
    assert.equal(menu(html, name).slice(1).reduce((sum, [, , label]) => sum + Number(label.match(/\((\d+)\)$/)[1]), 0), 182, name);
  }
  assert.match(html, /<label class="press-pick-project"><span>Project<\/span>\s*<select name="project">/);
  assert.match(html, /<label class="press-pick-year"><span>Year<\/span>\s*<select name="year">/);
  assert.doesNotMatch(html, /<input type="hidden"/, 'no kind to send along');

  // A menu counts what each choice would show with the other filters as they are, not its own.
  const sec = renderPress(checked.items, { project: 'sec' });
  assert.deepEqual(menu(sec, 'year').slice(1, 5), [['2026', '', '2026 (0)'], ['2025', '', '2025 (2)'], ['2024', '', '2024 (13)'], ['2023', '', '2023 (0)']]);
  assert.deepEqual(menu(sec, 'project')[2], ['sec', ' selected', 'The SEC lawsuit (15)']);
  assert.deepEqual(menu(sec, 'project')[1], ['song-a-day', '', 'Song A Day (134)'], 'a choice at 0 or not, all can be picked');
  assert.deepEqual(menu(renderPress(checked.items, { kind: 'podcasts', year: '2025' }), 'project').slice(1, 3),
    [['song-a-day', '', 'Song A Day (3)'], ['sec', '', 'The SEC lawsuit (0)']]);

  // A group no row is in isn't offered. Other shows only when a row's project has no group.
  const items = pressItems([row({ id: 'JM-001', project: 'The Museum of Fumbled Bags' }), row({ id: 'JM-002', date: '2019-01-01', project: 'GameJew' })]).items;
  const small = renderPress(items);
  assert.deepEqual(menu(small, 'project'), [['', '', 'All projects'], ['gamejew', '', 'GameJew (1)'], ['other', '', 'Other (1)']]);
  assert.deepEqual(menu(small, 'year').map(([value]) => value), ['', '2020', '2019']);
  assert.match(renderPress(items, { project: 'other' }), /Showing 1 of 2\./);
  assert.doesNotMatch(html, /value="other"/);
});

test('the project and year filters, alone and with a kind: the other rows, empty years and featured pieces hidden', () => {
  for (const [filters, count] of [
    [{ project: 'sec' }, 15],
    [{ year: '2010' }, 23],
    [{ project: 'gamejew', year: '2007' }, 7],
    [{ kind: 'tv', project: 'song-a-day', year: '2010' }, 2],
    [{ kind: 'press', project: 'sec', year: '2024' }, 13],
    [{ kind: 'podcasts', project: 'song-a-day', year: '2025' }, 3],
    [{ kind: 'podcasts', project: 'sec' }, 0]
  ]) {
    const label = JSON.stringify(filters);
    const html = renderPress(checked.items, filters);
    const rows = listed(html);
    assert.equal(rows.length, 183, label);
    for (const entry of rows) {
      assert.equal(entry.hidden, !Object.entries(filters).every(([name, value]) => entry[name] === value), `${label} ${JSON.stringify(entry)}`);
    }
    const shown = rows.filter((entry) => !entry.hidden && !entry.walletOnly);
    assert.equal(shown.length, count, label);
    assert.match(html, new RegExp(`<p class="press-status" role="status">Showing ${count} of 182\\.</p>`), label);
    assert.match(html, /<a class="press-clear" href="\/press\/#press-list">Clear filters<\/a>/, label);
    // No empty year headings: a year shows exactly when one of its rows does.
    assert.deepEqual(shownYears(html), [...new Set(shown.map((entry) => entry.year))], label);
    assert.match(html, /<p class="press-jump" hidden>/, label);
    assert.match(html, /<section class="press-featured" hidden aria-labelledby="press-featured-title">/, label);
  }
  assert.deepEqual(shownYears(renderPress(checked.items, { year: '2010' })), ['2010']);

  // Every filter link and menu keeps the others: one click changes one filter.
  const all = renderPress(checked.items, { kind: 'press', project: 'sec', year: '2024' });
  assert.match(all, /<a href="\/press\/\?project=sec&amp;year=2024#press-list" data-kind="">All<\/a>/);
  assert.match(all, /<a href="\/press\/\?kind=tv&amp;project=sec&amp;year=2024#press-list" data-kind="tv">TV &amp; video<\/a>/);
  assert.match(all, /<a href="\/press\/\?kind=press&amp;project=sec&amp;year=2024#press-list" data-kind="press" aria-current="page">Press<\/a>/);
  assert.match(all, /<form class="press-pick" action="\/press\/#press-list" method="get">\s*<input type="hidden" name="kind" value="press">/);
  assert.match(all, /<option value="sec" selected>The SEC lawsuit \(13\)<\/option>/);
  assert.match(all, /<option value="2024" selected>2024 \(13\)<\/option>/);
  assert.equal((all.match(/ selected>/g) ?? []).length, 2);
});

test('a filter that isn\'t one of the page\'s own is ignored', () => {
  const plain = renderPress(checked.items);
  for (const filters of [{ project: 'nope' }, { project: 'SEC' }, { project: 'other' }, { project: 'Suing the SEC' }, { project: '__proto__' },
    { project: ['sec'] }, { year: '2008' }, { year: '1999' }, { year: '24' }, { year: ' 2024' }, { year: 2024 }, { year: 'toString' },
    { kind: 'radio', project: '', year: '' }, { project: '<script>alert(1)</script>' }]) {
    assert.equal(renderPress(checked.items, filters), plain, JSON.stringify(filters));
  }
  // One bad filter doesn't spoil a good one.
  assert.equal(renderPress(checked.items, { project: 'sec', year: 'soon', kind: 'nope' }), renderPress(checked.items, { project: 'sec' }));

  const parse = (query) => pressFilters(new URLSearchParams(query));
  assert.deepEqual(parse('kind=podcasts&project=sec&year=2024'), { kind: 'podcasts', project: 'sec', year: '2024' });
  assert.deepEqual(parse(''), { kind: null, project: null, year: null });
  assert.deepEqual(parse('kind=Radio&project=%3Cscript%3E&year=20245&utm_source=bio'), { kind: null, project: null, year: null });
  assert.deepEqual(parse('project=sec&project=wamp&year=&kind='), { kind: null, project: 'sec', year: null }, 'the first of a repeated filter; empty is off');
  assert.deepEqual(parse('year=1999'), { kind: null, project: null, year: '1999' }, 'a year is checked against the rows when the page renders');
});

test('the wallet-only row counts only for wallets: in the menus, and in "Showing"', () => {
  // As everyone sees it: JM-112 (Song A Day, 2024) isn't counted, but it's in the list for wallets.
  const year = renderPress(checked.items, { year: '2024' });
  assert.match(year, /Showing 13 of 182\./);
  assert.match(year, /<option value="2024" selected>2024 \(13\)<\/option>/);
  assert.match(year, /<option value="song-a-day">Song A Day \(0\)<\/option>/);
  assert.match(year, /<li class="press-item" data-kind="press" data-project="song-a-day" data-year="2024" data-crypto><div/, 'shown, behind the gate');
  assert.match(renderPress(checked.items, { project: 'song-a-day' }), /Showing 134 of 182\./);
  // The same rows with JM-112 for everyone: what a wallet's page script counts.
  const counted = snapshot.map((entry) => ({ ...entry, wallet_only: false }));
  const withRow = renderPress(counted, { year: '2024' });
  assert.match(withRow, /Showing 14 of 183\./);
  assert.match(withRow, /<option value="2024" selected>2024 \(14\)<\/option>/);
  assert.match(withRow, /<option value="song-a-day">Song A Day \(1\)<\/option>/);
  assert.match(renderPress(counted, { project: 'song-a-day' }), /Showing 135 of 183\./);

  // A project or year whose rows are all wallet-only is a crypto part, and can't be picked
  // without a wallet; its year heading waits for a wallet too.
  const items = pressItems([row({ id: 'JM-001', date: '2024-01-01', project: 'Brand new thing', wallet_only: 'TRUE' }),
    row({ id: 'JM-002', date: '2023-01-01' })]).items;
  const html = renderPress(items);
  assert.deepEqual(menu(html, 'project'), [['', '', 'All projects'], ['song-a-day', '', 'Song A Day (1)'], ['other', ' data-crypto disabled', 'Other (0)']]);
  assert.deepEqual(menu(html, 'year'), [['', '', 'All years'], ['2024', ' data-crypto disabled', '2024 (0)'], ['2023', '', '2023 (1)']]);
  assert.match(renderPress(items, { project: 'other' }), /Showing 0 of 1\./);
  assert.match(renderPress(items, { project: 'other' }), /<option value="other" data-crypto disabled selected>Other \(0\)<\/option>/);
});

// A stand-in for the Workers Cache API. It keeps each response's text and headers (lowercase).
function fakeCache() {
  const store = new Map();
  return {
    store,
    default: {
      async match(request) {
        const entry = store.get(request.url);
        return entry && new Response(entry.body, { headers: entry.headers });
      },
      async put(request, response) { store.set(request.url, { body: await response.text(), headers: Object.fromEntries(response.headers) }); }
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
    const [[key, entry]] = cache.store;
    assert.equal(key, `https://songaday.studio/press/sheet.csv?source=${encodeURIComponent(CSV_URL)}`);
    assert.equal(entry.headers['cache-control'], 'public, max-age=900');
    assert.equal(entry.headers['x-press-failed'], undefined);
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
    await withFetch(failure, async ({ cache, fetched }) => {
      assert.equal(await livePress(CSV_URL), null, String(failure));
      // The bad file, or the failure, is kept, so the next view doesn't ask the sheet again.
      assert.equal(cache.store.size, 1, String(failure));
      assert.equal(await livePress(CSV_URL), null, 'a cached bad file stays ignored');
      assert.equal(fetched.length, 1, String(failure));
    });
  }
  assert.equal(pressMinimum(183), 92);
  await withFetch(() => new Response(sheetCsv(snapshot.slice(0, 92))), async () => {
    assert.equal((await livePress(CSV_URL)).length, 92);
  });
  // The fetch has a timeout.
  await withFetch((url, init) => {
    assert.ok(init.signal instanceof AbortSignal);
    return new Response(sheetCsv(snapshot));
  }, () => livePress(CSV_URL));
});

test('a failed read is remembered for a minute, so a slow or broken sheet is asked once a minute, not on every view', async () => {
  for (const failure of [() => new Response('nope', { status: 503 }), () => { throw new DOMException('The operation timed out.', 'TimeoutError'); }]) {
    await withFetch(failure, async ({ cache, fetched }) => {
      assert.equal(await livePress(CSV_URL), null);
      const [entry] = cache.store.values();
      assert.equal(entry.headers['x-press-failed'], '1');
      assert.equal(entry.headers['cache-control'], 'public, max-age=60');
      assert.equal(entry.body, '');
      for (let view = 0; view < 3; view++) assert.equal(await livePress(CSV_URL), null);
      assert.equal(fetched.length, 1);
    });
  }
});

// A response body that comes in pieces, counting how many were asked for.
function pieces(next, headers = {}) {
  const read = { count: 0 };
  const body = new ReadableStream({
    pull(controller) {
      const piece = next(read.count++);
      if (piece) controller.enqueue(piece);
      else controller.close();
    }
  });
  return { read, response: new Response(body, { headers }) };
}

test('a sheet over PRESS_MAX_BYTES is ignored, and never read past the limit', async () => {
  const filler = new TextEncoder().encode(sheetCsv(snapshot).repeat(2)).slice(0, 64 * 1024);
  // It says it's too big: nothing is read.
  const big = pieces(() => filler, { 'Content-Length': String(PRESS_MAX_BYTES + 1) });
  await withFetch(() => big.response, async () => assert.equal(await livePress(CSV_URL), null));
  assert.ok(big.read.count <= 1, `read ${big.read.count} pieces`);
  // It doesn't say, and doesn't end: reading stops just past the limit.
  const endless = pieces(() => filler);
  await withFetch(() => endless.response, async ({ cache }) => {
    assert.equal(await livePress(CSV_URL), null);
    assert.equal([...cache.store.values()][0].headers['x-press-failed'], '1');
  });
  assert.ok(endless.read.count <= Math.ceil(PRESS_MAX_BYTES / filler.length) + 2, `read ${endless.read.count} pieces`);
  // A good file in small pieces, split inside multi-byte characters, reads whole.
  const live = [row({ id: 'JM-205', date: '2026-10-22', title: 'Café ☕ “quoted” 🎸' }), ...snapshot.slice(0, 100)];
  const bytes = new TextEncoder().encode(sheetCsv(live));
  const small = pieces((index) => index * 7 < bytes.length ? bytes.slice(index * 7, index * 7 + 7) : null);
  await withFetch(() => small.response, async () => {
    const items = await livePress(CSV_URL);
    assert.equal(items.length, 101);
    assert.equal(items[0].title, 'Café ☕ “quoted” 🎸');
  });
});

test('nothing reads the clock while press.mjs loads: in a Worker it says 1970 then', async () => {
  const RealDate = globalThis.Date;
  globalThis.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [0])); }
    static now() { return 0; }
  };
  let fresh;
  try {
    assert.equal(new Date().getUTCFullYear(), 1970);
    fresh = await import('../press.mjs?clock=1970');
  } finally {
    globalThis.Date = RealDate;
  }
  // Checked on first use, in a request, when the clock is right.
  assert.deepEqual(fresh.pressSnapshot().problems, []);
  assert.equal(fresh.pressSnapshot().items.length, 183);
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

test('/press/ keeps the built page, swaps in the live sheet, and filters by kind, project and year without JavaScript', async () => {
  // No sheet yet, no filter: the built page as it is.
  const built = await pressPage('/press/');
  assert.equal(built.response.status, 200);
  assert.equal(built.list, null);
  assert.equal(built.summary, null);

  // ?kind= re-renders the snapshot with the other kinds hidden.
  const filtered = await pressPage('/press/?kind=podcasts');
  assert.equal(filtered.list, renderPress(checked.items, { kind: 'podcasts' }));
  assert.equal(filtered.summary, null);
  assert.equal((await pressPage('/press/?kind=<script>')).list, null);
  // The no-JavaScript TV filter: the 8 TV rows show, the rest are hidden.
  const tv = (await pressPage('/press/?kind=tv')).list;
  assert.equal((tv.match(/<li class="press-item" data-kind="tv" [^>]*"><div/g) ?? []).length, 8);
  assert.equal((tv.match(/<li class="press-item" [^>]*hidden>/g) ?? []).length, 175);
  assert.match(tv, /Showing 8 of 182\./);

  // ?project= and ?year=, alone and with ?kind=, the same way, whatever else is in the address.
  for (const [query, filters, count] of [
    ['project=sec', { project: 'sec' }, 15],
    ['year=2010', { year: '2010' }, 23],
    ['kind=press&project=sec&year=2024', { kind: 'press', project: 'sec', year: '2024' }, 13],
    ['year=2007&project=gamejew&utm_source=bio', { project: 'gamejew', year: '2007' }, 7]
  ]) {
    const page = await pressPage(`/press/?${query}`);
    assert.equal(page.list, renderPress(checked.items, filters), query);
    assert.match(page.list, new RegExp(`Showing ${count} of 182\\.`), query);
    assert.equal(page.summary, null, query);
  }
  // Made-up filters leave the built page alone, and don't spoil a good one next to them.
  for (const query of ['project=nope', 'project=SEC', 'year=soon', 'year=20100', 'project=%3Cscript%3E&kind=radio', 'project=&year=&kind=']) {
    assert.equal((await pressPage(`/press/?${query}`)).list, null, query);
  }
  assert.equal((await pressPage('/press/?year=1999')).list, renderPress(checked.items), 'a year with no rows is the whole list');
  assert.equal((await pressPage('/press/?project=sec&year=nope')).list, renderPress(checked.items, { project: 'sec' }));

  const live = [row({ id: 'JM-205', date: '2026-10-22', title: 'Brand new' }), ...snapshot.slice(0, 100)];
  await withFetch(async () => new Response(sheetCsv(live)), async ({ fetched }) => {
    const page = await pressPage('/press/?kind=press', { PRESS_CSV_URL: CSV_URL });
    assert.match(page.list, /Brand new/);
    assert.match(page.list, /aria-current="page">Press<\/a>/);
    // The live sheet's own rows: 2026 has the new one and the snapshot's three.
    assert.match((await pressPage('/press/?year=2026', { PRESS_CSV_URL: CSV_URL })).list, /Showing 4 of 100\./);
    // JM-112, in the first 100, is wallet-only, so it isn't counted.
    assert.equal(page.summary, 'Press, podcasts, radio and TV about me and what I make since 2014: <span data-press-count>100</span> pieces so far.');
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
    assert.match(press, /<h1>Press<\/h1>\s*<p id="press-summary">Press, podcasts, radio and TV about me and what I make since 2006: <span data-press-count>182<\/span> pieces so far\.<\/p>/);
    assert.match(press, /<div class="press" id="press">\s*<p class="press-jump">[\s\S]*?<\/p>\s*<section class="press-featured"/);
    assert.match(press, /<details class="press-more">/);
    assert.match(press, /<li class="press-item" data-kind="press" data-project="song-a-day" data-year="2024" data-crypto>/);
    // The menus, with their Show button for browsers without JavaScript.
    assert.match(press, /<form class="press-pick" action="\/press\/#press-list" method="get">\s*<label class="press-pick-project">/);
    assert.match(press, /<option value="sec">The SEC lawsuit \(15\)<\/option>/);
    assert.match(press, /<button type="submit">Show<\/button>/);
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

test('update-press.mjs refreshes the snapshot, but won\'t shrink it by half or un-gate a wallet-only row unless told', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'songaday-studio-update-press-'));
  try {
    await mkdir(path.join(dir, 'press'));
    await Promise.all(['update-press.mjs', 'press.mjs', 'films.mjs', 'press/press.json']
      .map((file) => copyFile(new URL(file, root), path.join(dir, file))));
    const before = await readFile(path.join(dir, 'press/press.json'), 'utf8');
    const run = async (rows, ...flags) => {
      await writeFile(path.join(dir, 'public.csv'), sheetCsv(rows));
      try {
        const { stdout, stderr } = await promisify(execFile)(process.execPath, ['update-press.mjs', 'public.csv', ...flags], { cwd: dir });
        return { code: 0, output: stdout, warnings: stderr };
      } catch (error) {
        return { code: error.code, output: error.stderr };
      }
    };
    const saved = async () => JSON.parse(await readFile(path.join(dir, 'press/press.json'), 'utf8'));

    let result = await run(snapshot.slice(0, 5));
    assert.equal(result.code, 1);
    assert.match(result.output, /Only 5 rows, down from 183\. If rows were removed on purpose, run again with --allow-shrink\. press\/press\.json is unchanged\./);
    result = await run(snapshot.map((entry) => ({ ...entry, wallet_only: false })));
    assert.equal(result.code, 1);
    assert.match(result.output, /JM-112 was wallet-only and would now show to everyone\. If that's on purpose, run again with --allow-wallet-change\./);
    assert.equal(await readFile(path.join(dir, 'press/press.json'), 'utf8'), before);

    // A new row: written in the sheet's column order, one row per line.
    const added = row({ id: 'JM-205', date: '2026-10-22', title: 'Brand new' });
    result = await run([added, ...snapshot]);
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /184 rows, 21 featured, 1 wallet-only/);
    assert.doesNotMatch(result.warnings, /Under Other/, 'every project has a group');
    const after = await saved();
    assert.equal(after[0].id, 'JM-205');
    assert.deepEqual(after.slice(1), snapshot);
    assert.equal((await readFile(path.join(dir, 'press/press.json'), 'utf8')).split('\n').length, 184 + 3);
    // A project no group lists is named, once, so it can get one.
    const fumble = (id) => row({ id, date: '2026-10-22', project: 'The Museum of Fumbled Bags' });
    result = await run([fumble('JM-206'), fumble('JM-207'), ...snapshot]);
    assert.equal(result.code, 0, result.output);
    assert.match(result.warnings, /^Under Other on the page until PRESS_PROJECTS in press\.mjs lists it: "The Museum of Fumbled Bags"\.$/m);

    // On purpose: each flag lets its change through.
    assert.equal((await run(snapshot.map((entry) => ({ ...entry, wallet_only: false })), '--allow-wallet-change')).code, 0);
    assert.equal((await saved()).filter((entry) => entry.wallet_only).length, 0);
    assert.equal((await run(snapshot.slice(0, 5), '--allow-shrink')).code, 0);
    assert.equal((await saved()).length, 5);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
