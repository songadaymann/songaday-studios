import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import worker from '../worker.mjs';
import { fakeD1 } from './fake-cloudflare.mjs';
import { PLACES, RUNNING, WORDS, pickWords } from '../bar/v1/donate-words.js';
import { COOKIE, applyDonateTest, knownSite, pValue, readHit, summarize, visitorWords } from '../donate-test.mjs';

const root = new URL('../', import.meta.url);
const migration = await readFile(new URL('commission-migrations/0005_donate_test.sql', root), 'utf8');
const hit = (body, headers = {}) => new Request('https://songaday.studio/donate-test/hit', { method: 'POST', body, headers });

test('the test is on, "Donate" is the one to beat, and every wording can come up', () => {
  assert.equal(RUNNING, true);
  assert.equal(WORDS.a, 'Donate');
  assert.deepEqual(Object.values(WORDS), ['Donate', 'Be my best friend', 'Blood sacrifice', 'Get a tax break']);
  const seen = new Set([0, 0.26, 0.51, 0.76, 0.9999].map((value) => pickWords(() => value)));
  assert.deepEqual([...seen].sort(), ['a', 'b', 'c', 'd']);
  assert.equal(pickWords(() => 1), 'd');
});

test('a visitor keeps their wording, and ?donate_words= shows another', () => {
  const url = new URL('https://songaday.studio/');
  const kept = new Request(url, { headers: { Cookie: `other=1; ${COOKIE}=c` } });
  assert.deepEqual(visitorWords(kept, url), { words: 'c', remember: false });
  assert.deepEqual(visitorWords(new Request(url), url, () => 0.3), { words: 'b', remember: true });
  const broken = new Request(url, { headers: { Cookie: `${COOKIE}=z` } });
  assert.equal(visitorWords(broken, url, () => 0).remember, true);
  const asked = new URL('https://songaday.studio/?donate_words=d');
  assert.deepEqual(visitorWords(kept, asked), { words: 'd', remember: true });
  assert.deepEqual(visitorWords(new Request(asked, { headers: { Cookie: `${COOKIE}=d` } }), asked), { words: 'd', remember: false });
});

// A stand-in for HTMLRewriter that keeps the handlers so the test can run them.
function fakeRewriter() {
  const handlers = {};
  globalThis.HTMLRewriter = class {
    on(selector, handler) { handlers[selector] = handler; return this; }
    transform(response) { return response; }
  };
  return handlers;
}

