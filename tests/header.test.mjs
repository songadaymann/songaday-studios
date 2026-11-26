import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import worker from '../worker.mjs';
import { SECTIONS, donateHref } from '../bar/v1/header.js';

const root = new URL('../', import.meta.url);
const read = (file) => readFile(new URL(file, root), 'utf8');
const source = await read('bar/v1/header.js');

// A run of links as [label, address, has the leaving arrow].
const links = (html) => [...html.matchAll(/<a href="([^"]+)"[^>]*>([^<]+)(<span class="nav-out" aria-hidden="true">↗<\/span>)?<\/a>/g)]
  .map((match) => [match[2], match[1], Boolean(match[3])]);

// A page's menu, in order: a link as above, a group as [its word, its links].
function menu(html) {
  const nav = html.match(/<nav class="site-sections"[\s\S]*?<\/nav>/);
  assert.ok(nav, 'site-sections nav is present');
  return [...nav[0].matchAll(/<details class="nav-group" name="site-nav">\s*<summary[^>]*>([^<]+)<\/summary>\s*<div class="nav-sub">([\s\S]*?)<\/div>\s*<\/details>|(<a href="[^"]+"[^>]*>[\s\S]*?<\/a>)/g)]
    .map((match) => match[3] ? links(match[3])[0] : [match[1], links(match[2])]);
}

// Every link in a menu, groups opened up.
const flat = (entries) => entries.flatMap((entry) => Array.isArray(entry[1]) ? entry[1] : [entry]);
const asMenu = (section) => section.items
  ? [section.label, section.items.map((item) => [item.label, item.path, item.leaves === true])]
  : [section.label, section.path, section.leaves === true];
const everySection = SECTIONS.flatMap((section) => [section, ...(section.items ?? [])]);

test("the header for other sites has the studio's own menu, in the same order", async () => {
  const studio = menu(await read('profile.html'));
  assert.deepEqual(studio.map(([label]) => label), ['Songs', 'Films', 'Games', 'Software', 'Hire me', 'Store']);
  assert.equal(flat(studio).length, 10);
  assert.deepEqual(SECTIONS.map(asMenu), studio);
  assert.equal(new Set(everySection.map((section) => section.id)).size, everySection.length);
  assert.ok(everySection.every((section) => /^[a-z][a-z-]*$/.test(section.id)));
  // A group has links and no address of its own; a link has an address on the studio.
  assert.ok(everySection.every((section) => section.items ? section.path === undefined && section.items.length > 1 : /^\/[a-z/-]+(\?kind=[a-z]+)?$/.test(section.path)));
  // The ids mann.cool and songaday.fan already name in data-here still mean those links.
  assert.deepEqual(['games', 'listen'].map((id) => everySection.find((section) => section.id === id)?.path), ['/games', '/listen']);
  // Every copy of the studio header agrees, so the one check above covers them all.
  for (const file of ['films.html', 'plugins/index.html', 'fumble-page.mjs']) {
    assert.deepEqual(menu(await read(file)), studio, file);
  }
});

test('Games and Listen carry the menu to mann.cool and songaday.fan, so neither shows the leaving arrow', async () => {
  const studio = flat(menu(await read('profile.html')));
  assert.deepEqual(studio.find(([label]) => label === 'Games'), ['Games', '/games', false]);
  assert.deepEqual(studio.find(([label]) => label === 'Listen'), ['Listen', '/listen', false]);
  for (const file of ['profile.html', 'films.html', 'plugins/index.html', 'fumble-page.mjs']) {
    assert.doesNotMatch(await read(file), /(Games|Listen)<span class="nav-out"/, file);
  }
  assert.ok(everySection.every((section) => section.leaves === undefined));
  // The arrow itself is still there for a future section that does leave.
  assert.match(source, /section\.leaves && section\.id !== here/);
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

test('a section with more than one place to go is a group that opens without a script, here and on other sites', async () => {
  const chrome = await read('studio-chrome.css');
  // The studio's own pages: <details> sharing a name (one open at a time), styled in the shared styles.
  for (const file of ['profile.html', 'films.html', 'plugins/index.html', 'fumble-page.mjs']) {
    const nav = (await read(file)).match(/<nav class="site-sections"[\s\S]*?<\/nav>/)[0];
    assert.equal(nav.split('<details class="nav-group" name="site-nav">').length - 1, 3, file);
    assert.doesNotMatch(nav, /<script|onclick/, file);
  }
  assert.match(chrome, /\.nav-sub \{ position: absolute; z-index: 2; top: calc\(100% \+ 14px\);/);
  assert.match(chrome, /\.site-sections \.nav-group:has\(a\[aria-current\]\) > summary \{ border-bottom-color: var\(--red\); \}/);
  // A click elsewhere closes an open group, on wide screens only; on a phone its links are a row
  // of their own and the name moves down to make room.
  assert.match(chrome, /@media \(min-width: 1101px\) \{\n  \.site-sections details\[open\] > summary::before \{ content: ""; position: fixed; inset: 0; z-index: 1;/);
  assert.match(chrome, /\.site-sections:has\(details\[open\]\) \{ margin-bottom: calc\(\.55rem \+ 44px\); \}/);
  // The gallery's wall has bars of its own above the header's usual place in the stack.
  assert.match(await read('gallery.css'), /body > \.site-header \{[^}]*z-index: 300;/);
  // The header for other sites builds the same groups.
  assert.match(source, /const group = element\('details'\);\n\s+group\.setAttribute\('name', 'site-nav'\);/);
  assert.match(source, /if \(section\.id === here\) word\.setAttribute\('aria-current', 'true'\);/);
  assert.match(source, /details\[open\] > summary::before \{ content: ""; position: fixed; inset: 0; z-index: 1;/);
  assert.match(source, /nav:has\(details\[open\]\) \{ margin-bottom: 53px; \}/);
});
