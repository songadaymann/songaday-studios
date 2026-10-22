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

    assert.match(now, /<h1>What I’m doing now <span>\(October 2026\)<\/span><\/h1>/);
    assert.match(now, /Last updated <time datetime="2026-10-21">October 21, 2026<\/time>/);
    assert.match(now, /#<span data-song-day="count">[\d,]+<\/span> and counting/);
    for (const href of ['/today', '/wamp', '/plugins/', '/data', '/everything/', '/jamuary', '/commission']) {
      assert.match(now, new RegExp(`<a href="${href}">`), href);
    }
    assert.doesNotMatch(now, /\{\{|<script>/);

    // Both new pages wear the studio header (nothing marked current) and footer.
    for (const page of [everything, now]) {
      assert.deepEqual(navLinks(page), navLinks(home));
      assert.doesNotMatch(page.match(/<header class="site-header">[\s\S]*?<\/header>/)[0], /aria-current/);
      assert.match(page, /fiscally sponsored by Fridays at The Park, so gifts are tax-deductible\. Commissions and albums are purchases from Jonathan, not gifts\./);
    }

    assert.match(home, /<h2 id="directory-title">Where to go next<\/h2>/);
    assert.ok(home.indexOf('id="where-next"') > home.indexOf('class="thank-you-section"'), 'the directory comes after the existing sections');
    assert.ok(home.indexOf('id="where-next"') < home.indexOf('<footer>'), 'and before the footer');
    assert.match(home, /\[data-crypto\] \{ display: none !important; \}/);
    // The gate is inlined once, and the donation check no longer asks wallets on its own.
    assert.equal((home.match(/function applyWalletGate/g) ?? []).length, 1);
    assert.equal((home.match(/eip6963:requestProvider/g) ?? []).length, 2);
    assert.doesNotMatch(home, /WALLET_GATE_HELPER|\{\{DIRECTORY\}\}/);
    for (const page of [home, films]) {
      assert.match(page, /<a href="\/everything\/">Everything<\/a>\s*<a href="\/now\/">Now<\/a>/);
      assert.match(page, /so gifts are tax-deductible\. Commissions and albums are purchases from Jonathan, not gifts\.<\/p>/);
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

test('/everything and /now land on their pages from any spelling', async () => {
  const env = { ASSETS: { fetch: async () => new Response('asset', { headers: { 'Content-Type': 'image/png' } }) } };
  for (const spelling of ['/everything', '/Everything', '/now', '/NOW/']) {
    const response = await worker.fetch(new Request('https://songaday.studio' + spelling), env);
    assert.equal(response.status, 302, spelling);
    assert.equal(response.headers.get('Location'), spelling.replace(/\/$/, '').toLowerCase() + '/', spelling);
  }
  for (const page of ['/everything/', '/now/']) {
    const response = await worker.fetch(new Request('https://songaday.studio' + page), env);
    assert.equal(response.status, 200, page);
  }
});

test('production copies the new pages, the bar and projects.json into dist/', async () => {
  const script = await readFile(new URL('build-production.mjs', root), 'utf8');
  for (const copy of ["cp('everything/index.html', 'dist/everything/index.html')", "cp('now/index.html', 'dist/now/index.html')",
    "cp('bar', 'dist/bar'", "cp('projects.json', 'dist/projects.json')"]) {
    assert.ok(script.includes(copy), copy);
  }
});
