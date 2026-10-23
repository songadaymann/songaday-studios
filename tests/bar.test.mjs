import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import worker from '../worker.mjs';
import { FALLBACK, barItems, songADayNumber as barNumber, supportHref } from '../bar/v1/bar.js';
import { songADayNumber } from '../song-day.mjs';

const root = new URL('../', import.meta.url);
const projects = JSON.parse(await readFile(new URL('projects.json', root), 'utf8'));
const barSource = await readFile(new URL('bar/v1/bar.js', root), 'utf8');

function fetchWith(path, init = {}, asset = new Response('export {};', { headers: { 'Content-Type': 'text/javascript' } })) {
  const requested = [];
  const env = { ASSETS: { fetch: async (request) => { requested.push(new URL(request.url).pathname); return asset; } } };
  return worker.fetch(new Request('https://songaday.studio' + path, init), env).then((response) => ({ response, requested }));
}

test('the bar and projects.json can be loaded from any site, with their own caching', async () => {
  const cases = [
    ['/bar/v1/bar.js', 'public, max-age=14400'],
    ['/projects.json', 'public, max-age=300']
  ];
  for (const [path, cache] of cases) {
    for (const method of ['GET', 'HEAD']) {
      const { response, requested } = await fetchWith(path, { method, headers: { Origin: 'https://songaday.fan' } });
      assert.equal(response.status, 200, `${method} ${path}`);
      assert.deepEqual(requested, [path]);
      assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*', path);
      assert.equal(response.headers.get('Cross-Origin-Resource-Policy'), 'cross-origin', path);
      assert.equal(response.headers.get('Cache-Control'), cache, path);
    }
  }
  const preflight = (await fetchWith('/projects.json', { method: 'OPTIONS', headers: { Origin: 'https://wamp.land' } })).response;
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), '*');
  assert.match(preflight.headers.get('Access-Control-Allow-Methods'), /GET/);

  // A revalidation (304) keeps the long cache, or every page view would revalidate after the first.
  const revalidated = (await fetchWith('/bar/v1/bar.js', { headers: { 'If-None-Match': '"x"' } }, new Response(null, { status: 304 }))).response;
  assert.equal(revalidated.status, 304);
  assert.equal(revalidated.headers.get('Cache-Control'), 'public, max-age=14400');

  // A missing file keeps CORS (so the host page's fetch sees the 404) but isn't cached for hours.
  const missing = (await fetchWith('/bar/v1/nope.js', {}, new Response('Not found', { status: 404 }))).response;
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get('Access-Control-Allow-Origin'), '*');
  assert.notEqual(missing.headers.get('Cache-Control'), 'public, max-age=14400');

  // Pages don't get CORS.
  const page = (await fetchWith('/plugins/', {}, new Response('<p>hi</p>', { headers: { 'Content-Type': 'image/png' } }))).response;
  assert.equal(page.headers.get('Access-Control-Allow-Origin'), null);
});

test('the bar counts songs the same way as the rest of the site', () => {
  const dates = ['2009-01-01T05:00:00Z', '2026-10-21T16:00:00Z', '2026-10-22T03:59:59Z', '2026-10-22T04:00:00Z',
    '2026-03-08T07:00:00Z', '2026-11-01T06:00:00Z', '2027-01-01T04:59:59Z'];
  for (const date of dates) assert.equal(barNumber(new Date(date)), songADayNumber(new Date(date)), date);
  assert.equal(barNumber(new Date('2026-10-21T16:00:00Z')), 6503);
});

test('the bar reads its links from projects.json, and its built-in list matches it', () => {
  const items = barItems(projects);
  assert.deepEqual(items, FALLBACK);
  assert.deepEqual(items.map((item) => item.label), ['Listen', 'See all', 'Play', 'Get a song', 'Collect']);
  assert.deepEqual(items.filter((item) => item.crypto).map((item) => item.label), ['Collect']);

  // Bad rows are skipped instead of breaking the bar.
  assert.deepEqual(barItems(null), []);
  assert.deepEqual(barItems({ verbs: ['listen'], projects: [
    { verb: 'listen', inBar: true, barLabel: 'A', status: 'active', path: null, url: 'javascript:alert(1)' },
    { verb: 'listen', inBar: true, barLabel: 'B', status: 'archived', path: '/b', url: 'https://b.example/' },
    { verb: 'nope', inBar: true, barLabel: 'C', status: 'active', path: '/c', url: 'https://c.example/' },
    { verb: 'listen', inBar: true, status: 'active', path: '/d', url: 'https://d.example/' },
    null
  ] }), []);
  assert.equal(supportHref('songaday.fan'), 'https://songaday.studio/?from=songaday.fan#donate');
  // The pill says Donate, like the studio's own header: "Support" reads like help with the website.
  assert.match(barSource, /element\('a', 'support', 'Donate'\)/);
});

test('the bar carries the crypto-wallet-gate detector unchanged and fetches nothing else', async () => {
  const detector = await readFile(new URL('wallet/wallet-detect.js', root), 'utf8');
  const body = detector.replace(/^(\/\/.*\n)+/, '').replaceAll(/^export /gm, '').trim();
  const bundled = barSource.match(/\/\/ WALLET DETECT START.*\n(?:\/\/.*\n)*([\s\S]*?)\/\/ WALLET DETECT END/)[1].trim();
  assert.equal(bundled, body);
  const gate = await readFile(new URL('wallet/wallet-gate.js', root), 'utf8');
  assert.ok(barSource.includes(gate.match(/function override\(\)\{[\s\S]*?\n\}/)[0]), 'override() matches wallet-gate.js');
  assert.ok(barSource.includes("const KEY='crypto-override';"));

  // No fonts, images or other scripts: the only request is projects.json.
  assert.deepEqual([...barSource.matchAll(/\bfetch\(/g)].length, 1);
  assert.doesNotMatch(barSource, /\bimport\s|@import|url\(|<img|<link|new Image/);
  assert.doesNotMatch(barSource, /innerHTML|insertAdjacentHTML/);
  assert.doesNotMatch(barSource, /patreon/i);
});

test("the bar is for the other sites: songaday.studio's own pages don't show it", async () => {
  // Their header already links everywhere the bar does.
  for (const file of ['profile.html', 'profile.css', 'films.html', 'plugins/index.html', 'fumble-page.mjs',
    'everything.html', 'now.html', 'links/index.html', 'build.mjs']) {
    assert.doesNotMatch(await readFile(new URL(file, root), 'utf8'), /songaday-bar|bar\/v1\/bar\.js/, file);
  }
  // The data lab has no studio header, so its eyebrow links home instead.
  assert.match(await readFile(new URL('build.mjs', root), 'utf8'), /<p class="eyebrow"><a href="\/">Song A Day Studio<\/a> · Data lab<\/p>/);
  assert.match(await readFile(new URL('data-lab/lab.html', root), 'utf8'), /<p class="eyebrow">Song A Day · Data lab<\/p>/);
  // Other sites reserve the bar's height themselves (README, "The universe bar").
  assert.match(barSource, /:host \{ all: initial; display: block; position: relative; height: 36px;/);
});
