import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import worker from '../worker.mjs';
import { SECTIONS, donateHref } from '../bar/v1/header.js';

const root = new URL('../', import.meta.url);
const read = (file) => readFile(new URL(file, root), 'utf8');
const source = await read('bar/v1/header.js');

// A page's menu as [label, address, has the leaving arrow].
function menu(html) {
  const nav = html.match(/<nav class="site-sections"[\s\S]*?<\/nav>/);
  assert.ok(nav, 'site-sections nav is present');
  return [...nav[0].matchAll(/<a href="([^"]+)"[^>]*>([^<]+)(<span class="nav-out" aria-hidden="true">↗<\/span>)?<\/a>/g)]
    .map((match) => [match[2], match[1], Boolean(match[3])]);
}

test("the header for other sites has the studio's own menu, in the same order", async () => {
  const studio = menu(await read('profile.html'));
  assert.equal(studio.length, 7);
  assert.deepEqual(SECTIONS.map((section) => [section.label, section.path, section.leaves === true]), studio);
  assert.equal(new Set(SECTIONS.map((section) => section.id)).size, SECTIONS.length);
  assert.ok(SECTIONS.every((section) => /^[a-z][a-z-]*$/.test(section.id) && /^\/[a-z/]+$/.test(section.path)));
  // Every copy of the studio header agrees, so the one check above covers them all.
  for (const file of ['films.html', 'plugins/index.html', 'fumble-page.mjs']) {
    assert.deepEqual(menu(await read(file)), studio, file);
  }
});

test('Games carries the menu to mann.cool, so it no longer shows the leaving arrow; Listen still does', async () => {
  const studio = menu(await read('profile.html'));
  assert.deepEqual(studio.find(([label]) => label === 'Games'), ['Games', '/games', false]);
  assert.deepEqual(studio.find(([label]) => label === 'Listen'), ['Listen', '/listen', true]);
  for (const file of ['profile.html', 'films.html', 'plugins/index.html', 'fumble-page.mjs']) {
    assert.doesNotMatch(await read(file), /Games<span class="nav-out"/, file);
  }
  assert.equal(SECTIONS.find((section) => section.id === 'games').leaves, undefined);
});

test('the header can be loaded from any site, cached like the bar', async () => {
  const requested = [];
  const env = { ASSETS: { fetch: async (request) => { requested.push(new URL(request.url).pathname); return new Response('export {};', { headers: { 'Content-Type': 'text/javascript' } }); } } };
  const response = await worker.fetch(new Request('https://songaday.studio/bar/v1/header.js', { headers: { Origin: 'https://mann.cool' } }), env);
  assert.equal(response.status, 200);
  assert.deepEqual(requested, ['/bar/v1/header.js']);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal(response.headers.get('Cross-Origin-Resource-Policy'), 'cross-origin');
  assert.equal(response.headers.get('Cache-Control'), 'public, max-age=14400');
});

test('the header draws in its own shadow DOM, asks for nothing, and keeps the heights it promises', () => {
  assert.match(source, /attachShadow\(\{ mode: 'open' \}\)/);
  assert.match(source, /:host \{ all: initial; display: block; position: sticky; top: 0;/);
  // No requests of its own: no fetch, no projects.json. The one address it loads is the studio's mark.
  assert.doesNotMatch(source, /\bfetch\(|projects\.json|XMLHttpRequest|localStorage|document\.cookie/);
  assert.deepEqual([...source.matchAll(/https:\/\/[a-z0-9.-]+/g)].map((match) => match[0]).filter((host) => host !== 'https://songaday.studio'), []);
  // The heights a host page reserves (the comment at the top of the file, and the README).
  assert.match(source, /songaday-header \{ display: block; min-height: 68px; background: #000; \}/);
  assert.match(source, /@media \(max-width: 1100px\) \{ songaday-header \{ min-height: 101px; \} \}/);
  assert.match(source, /header \{ display: flex; [^}]*min-height: 68px; [^}]*border-bottom: 4px solid #ff2445; \}/);
  assert.match(source, /grid-template-areas: "sections sections" "brand donate"; [^}]*min-height: 101px;/);
  // Sizes are in pixels: a host page may set its own root font size.
  assert.doesNotMatch(source.match(/const STYLE = `[\s\S]*?`;/)[0], /\d(rem)\b/);
  assert.equal(donateHref('mann.cool'), 'https://songaday.studio/?from=mann.cool#donate');
});

test("the header is for the other sites: songaday.studio's own pages keep their built-in one", async () => {
  for (const file of ['profile.html', 'films.html', 'plugins/index.html', 'fumble-page.mjs', 'everything.html', 'now.html',
    'store.html', 'store-muscle.html', 'commission.html', 'links/index.html', 'build.mjs']) {
    assert.doesNotMatch(await read(file), /songaday-header|bar\/v1\/header\.js/, file);
  }
});
