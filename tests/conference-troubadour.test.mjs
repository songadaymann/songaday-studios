// songaday.studio/conference-troubadour/: the page the menu's Hire me > Conference troubadour
// leads to, built from conference-troubadour.html with the films page's video cards.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import worker from '../worker.mjs';

const root = new URL('../', import.meta.url);
const read = (file) => readFile(new URL(file, root), 'utf8');
const VIDEOS = ['HCdwY4B3Ln8', 'VXu5XcWOIWo', 'u2PMmoKwLwg', 'EHuVXLyaDXQ'];

test('the build makes the Conference Troubadour page: what it is, four videos, what people said, every year', async () => {
  const out = await mkdtemp(path.join(tmpdir(), 'songaday-studio-troubadour-'));
  try {
    await promisify(execFile)(process.execPath, [fileURLToPath(new URL('build.mjs', root)), '--out', out], {
      env: { ...process.env, SONGADAY_OFFLINE: '1' }
    });
    const [page, home] = await Promise.all(['conference-troubadour/index.html', 'index.html'].map((file) => readFile(path.join(out, file), 'utf8')));
    assert.match(page, /<title>The Conference Troubadour · Song A Day Studio<\/title>/);
    assert.match(page, /<meta property="og:url" content="https:\/\/songaday\.studio\/conference-troubadour\/">/);
    assert.match(page, /<h1>The Conference Troubadour<\/h1>/);
    assert.doesNotMatch(page, /\{\{/);

    // The videos are the films page's cards: a still that becomes the player when pressed, so
    // the page loads four pictures and no players. The films page's script does the swap.
    assert.deepEqual([...page.matchAll(/<button class="film-play" type="button" data-film-id="([\w-]{11})" aria-label="Play [^"]+">/g)].map((match) => match[1]), VIDEOS);
    assert.doesNotMatch(page, /<iframe/);
    assert.match(page, /<script>[\s\S]*event\.target\.closest\("\[data-film-id\]"\)[\s\S]*<\/script>/);
    assert.deepEqual([...page.matchAll(/<h3 class="film-title">([^<]+)<\/h3>/g)].map((match) => match[1]), ['Gartner', 'Barclays Bank', 'Novartis']);

    // How it works, what three people said, and the years.
    assert.equal(page.match(/<ol class="troubadour-steps">[\s\S]*?<\/ol>/)[0].split('<li>').length - 1, 4);
    assert.deepEqual([...page.matchAll(/<figcaption>([^<]+)<\/figcaption>/g)].map((match) => match[1]),
      ['Michael Willi, Head of Communications, Novartis', 'Katherine Dillon, CCO, Gartner For Marketers', 'Amy Ledoux, SVP of Meetings, ASAE']);
    assert.deepEqual([...page.matchAll(/<dt>([^<]+)<\/dt>/g)].map((match) => match[1]),
      ['2023', '2022', '2020–21', '2019', '2018', '2017', '2016', '2015', '2014', '2013', '2012', '2011']);
    // One of them asked not to be named, so no picture of logos goes beside the list.
    assert.match(page, /Watchmaker that wishes to be anonymous/);
    assert.doesNotMatch(page, /logos|Tudor/i);

    // Book me, at the top and at the end, is one address (build.mjs).
    const book = [...page.matchAll(/<p class="troubadour-book"><a href="([^"]+)">Book me<\/a><\/p>/g)].map((match) => match[1]);
    assert.equal(book.length, 2);
    assert.equal(new Set(book).size, 1);
    assert.match(book[0], /^mailto:[^?@\s]+@[^?@\s]+\?subject=The%20Conference%20Troubadour$/);

    // The same menu as the home page, with this page marked inside Hire me.
    const nav = (html) => [...html.match(/<nav class="site-sections"[\s\S]*?<\/nav>/)[0].matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(nav(page), nav(home));
    assert.match(page, /<summary>Hire me<\/summary>[\s\S]*?<a href="\/conference-troubadour\/" aria-current="page">Conference troubadour<\/a>/);
    assert.equal(page.match(/<header class="site-header">[\s\S]*?<\/header>/)[0].split('aria-current').length - 1, 1);

    // A booking is a purchase from Jonathan, like a commission: the menu keeps its Donate
    // button, and nothing else on the page says donate.
    const menuDonate = '<a class="nav-donate" href="/#donate">Donate</a>';
    assert.ok(page.match(/<header class="site-header">[\s\S]*?<\/header>/)[0].includes(menuDonate));
    const markup = page.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<script[\s\S]*?<\/script>/g, '').replace(menuDonate, '');
    assert.doesNotMatch(markup, /nav-donate|#donate|tax.deductible|gifts|donat|patron/i);
    assert.match(page, /<p class="sponsor-line">Conference bookings and song commissions are purchases from Jonathan Mann\.<\/p>/);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('the page keeps to three sizes of type and solid, square shapes', async () => {
  const css = await read('conference-troubadour.css');
  const sizes = [...css.matchAll(/font-size: ([^;]+);/g)].map((match) => match[1]);
  assert.ok(sizes.length > 5);
  assert.deepEqual([...new Set(sizes)].sort(), ['var(--type-body)', 'var(--type-display)', 'var(--type-meta)']);
  assert.doesNotMatch(css, /clamp\(|border-radius|opacity|rgba\(|hsla\(/);
});

test('every copy of the menu, and the header other sites load, lead to the page', async () => {
  for (const file of ['profile.html', 'films.html', 'plugins/index.html', 'fumble-page.mjs']) {
    assert.match(await read(file), /<a href="\/conference-troubadour\/">Conference troubadour<\/a>/, file);
  }
  assert.match(await read('bar/v1/header.js'), /\{ id: 'conference-troubadour', label: 'Conference troubadour', path: '\/conference-troubadour\/' \}/);
  assert.ok((await read('build-production.mjs')).includes("cp('conference-troubadour/index.html', 'dist/conference-troubadour/index.html')"));
});

test('short addresses, the old site’s among them, land on the page', async () => {
  const asset = async () => new Response('page', { headers: { 'Content-Type': 'text/html' } });
  const fetchPath = (pathname) => worker.fetch(new Request(`https://songaday.studio${pathname}`), { ASSETS: { fetch: asset }, GALLERY: { fetch: asset } });
  for (const [from, to] of Object.entries({
    '/troubadour': '/conference-troubadour/',
    '/conf': '/conference-troubadour/',
    '/conf-troubadour': '/conference-troubadour/',
    '/Troubadour/': '/conference-troubadour/',
    '/conference-troubadour': '/conference-troubadour/'
  })) {
    const response = await fetchPath(from);
    assert.equal(response.status, 302, from);
    assert.equal(response.headers.get('Location'), to, from);
  }
});
