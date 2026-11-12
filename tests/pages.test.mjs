import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import worker from '../worker.mjs';

const root = new URL('../', import.meta.url);

// The real build, offline, into a temporary folder.
async function build() {
  const out = await mkdtemp(path.join(tmpdir(), 'songaday-studio-build-'));
  await promisify(execFile)(process.execPath, [fileURLToPath(new URL('build.mjs', root)), '--out', out], {
    env: { ...process.env, SONGADAY_OFFLINE: '1' }
  });
  const read = (page) => readFile(path.join(out, page), 'utf8');
  return { out, read };
}

const navLinks = (html) => [...html.match(/<nav class="site-sections"[\s\S]*?<\/nav>/)[0].matchAll(/href="([^"]+)"/g)].map((match) => match[1]);

test('the build makes /everything and /now, and the home page directory and footer', async () => {
  const { out, read } = await build();
  try {
    const [home, films, everything, now] = await Promise.all(['index.html', 'films/index.html', 'everything/index.html', 'now/index.html'].map(read));

    assert.match(everything, /<title>Everything · Song A Day Studio<\/title>/);
    assert.match(everything, /<h2 id="everything-active">Active<\/h2>/);
    assert.match(everything, /<h2 id="everything-soon">Coming soon<\/h2>/);
    assert.match(everything, /<h2 id="everything-archived">Archive<\/h2>/);
    assert.match(everything, /<li data-crypto><div class="everything-row">/);
    assert.match(everything, /applyWalletGate\(\);/);

    assert.match(now, /<h1>What I’m doing now <span>\(November 2026\)<\/span><\/h1>/);
    assert.match(now, /Last updated <time datetime="2026-11-04">November 4, 2026<\/time>/);
    assert.match(now, /#<span data-song-day="count">[\d,]+<\/span> and counting/);
    for (const href of ['/today', '/wamp', '/plugins/', '/data', '/everything/', '/jamuary', '/commission']) {
      assert.match(now, new RegExp(`<a href="${href}">`), href);
    }
    assert.doesNotMatch(now, /\{\{|<script>/);

    // Both new pages wear the studio header (nothing marked current) and footer.
    for (const page of [everything, now]) {
      assert.deepEqual(navLinks(page), navLinks(home));
      assert.doesNotMatch(page.match(/<header class="site-header">[\s\S]*?<\/header>/)[0], /aria-current/);
      assert.match(page, /fiscally sponsored by Fridays at The Park, and executive produced by C\.Y\. Lee\. Donations are tax deductible\. Commissions and albums are purchases from Jonathan, not donations\./);
    }

    assert.match(home, /<h2 id="directory-title">Where to go next<\/h2>/);
    assert.ok(home.indexOf('id="where-next"') > home.indexOf('<section class="brand-band"'), 'the directory comes after the closing ask');
    assert.ok(home.indexOf('id="where-next"') < home.indexOf('<footer>'), 'and before the footer');
    assert.match(home, /\[data-crypto\] \{ display: none !important; \}/);
    // The gate is inlined once, and the donation check no longer asks wallets on its own.
    assert.equal((home.match(/function applyWalletGate/g) ?? []).length, 1);
    assert.equal((home.match(/eip6963:requestProvider/g) ?? []).length, 2);
    assert.doesNotMatch(home, /WALLET_GATE_HELPER|\{\{DIRECTORY\}\}/);
    for (const page of [home, films]) {
      assert.match(page, /<a href="\/everything\/">Everything<\/a>\s*<a href="\/now\/">Now<\/a>/);
      assert.match(page, /Donations are tax deductible\. Commissions and albums are purchases from Jonathan, not donations\.<\/p>/);
      assert.doesNotMatch(page, /collectible/i);
      // Local previews run over http, so the page's own scripts and fetches are allowed by 'self'.
      assert.match(page, /script-src 'self' 'unsafe-inline' https:;.*connect-src 'self' https:;/);
    }
    assert.match(home, /assets\/calendar\/2026-2x\.webp/);
    assert.doesNotMatch(home, /@2x/);
    assert.doesNotMatch(home + everything + now, /patreon\.com/i);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('the build makes the commission page and the song shell, purchase pages with their own CSP', async () => {
  const { out, read } = await build();
  try {
    const [home, page, shell] = await Promise.all(['index.html', 'commission/index.html', 'commission/song.html'].map(read));
    for (const html of [page, shell]) {
      assert.deepEqual(navLinks(html), navLinks(home));
      assert.match(html, /<a href="\/commission" aria-current="page">Get a song<\/a>/);
      // The menu keeps its Donate button, as on every page. Nothing else on a page about buying
      // a song says donate: no footer link, no tax-deductible line.
      const menuDonate = '<a class="nav-donate" href="/#donate">Donate</a>';
      assert.ok(html.match(/<header class="site-header">[\s\S]*?<\/header>/)[0].includes(menuDonate));
      const markup = html.replace(/<style[\s\S]*?<\/style>/g, '').replace(menuDonate, '');
      assert.doesNotMatch(markup, /nav-donate|#donate|tax.deductible|gifts|donat/i);
      assert.match(html, /<p class="sponsor-line">Song commissions are purchases from Jonathan Mann\.<\/p>/);
      assert.match(html, /<footer>[\s\S]*href="\/everything\/"[\s\S]*<\/footer>/);
      // The one inline script runs by its hash, and script-src allows nothing else inline.
      const csp = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)[1];
      assert.doesNotMatch(csp.match(/script-src [^;]*/)[0], /unsafe-inline/);
      const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
      assert.equal(scripts.length, 1);
      const hash = createHash('sha256').update(scripts[0], 'utf8').digest('base64');
      assert.ok(csp.includes(`script-src 'sha256-${hash}' https://challenges.cloudflare.com`), csp);
      assert.match(csp, /form-action 'self' https:\/\/checkout\.stripe\.com/);
      assert.match(csp, /base-uri 'none'/);
      assert.doesNotMatch(html, /patreon/i);
      assert.doesNotMatch(html, /\{\{/);
    }
    assert.match(page, /<title>Get a custom song · Song A Day Studio<\/title>/);
    assert.match(page, /<!--commission:line-->/);
    assert.match(page, /<!--commission:form-->[\s\S]*<form class="commission-form"[\s\S]*<!--\/commission:form-->/);
    assert.match(page, /maxlength="10000" required/);
    assert.match(page, /data-max-bytes="10485760"/);
    assert.match(shell, /<main id="main" tabindex="-1"><!--commission:song--><\/main>/);
    assert.match(shell, /<meta name="robots" content="noindex">/);
    assert.doesNotMatch(shell, /og:url/);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('/everything and /now land on their pages from any spelling', async () => {
  const env = { ASSETS: { fetch: async () => new Response('asset', { headers: { 'Content-Type': 'image/png' } }) } };
  for (const spelling of ['/everything', '/Everything', '/now', '/NOW/', '/story', '/Story/']) {
    const response = await worker.fetch(new Request('https://songaday.studio' + spelling), env);
    assert.equal(response.status, 302, spelling);
    assert.equal(response.headers.get('Location'), spelling.replace(/\/$/, '').toLowerCase() + '/', spelling);
  }
  for (const page of ['/everything/', '/now/', '/story/']) {
    const response = await worker.fetch(new Request('https://songaday.studio' + page), env);
    assert.equal(response.status, 200, page);
  }
});

test('production copies the new pages, the bar and projects.json into dist/', async () => {
  const script = await readFile(new URL('build-production.mjs', root), 'utf8');
  for (const copy of ["cp('everything/index.html', 'dist/everything/index.html')", "cp('now/index.html', 'dist/now/index.html')",
    "cp('story/index.html', 'dist/story/index.html')",
    "cp('commission/index.html', 'dist/commission/index.html')", "cp('commission/song.html', 'dist/commission/song.html')",
    "cp('bar', 'dist/bar'", "cp('projects.json', 'dist/projects.json')"]) {
    assert.ok(script.includes(copy), copy);
  }
});

test('the story has a page of its own, and the home page keeps the goals and a link to it', async () => {
  const { out, read } = await build();
  try {
    const [home, story] = await Promise.all(['index.html', 'story/index.html'].map(read));
    const main = (page) => page.match(/<main id="main"[\s\S]*?<\/main>/)[0];

    // The story page: one heading at the top, then the sections that used to be the lower home page.
    assert.match(story, /<title>The story · Song A Day Studio<\/title>/);
    assert.match(story, /<meta property="og:url" content="https:\/\/songaday\.studio\/story\/">/);
    assert.deepEqual([...main(story).matchAll(/<h1[^>]*>([^<]+)<\/h1>/g)].map((match) => match[1]), ['Song A Day has never fit neatly into any business model.']);
    const moved = ['class="story-block story-patronage"', 'class="story-block video-games-section"', 'class="work-section studios-section"', 'class="thank-you-section"',
      'class="story-figure story-figure-early"', 'class="story-emphasis"', 'data-video-id="WjEB7W1NSTg"', 'data-video-src="/assets/video/wamp-trailer.mp4"'];
    for (const part of moved) assert.ok(main(story).includes(part), part);
    assert.match(main(story), /<h2 id="patronage-title">Patronage<\/h2>[\s\S]*<h2 id="video-games-title">VIDEO GAMES<\/h2>[\s\S]*<h2 id="studios-title">ALSO FROM THE STUDIO<\/h2>[\s\S]*<h2 id="brand-band-title">[\s\S]*<h2 id="thank-you-title">THANK YOU!<\/h2>/);
    assert.doesNotMatch(main(story), /<h4/);
    // It sits a folder down, so nothing in it is addressed relative to the home page.
    assert.doesNotMatch(story, /(?:src|poster|data-video-src|href)="(?:assets\/|#donate)/);
    assert.match(main(story), /<a class="brand-band-donate" href="\/#donate">Donate<\/a>/);
    assert.doesNotMatch(story, /\{\{|_HELPER \*\//);
    // The studio header (nothing marked current) and footer, like /everything and /now.
    assert.deepEqual(navLinks(story), navLinks(home));
    assert.doesNotMatch(story.match(/<header class="site-header">[\s\S]*?<\/header>/)[0], /aria-current/);
    assert.match(story, /Donations are tax deductible\. Commissions and albums are purchases from Jonathan, not donations\.<\/p>/);

    // The home page: none of those sections, the goals and the link under the four cards, then the closing ask.
    for (const part of moved.concat(['class="editorial-story"'])) assert.ok(!main(home).includes(part.replace('"/assets/', '"assets/')), part);
    const gift = main(home).match(/<section class="gift-section"[\s\S]*?<\/section>/)[0];
    assert.match(gift, /<\/a>\s*<\/div>\s*<dl class="patronage-match" id="goal" aria-label="Monthly goals">[\s\S]*?<\/dl>\s*<a class="gift-more" href="\/story\/">Read the story<\/a>/);
    const order = ['<section class="hero"', '<section class="calendar-section"', '<section class="gift-section"', '<section class="catalog-ticker"', '<section class="brand-band"', '<section class="directory"'];
    assert.deepEqual([...main(home).matchAll(/<section class="[\w-]+"/g)].map((match) => match[0]).filter((tag) => order.includes(tag)), order);

    // Both pages show the same two goals, and reach the story from the footer.
    const goals = (page) => [...main(page).match(/<dl class="patronage-match" id="goal"[\s\S]*?<\/dl>/)[0].matchAll(/<dd>(\$[\d,]+)</g)].map((match) => match[1]);
    assert.deepEqual(goals(story), goals(home));
    assert.equal(goals(home).length, 2);
    for (const page of [home, story]) assert.match(page.match(/<footer>[\s\S]*?<\/footer>/)[0], /<a href="\/press\/">Press<\/a>\s*<a href="\/story\/">Story<\/a>/);

    // One video dialog on each page, in the same markup, opened by the same script.
    const dialog = (page) => page.match(/<div class="video-modal" id="video-modal"[\s\S]*?\n    <\/div>\n/g);
    assert.equal(dialog(home).length, 1);
    assert.deepEqual(dialog(story), dialog(home));
    for (const page of [home, story]) assert.equal((page.match(/function initVideoModal/g) ?? []).length, 1);
    assert.match(story, /initVideoModal\(\);/);
    assert.match(home, /initCalendarPreview\(openVideoModal\);/);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});
