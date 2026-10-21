import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import worker from '../worker.mjs';
import { FILMS_FEED_URL, parseFeed, renderFilms } from '../films.mjs';
import { SONGS_FEED_URL, latestSong, renderTodaySong } from '../today-song.mjs';
import { renderCalendar, songNumberFor, yearImageSize } from '../calendar.mjs';
import { songADayNumber } from '../song-day.mjs';

const root = new URL('../', import.meta.url);

function fetchPath(path, origin = 'https://songaday.studio') {
  const env = {
    ASSETS: { fetch: async () => new Response('asset', { headers: { 'Content-Type': 'image/png' } }) }
  };
  return worker.fetch(new Request(origin + path), env);
}

test('section URLs redirect temporarily and are never cached', async () => {
  const cases = {
    '/all': 'https://songaday.fan/explore',
    '/songs': 'https://songaday.fan/explore',
    '/songs/': 'https://songaday.fan/explore',
    '/listen': 'https://songaday.fan/challenge',
    '/suggest': 'https://songaday.fan/suggestions',
    '/Jamuary': 'https://songaday.fan/jamuary',
    '/today': '/#today',
    '/Games': 'https://mann.cool/',
    '/wamp': 'https://wamp.land/',
    '/commission': 'https://jonathanmann.bandcamp.com/merch',
    '/commissions/': 'https://jonathanmann.bandcamp.com/merch',
    '/albums': 'https://jonathanmann.bandcamp.com/music',
    '/discord': 'https://discord.gg/rGTQH7mFNS',
    '/me': 'https://www.jonathanmann.net/',
    '/mini-docs': '/films/',
    '/donate': '/#donate'
  };
  for (const [path, location] of Object.entries(cases)) {
    const response = await fetchPath(path);
    assert.equal(response.status, 302, path);
    assert.equal(response.headers.get('Location'), location, path);
    assert.equal(response.headers.get('Cache-Control'), 'no-store', path);
  }
});

test('same-site redirects keep the query string', async () => {
  const response = await fetchPath('/donate?utm_source=newsletter');
  assert.equal(response.headers.get('Location'), '/?utm_source=newsletter#donate');
  const games = await fetchPath('/games?utm_source=newsletter');
  assert.equal(games.headers.get('Location'), 'https://mann.cool/');
});

test('HTML pages answer GET and HEAD with fresh, uncached headers', async () => {
  // Node has no HTMLRewriter; this stand-in returns a response with immutable headers,
  // like the real one does for HEAD requests.
  globalThis.HTMLRewriter = class {
    on() { return this; }
    transform(response) {
      const frozen = new Response(response.body, response);
      Object.defineProperty(frozen, 'headers', { value: new Proxy(frozen.headers, {
        get(target, key) {
          if (key === 'set' || key === 'delete') return () => { throw new TypeError("Can't modify immutable headers."); };
          const value = Reflect.get(target, key);
          return typeof value === 'function' ? value.bind(target) : value;
        }
      }) });
      return frozen;
    }
  };
  try {
    for (const method of ['GET', 'HEAD']) {
      const env = { ASSETS: { fetch: async () => new Response(method === 'HEAD' ? null : '<p>hi</p>', {
        headers: { 'Content-Type': 'text/html; charset=utf-8', ETag: '"abc"' }
      }) } };
      const response = await worker.fetch(new Request('https://songaday.studio/', { method }), env);
      assert.equal(response.status, 200, method);
      assert.equal(response.headers.get('Cache-Control'), 'no-cache', method);
      assert.equal(response.headers.get('ETag'), null, method);
    }
  } finally {
    delete globalThis.HTMLRewriter;
  }
});

test('the plugins and films pages and assets still come from static assets', async () => {
  for (const path of ['/plugins/', '/films/', '/assets/icons/tunes.png', '/songs-about-cats']) {
    const response = await fetchPath(path);
    assert.equal(response.status, 200, path);
    assert.equal(await response.text(), 'asset', path);
  }
});

test('www and http go to https://songaday.studio, but local previews stay on http', async () => {
  const www = await fetchPath('/plugins/', 'https://www.songaday.studio');
  assert.equal(www.status, 301);
  assert.equal(www.headers.get('Location'), 'https://songaday.studio/plugins/');
  const http = await fetchPath('/', 'http://songaday.studio');
  assert.equal(http.headers.get('Location'), 'https://songaday.studio/');
  const local = await fetchPath('/songs', 'http://localhost:8787');
  assert.equal(local.status, 302);
});

