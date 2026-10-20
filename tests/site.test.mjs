import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import worker from '../worker.mjs';

const root = new URL('../', import.meta.url);

function fetchPath(path, origin = 'https://songaday.studio') {
  const env = {
    ASSETS: { fetch: async () => new Response('asset', { headers: { 'Content-Type': 'image/png' } }) }
  };
  return worker.fetch(new Request(origin + path), env);
}

test('section URLs redirect temporarily and are never cached', async () => {
  const cases = {
    '/songs': 'https://gallery.songaday.world/',
    '/songs/': 'https://gallery.songaday.world/',
    '/Games': 'https://mann.cool/',
    '/films': 'https://www.youtube.com/channel/UCvj5S3f10rO6CoibatfRGzg/videos',
    '/mini-docs': '/films',
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

test('the plugins page and assets still come from static assets', async () => {
  for (const path of ['/plugins/', '/assets/icons/tunes.png', '/songs-about-cats']) {
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

test('the plugins page header links match the home page header', async () => {
  const navLinks = (html) => {
    const nav = html.match(/<nav class="site-sections"[\s\S]*?<\/nav>/);
    assert.ok(nav, 'site-sections nav is present');
    return [...nav[0].matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
  };
  const home = await readFile(new URL('profile.html', root), 'utf8');
  const plugins = await readFile(new URL('plugins/index.html', root), 'utf8');
  assert.deepEqual(navLinks(plugins), navLinks(home));
  assert.deepEqual(navLinks(home), ['/songs', '/games', '/films', '/plugins/']);
  assert.match(plugins, /class="nav-donate" href="\/#donate"/);
  assert.match(home, /class="nav-donate" href="#donate"/);
  assert.match(home, /id="donate"/);
});
