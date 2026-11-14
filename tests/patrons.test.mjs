import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import worker from '../worker.mjs';
import { PATRONS_PER_ROW, initialOf, patronProblems, renderPatrons } from '../patrons.mjs';

const root = new URL('../', import.meta.url);
// Made-up patrons, so the tests don't depend on who is in the real list.
const sample = () => ({
  patrons: [
    { name: 'Ada Example', bio: 'Writes <code> & sings.', image: '/assets/patrons/ada.webp', links: [{ label: 'X', url: 'https://x.com/example' }, { label: 'Website', url: 'https://example.com/?a=1&b=2' }] },
    { name: 'Example Collective', image: 'https://example.com/logo.png' },
    { name: '0xExample' },
    { name: 'Dee Example', bio: 'Listens.' },
    { name: 'Eve Example', image: 'https://example.com/eve.jpg' }
  ]
});

test('the patron list is checked row by row', () => {
  assert.deepEqual(patronProblems(sample()), []);
  assert.deepEqual(patronProblems({}), ['patrons.json needs a "patrons" list.']);
  const broken = {
    patrons: [
      { name: 'Ada Example' },
      { name: 'ada example' },
      { bio: 'No name.' },
      { name: 'Bo', bio: '' },
      { name: 'Cy', bio: 'x'.repeat(241) },
      { name: 'Di', image: 'http://example.com/a.jpg' },
      { name: 'Ed', links: [{ label: 'X', url: 'x.com/ed' }, { url: 'https://example.com' }] },
      { name: 'Flo', email: 'flo@example.com' }
    ]
  };
  assert.deepEqual(patronProblems(broken), [
    'ada example is listed twice.',
    'Row 3 has no name.',
    "Bo's bio is empty; leave it out instead.",
    "Cy's bio is over 240 characters.",
    "Di's image must be a /assets/ file or an https address.",
    "Ed's X link must be an https address.",
    'Ed has a link with no short label (X, Instagram, Website…).',
    'Flo has an unknown field "email".'
  ]);
});

test('a patron is a picture, a name, a line about them and their links, and only the name is needed', () => {
  const html = renderPatrons(sample());
  const items = html.split('<li class="patron">').slice(1);
  assert.equal(items.length, 5);
  // Everything typed into the list is escaped on the page.
  assert.match(items[0], /<p class="patron-bio" id="patron-bio-1" role="tooltip">Writes &lt;code&gt; &amp; sings\.<\/p>/);
  assert.match(items[0], /<a href="https:\/\/example\.com\/\?a=1&amp;b=2" target="_blank" rel="noopener noreferrer" aria-label="Ada Example on Website">Website<\/a>/);
  assert.match(items[0], /<img src="\/assets\/patrons\/ada\.webp" alt="" width="400" height="400" referrerpolicy="no-referrer">/);
  // The name comes before the picture for anyone listening to the page.
  assert.ok(items[0].indexOf('<h2 class="patron-name">Ada Example</h2>') < items[0].indexOf('<div class="patron-picture">'));
  // A line about them pops up over the picture, so the picture is a button that line describes.
  assert.match(items[0], /<button class="patron-face" type="button" aria-label="About Ada Example" aria-describedby="patron-bio-1"><img [^>]+><\/button>\s*<p class="patron-bio" id="patron-bio-1"/);
  assert.match(items[3], /<button class="patron-face" type="button" aria-label="About Dee Example" aria-describedby="patron-bio-4"><span class="patron-initial" aria-hidden="true">D<\/span><\/button>/);
  // No picture: their initial. No bio or links: a plain square and nothing in their place.
  assert.match(items[2], /^\s*<h2 class="patron-name">0xExample<\/h2>\s*<div class="patron-picture">\s*<span class="patron-face"><span class="patron-initial" aria-hidden="true">0<\/span><\/span>\s*<\/div>\s*<\/li>/);
  assert.doesNotMatch(items[1] + items[2] + items[4], /<button|patron-bio/);
  assert.doesNotMatch(items[3], /patron-links|<img/);
  assert.equal(initialOf('  émile'), 'É');
  // The first row is on screen when the page opens, so only later pictures wait to load.
  const wall = renderPatrons({
    patrons: Array.from({ length: PATRONS_PER_ROW + 1 }, (_, i) => ({ name: `Patron ${i}`, image: `https://example.com/${i}.jpg` }))
  }).split('<li class="patron">').slice(1);
  assert.doesNotMatch(wall.slice(0, PATRONS_PER_ROW).join(''), /loading="lazy"/);
  assert.match(wall[PATRONS_PER_ROW], /<img [^>]*loading="lazy" decoding="async"/);
});