test('studio pages get the wording on every Donate button and the counting script', async () => {
  const handlers = fakeRewriter();
  try {
    const page = () => new Response('<p>hi</p>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    const url = new URL('https://songaday.studio/films/');
    const response = applyDonateTest(new Request(url), url, page(), () => 0.6);
    assert.match(response.headers.get('Set-Cookie'), /^donate_words=c; Path=\/; Max-Age=5184000; SameSite=Lax; HttpOnly; Secure$/);

    const button = { text: '', attributes: {}, setInnerContent(text) { this.text = text; }, setAttribute(name, value) { this.attributes[name] = value; } };
    let added = '';
    const body = { onEndTag(callback) { this.end = callback; } };
    handlers.body.element(body);
    handlers['[data-donate]'].element(button);
    body.end({ before(html, options) { added = html; assert.deepEqual(options, { html: true }); } });
    assert.equal(button.text, 'Blood sacrifice');
    assert.equal(button.attributes['data-donate-words'], 'c');
    assert.equal(added, '<script type="module" src="/bar/v1/donate-page.js"></script>');

    // A page with no Donate button gets no script.
    applyDonateTest(new Request(url), url, page());
    const quiet = { onEndTag(callback) { this.end = callback; } };
    handlers.body.element(quiet);
    quiet.end({ before() { assert.fail('no script without a button'); } });

    // A returning visitor gets no new cookie.
    const again = applyDonateTest(new Request(url, { headers: { Cookie: 'donate_words=c' } }), url, page());
    assert.equal(again.headers.get('Set-Cookie'), null);
  } finally {
    delete globalThis.HTMLRewriter;
  }
});

test('purchase pages, admin pages, posts and files keep "Donate" and get no cookie', async () => {
  const handlers = fakeRewriter();
  try {
    for (const path of ['/commission', '/commission/admin/donate-test', '/business/', '/conference-troubadour/', '/store/', '/store/muscle/', '/Store/']) {
      const url = new URL(`https://songaday.studio${path}`);
      const original = new Response('<p>hi</p>', { headers: { 'Content-Type': 'text/html' } });
      assert.equal(applyDonateTest(new Request(url), url, original), original, path);
    }
    const url = new URL('https://songaday.studio/');
    const css = new Response('a{}', { headers: { 'Content-Type': 'text/css' } });
    assert.equal(applyDonateTest(new Request(url), url, css), css);
    const post = new Response('<p>hi</p>', { headers: { 'Content-Type': 'text/html' } });
    assert.equal(applyDonateTest(new Request(url, { method: 'POST' }), url, post), post);
    assert.equal(Object.keys(handlers).length, 0);
  } finally {
    delete globalThis.HTMLRewriter;
  }
});

test('a count is a view with no button, or a click on a known button, from a Song A Day site', () => {
  assert.deepEqual(readHit('{"event":"view","words":"b","place":"","site":"songaday.studio"}'), { event: 'view', words: 'b', place: '', site: 'songaday.studio' });
  assert.deepEqual(readHit('{"event":"click","words":"a","place":"bar","site":"songaday.fan"}'), { event: 'click', words: 'a', place: 'bar', site: 'songaday.fan' });
  assert.deepEqual(readHit('{"event":"click","words":"d","place":"header","site":"localhost"}').site, 'local');
  assert.equal(knownSite('play.mann.cool'), true);
  assert.equal(knownSite('evilmann.cool'), false);
  for (const body of [
    '{"event":"click","words":"a","place":"","site":"songaday.studio"}',
    '{"event":"view","words":"a","place":"header","site":"songaday.studio"}',
    '{"event":"click","words":"e","place":"bar","site":"songaday.studio"}',
    '{"event":"buy","words":"a","place":"bar","site":"songaday.studio"}',
    '{"event":"view","words":"a","site":"example.com"}',
    '{"event":"view","words":"a"}',
    'not json', 'null', '[]', 'x'.repeat(401)
  ]) assert.equal(readHit(body), null, body);
  assert.deepEqual([...PLACES], ['header', 'band', 'footer', 'bar', 'studio-header']);
});

test('counts add up by day, and a bad one is answered the same and not counted', async () => {
  const db = fakeD1(migration);
  const env = { COMMISSIONS_DB: db };
  const now = new Date('2026-11-25T03:00:00Z'); // still the 24th in New York
  const send = async (body) => {
    const { handleDonateTest } = await import('../donate-test.mjs');
    return handleDonateTest(hit(body), env, new URL('https://songaday.studio/donate-test/hit'), { now });
  };
  for (let i = 0; i < 3; i++) assert.equal((await send('{"event":"view","words":"b","place":"","site":"songaday.studio"}')).status, 204);
  await send('{"event":"click","words":"b","place":"header","site":"songaday.studio"}');
  const bad = await send('{"event":"click","words":"b","place":"nowhere","site":"songaday.studio"}');
  assert.equal(bad.status, 204);
  assert.deepEqual(db.sqlite.prepare('SELECT day, words, site, place, event, count FROM donate_counts ORDER BY event DESC').all().map((row) => ({ ...row })), [
    { day: '2026-11-24', words: 'b', site: 'songaday.studio', place: '', event: 'view', count: 3 },
    { day: '2026-11-24', words: 'b', site: 'songaday.studio', place: 'header', event: 'click', count: 1 }
  ]);

  // Through the Worker too, and only by POST.
  const response = await worker.fetch(hit('{"event":"view","words":"a","place":"","site":"songaday.fan"}'), env);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal((await worker.fetch(new Request('https://songaday.studio/donate-test/hit'), env)).status, 405);

  // Past the rate limit, nothing more is counted.
  const limited = { COMMISSIONS_DB: db, DONATE_LIMIT: { limit: async () => ({ success: false }) } };
  await worker.fetch(hit('{"event":"view","words":"a","place":"","site":"songaday.fan"}'), limited);
  assert.equal(db.sqlite.prepare("SELECT count FROM donate_counts WHERE site = 'songaday.fan'").get().count, 1);
});

test('the totals are for Jonathan only, behind the admin check', async () => {
  const db = fakeD1(migration);
  db.sqlite.exec(`INSERT INTO donate_counts VALUES
    ('2026-11-24', 'a', 'songaday.studio', '', 'view', 1000), ('2026-11-24', 'a', 'songaday.studio', 'header', 'click', 10),
    ('2026-11-25', 'c', 'songaday.studio', '', 'view', 1000), ('2026-11-25', 'c', 'mann.cool', 'studio-header', 'click', 30)`);
  const closed = await worker.fetch(new Request('https://songaday.studio/commission/admin/donate-test'), { COMMISSIONS_DB: db });
  assert.equal(closed.status, 401);

  const env = { COMMISSIONS_DB: db, COMMISSION_ADMIN_LOCAL: 'yes' };
  const page = await worker.fetch(new Request('http://localhost/commission/admin/donate-test'), env);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('Cache-Control'), 'no-store');
  const html = await page.text();
  assert.match(html, /2026-11-24 to 2026-11-25/);
  assert.match(html, /<td>Blood sacrifice<\/td><td class="n">1,000<\/td><td class="n">30<\/td><td class="n">3\.00%<\/td><td>clicked more than Donate<\/td>/);
  assert.match(html, /<td>Be my best friend<\/td><td class="n">0<\/td><td class="n">0<\/td><td class="n">–<\/td><td>too early<\/td>/);

  const json = await (await worker.fetch(new Request('http://localhost/commission/admin/donate-test?format=json'), env)).json();
  assert.equal(json.words[2].clicks, 30);
  assert.equal(json.words[2].places['studio-header'], 30);
  assert.deepEqual(json.sites['mann.cool'], { views: 0, clicks: 30 });
});

test('the comparison says "no difference" for the same rate and "different" for a big gap', () => {
  assert.ok(pValue(10, 1000, 10, 1000) > 0.99);
  assert.ok(pValue(30, 1000, 10, 1000) < 0.01);
  assert.equal(pValue(0, 0, 1, 10), null);
  assert.equal(pValue(0, 10, 0, 10), null);
  assert.equal(summarize([]).from, null);
});

test('every studio Donate button is marked, and the bar and header use the test words', async () => {
  for (const file of ['profile.html', 'films.html', 'plugins/index.html', 'fumble-page.mjs', 'story.html']) {
    const source = await readFile(new URL(file, root), 'utf8');
    const buttons = [...source.matchAll(/<a\b[^>]*>Donate<\/a>/g)].map((match) => match[0]);
    assert.ok(buttons.length, file);
    for (const button of buttons) assert.match(button, /data-donate="(header|band|footer)"/, `${file}: ${button}`);
  }
  for (const [file, place] of [['bar/v1/bar.js', 'bar'], ['bar/v1/header.js', 'studio-header']]) {
    const source = await readFile(new URL(file, root), 'utf8');
    assert.match(source, /^import \{ wireButton \} from '\.\/donate-words\.js';$/m, file);
    assert.match(source, new RegExp(`wireButton\\(\\w+, '${place}'\\)`), file);
  }
});