test('every page header links to the same sections', async () => {
  const navLinks = (html) => {
    const nav = html.match(/<nav class="site-sections"[\s\S]*?<\/nav>/);
    assert.ok(nav, 'site-sections nav is present');
    return [...nav[0].matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
  };
  const home = await readFile(new URL('profile.html', root), 'utf8');
  const plugins = await readFile(new URL('plugins/index.html', root), 'utf8');
  const films = await readFile(new URL('films.html', root), 'utf8');
  assert.deepEqual(navLinks(home), ['/all', '/listen', '/games', '/films/', '/plugins/', '/commission']);
  assert.deepEqual(navLinks(plugins), navLinks(home));
  assert.deepEqual(navLinks(films), navLinks(home));
  assert.match(plugins, /class="nav-donate" href="\/#donate"/);
  assert.match(films, /class="nav-donate" href="\/#donate"/);
  assert.match(films, /href="\/films\/" aria-current="page"/);
  assert.match(home, /class="nav-donate" href="#donate"/);
  assert.match(home, /id="donate"/);
});

test('the films feed is read in playlist order and rendered safely', async () => {
  const xml = await readFile(new URL('tests/fixtures/films-feed.xml', root), 'utf8');
  const films = parseFeed(xml);
  assert.deepEqual(films.map((film) => film.id), ['dZkMLlZ_2oc', 'MLCDgQNnTB0', 'AAAAAAAAAAA']);
  assert.equal(films[1].title, 'Marriage & Feminism');
  assert.equal(films[2].title, "It's $& 🎵 &#x110000;");
  assert.equal(films[0].published, '2026-10-14');

  const html = renderFilms([...films, { id: 'abcdefghijk', title: '<script>"x"</script>', published: '2015-02-03' }]);
  assert.match(html, /class="film film-featured"[\s\S]*dZkMLlZ_2oc\/maxresdefault\.jpg/);
  assert.match(html, /Marriage &amp; Feminism/);
  assert.match(html, /It&#39;s \$&amp; 🎵 &amp;#x110000;/);
  assert.match(html, /<time datetime="2026-10-14">October 2026<\/time>/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;&quot;x&quot;&lt;\/script&gt;/);
});

test('any spelling of /films lands on /films/', async () => {
  for (const path of ['/films', '/Films', '/FILMS/']) {
    const response = await fetchPath(path + '?from=x');
    assert.equal(response.status, 302, path);
    assert.equal(response.headers.get('Location'), '/films/?from=x', path);
  }
});

test('the Films page is filled from the live playlist, and only on GET /films/', async () => {
  const feed = await readFile(new URL('tests/fixtures/films-feed.xml', root), 'utf8');
  const realFetch = globalThis.fetch;
  const fetched = [];
  const handlers = [];
  globalThis.fetch = async (url) => { fetched.push(String(url)); return new Response(feed); };
  globalThis.HTMLRewriter = class {
    on(selector, handler) { handlers.push({ selector, handler }); return this; }
    transform(response) { return response; }
  };
  const env = { ASSETS: { fetch: async () => new Response('<div id="films-list"></div>', { headers: { 'Content-Type': 'text/html' } }) } };
  const fill = async () => {
    const list = handlers.find((entry) => entry.selector === '#films-list');
    if (!list) return null;
    let html = null;
    await list.handler.element({ setInnerContent(content, options) { html = content; assert.deepEqual(options, { html: true }); } });
    return html;
  };
  try {
    await worker.fetch(new Request('https://songaday.studio/films/'), env);
    assert.match(await fill(), /data-film-id="dZkMLlZ_2oc"/);
    assert.equal(fetched.length, 1);

    handlers.length = 0;
    fetched.length = 0;
    await worker.fetch(new Request('https://songaday.studio/films/', { method: 'HEAD' }), env);
    await worker.fetch(new Request('https://songaday.studio/'), env);
    assert.deepEqual(fetched.filter((url) => url === FILMS_FEED_URL), []);
    assert.equal(await fill(), null);

    // A failing feed leaves the built-in snapshot alone.
    globalThis.fetch = async () => new Response('blocked', { status: 403 });
    handlers.length = 0;
    await worker.fetch(new Request('https://songaday.studio/films/'), env);
    assert.equal(await fill(), null);
  } finally {
    globalThis.fetch = realFetch;
    delete globalThis.HTMLRewriter;
  }
});

test('/year/<year> goes to that year on the home page calendar', async () => {
  const response = await fetchPath('/year/2014?from=x');
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('Location'), '/?from=x#year-2014');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  for (const path of ['/year/2008', '/year/3000', '/year/14', '/year/']) {
    const other = await fetchPath(path);
    assert.notEqual(other.status, 302, path);
  }
});

test('the newest song is picked from the channel feed and rendered safely', async () => {
  const xml = await readFile(new URL('tests/fixtures/songs-feed.xml', root), 'utf8');
  const song = latestSong(xml);
  assert.deepEqual(song, { id: 'VNWfqsdMXl8', title: 'The Broken Keys & <The Internet>', number: 6503 });
  const today = renderTodaySong(song, 6503);
  assert.match(today, /data-video-id="VNWfqsdMXl8"/);
  assert.match(today, /Today’s song/);
  assert.match(today, /The Broken Keys &amp; &lt;The Internet&gt;/);
  assert.doesNotMatch(today, /<The Internet>/);
  assert.match(today, /#6,503 · Oct 21, 2026/);
  assert.match(renderTodaySong(song, 6504), /Latest song/);
  assert.match(renderTodaySong(song), /Latest song/);
  assert.equal(latestSong('<feed></feed>'), null);
});

test('the home page gets the live song, and only on GET /', async () => {
  const feed = await readFile(new URL('tests/fixtures/songs-feed.xml', root), 'utf8');
  const realFetch = globalThis.fetch;
  const fetched = [];
  const handlers = [];
  globalThis.fetch = async (url) => { fetched.push(String(url)); return new Response(feed); };
  globalThis.HTMLRewriter = class {
    on(selector, handler) { handlers.push({ selector, handler }); return this; }
    transform(response) { return response; }
  };
  const env = { ASSETS: { fetch: async () => new Response('<div id="today"></div>', { headers: { 'Content-Type': 'text/html' } }) } };
  const fill = async () => {
    const card = handlers.find((entry) => entry.selector === '#today');
    if (!card) return null;
    let html = null;
    await card.handler.element({ setInnerContent(content, options) { html = content; assert.deepEqual(options, { html: true }); } });
    return html;
  };
  try {
    await worker.fetch(new Request('https://songaday.studio/'), env);
    assert.match(await fill(), /data-video-id="VNWfqsdMXl8"/);
    assert.deepEqual(fetched, [SONGS_FEED_URL]);

    handlers.length = 0;
    fetched.length = 0;
    await worker.fetch(new Request('https://songaday.studio/', { method: 'HEAD' }), env);
    await worker.fetch(new Request('https://songaday.studio/films/'), env);
    assert.deepEqual(fetched.filter((url) => url === SONGS_FEED_URL), []);
    assert.equal(await fill(), null);

    // A failing feed leaves the built-in snapshot alone.
    globalThis.fetch = async () => new Response('blocked', { status: 403 });
    handlers.length = 0;
    await worker.fetch(new Request('https://songaday.studio/'), env);
    assert.equal(await fill(), null);
  } finally {
    globalThis.fetch = realFetch;
    delete globalThis.HTMLRewriter;
  }
});

test('the calendar numbers days like Song A Day and renders every year', () => {
  assert.equal(songNumberFor(2009, 0, 1), 1);
  assert.equal(songNumberFor(2026, 9, 21), 6503);
  assert.equal(songNumberFor(2026, 1, 30), 0);
  assert.equal(songNumberFor(2024, 1, 29), songNumberFor(2024, 1, 28) + 1);
  assert.deepEqual(yearImageSize(1), { width: 526, height: 119 });
  assert.deepEqual(yearImageSize(2), { width: 1052, height: 238 });

  const html = renderCalendar({ through: 6502, years: [
    { year: 2009, songs: 365, home: 'Berkeley' },
    { year: 2026, songs: 293, home: 'Hartford' }
  ] });
  assert.match(html, /id="year-2009">\s*<img src="assets\/calendar\/2009\.webp\?v=6502"/);
  assert.match(html, /srcset="assets\/calendar\/2026\.webp\?v=6502 526w, assets\/calendar\/2026@2x\.webp\?v=6502 1052w"/);
  assert.match(html, /<strong>2009<\/strong> <span>Berkeley · 365 songs<\/span>/);
  assert.match(html, /<strong>2026<\/strong> <span>Hartford · 293 so far<\/span>/);
  assert.match(html, /Through #6,502, October 20, 2026\./);
});

test('calendar.json has every year from 2009 and no songs from the future', async () => {
  const calendar = JSON.parse(await readFile(new URL('calendar.json', root), 'utf8'));
  assert.deepEqual(calendar.years.map((entry) => entry.year), calendar.years.map((_, index) => 2009 + index));
  assert.ok(calendar.years.reduce((sum, entry) => sum + entry.songs, 0) <= calendar.through);
  assert.ok(calendar.through <= songADayNumber());
});