test('the squares are small: eight share a row at full width, and the row size matches the styles', async () => {
  const css = await readFile(new URL('patrons.css', root), 'utf8');
  const across = /\.patrons \{ --patrons-across: (\d+);[^}]*grid-template-columns: repeat\(var\(--patrons-across\), minmax\(0, 1fr\)\);/.exec(css);
  assert.ok(across, 'the grid takes its row size from --patrons-across');
  assert.equal(Number(across[1]), PATRONS_PER_ROW);
  assert.equal(PATRONS_PER_ROW, 8);
  // Every row size names its own last column, whose pop-up opens leftward to stay on the page.
  const sizes = [PATRONS_PER_ROW, ...[...css.matchAll(/@media[^{]+\{ \.patrons \{ --patrons-across: (\d+);/g)].map((match) => Number(match[1]))];
  assert.deepEqual(sizes, [8, 6, 4, 3]);
  for (const size of sizes) assert.ok(css.includes(`.patron:nth-child(${size}n) .patron-bio { left: auto; right: 0; }`), `${size} across`);
  // Only the site's three text sizes, and nothing see-through.
  assert.doesNotMatch(css, /font-size: (?!var\(--type-(meta|body|display)\))/);
  assert.doesNotMatch(css, /opacity|rgba\(|border-radius/);
});

test('the line about a patron stays out of sight until their picture is pointed at, landed on or tapped', async () => {
  const [css, script] = await Promise.all(['patrons.css', 'patrons-page.js'].map((file) => readFile(new URL(file, root), 'utf8')));
  assert.match(css, /\.patron-bio \{[^}]*visibility: hidden; pointer-events: none; \}/);
  // A mouse (only where there is one, so a tap can close it again), a keyboard, and a finger.
  assert.match(css, /@media \(hover: hover\) \{ \.patron-picture:hover \.patron-bio \{ visibility: visible; \}/);
  // It sits just above the picture, so nothing of the patron is covered, and above the header.
  assert.match(css, /\.patron-bio \{ position: absolute; z-index: 25; bottom: calc\(100% - 2px\); left: 0;/);
  assert.match(css, /\.patron-face:focus-visible \+ \.patron-bio, \.patron-picture\.is-open \.patron-bio \{ visibility: visible; \}/);
  assert.match(script, /classList\.toggle\("is-open"\)/);
  // Escape puts it away, and that rule comes after the ones that show it.
  assert.match(script, /event\.key !== "Escape"/);
  assert.ok(css.indexOf('.patron-picture.is-dismissed .patron-bio { visibility: hidden; }') > css.indexOf('.patron-picture:hover .patron-bio'));
  // Solid, like the calendar's preview: no see-through panel, no shadow.
  assert.match(css, /\.patron-bio \{[^}]*border: 2px solid var\(--white\); background: var\(--ink\); color: var\(--white\);/);
  assert.doesNotMatch(css, /box-shadow/);
});

test('the build makes /patrons/ from patrons.json, with the studio header and a way to join', async () => {
  const out = await mkdtemp(path.join(tmpdir(), 'songaday-studio-patrons-'));
  try {
    await promisify(execFile)(process.execPath, [fileURLToPath(new URL('build.mjs', root)), '--out', out], {
      env: { ...process.env, SONGADAY_OFFLINE: '1' }
    });
    const [page, home] = await Promise.all(['patrons/index.html', 'index.html'].map((file) => readFile(path.join(out, file), 'utf8')));
    const list = JSON.parse(await readFile(new URL('patrons.json', root), 'utf8'));
    assert.deepEqual(patronProblems(list), []);
    assert.match(page, /<title>Patrons · Song A Day Studio<\/title>/);
    assert.match(page, /<h1>Patrons<\/h1>/);
    assert.equal(page.split('<li class="patron">').length - 1, list.patrons.length);
    assert.match(page, /<p class="patrons-join"><a href="\/#donate">Become a monthly supporter<\/a><\/p>/);
    assert.doesNotMatch(page, /\{\{/);
    // The same menu as the home page, Donate button included, and the page's own styles.
    const nav = (html) => [...html.match(/<nav class="site-sections"[\s\S]*?<\/nav>/)[0].matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(nav(page), nav(home));
    assert.match(page, /<a class="nav-donate" href="\/#donate">Donate<\/a>/);
    assert.match(page, /\.patrons \{ --patrons-across: 8;/);
    // One pop-up per patron with a line about them, and the script that opens it for a finger.
    assert.equal(page.split('<p class="patron-bio"').length - 1, list.patrons.filter((patron) => patron.bio).length);
    assert.match(page, /<script>[\s\S]*classList\.toggle\("is-open"\)[\s\S]*<\/script>/);
    // Goals, not progress: the page lists people, and never counts them or what they gave.
    const visible = page.replace(/<style[\s\S]*?<\/style>/g, '');
    assert.doesNotMatch(visible, /\$\d|\b\d+ (patrons|supporters|people)\b|<progress/i);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('/patrons lands on the page from any spelling, and production copies it', async () => {
  const env = { ASSETS: { fetch: async () => new Response('asset', { headers: { 'Content-Type': 'image/png' } }) } };
  for (const spelling of ['/patrons', '/Patrons', '/PATRONS/']) {
    const response = await worker.fetch(new Request('https://songaday.studio' + spelling), env);
    assert.equal(response.status, 302, spelling);
    assert.equal(response.headers.get('Location'), '/patrons/', spelling);
  }
  assert.equal((await worker.fetch(new Request('https://songaday.studio/patrons/'), env)).status, 200);
  const production = await readFile(new URL('build-production.mjs', root), 'utf8');
  assert.ok(production.includes("cp('patrons/index.html', 'dist/patrons/index.html')"));
});
