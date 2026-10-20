import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import worker from '../worker.mjs';
import { cleanStory, handleFumble, storyProblem } from '../fumble.mjs';

const root = new URL('../', import.meta.url);
const migration = await readFile(new URL('migrations/0001_fumble.sql', root), 'utf8');
const STORY = 'I sold my Punk in 2017 to pay for a used Civic. The Civic got totaled.';

// D1's prepare/bind/all/first/run over node:sqlite, with the real migration applied.
function fakeD1() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(migration);
  return {
    sqlite,
    prepare(sql) {
      const statement = (args) => ({
        bind: (...values) => statement(values),
        all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
        first: async (column) => {
          const row = sqlite.prepare(sql).get(...args);
          return row === undefined ? null : column ? row[column] : row;
        },
        run: async () => { sqlite.prepare(sql).run(...args); return { success: true }; }
      });
      return statement([]);
    }
  };
}

function setup({ human = true, limited = false } = {}) {
  const db = fakeD1();
  const verified = [];
  const env = {
    FUMBLE_DB: db,
    TURNSTILE_SITE_KEY: 'site-key',
    TURNSTILE_SECRET_KEY: 'secret-key',
    FUMBLE_LIMIT: { limit: async () => ({ success: !limited }) },
    FUMBLE_IMAGES: {
      async get(key) {
        if (key !== 'abc123-1.jpg') return null;
        return { body: 'jpeg bytes', size: 10, httpEtag: '"e1"', httpMetadata: { contentType: 'image/jpeg' } };
      }
    },
    ASSETS: { fetch: async () => new Response('asset', { headers: { 'Content-Type': 'image/png' } }) }
  };
  const fetchSiteverify = async (url, init) => {
    assert.equal(String(url), 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
    verified.push(Object.fromEntries(init.body));
    return Response.json({ success: human, action: 'fumble' });
  };
  return { db, env, verified, fetchSiteverify };
}

async function call(env, path, init = {}, fetchStub) {
  const realFetch = globalThis.fetch;
  if (fetchStub) globalThis.fetch = fetchStub;
  try {
    return await worker.fetch(new Request('https://songaday.studio' + path, init), env);
  } finally {
    globalThis.fetch = realFetch;
  }
}

function post(fields, { json = true } = {}) {
  const body = new FormData();
  for (const [name, value] of Object.entries({ 'cf-turnstile-response': 'token', ...fields })) body.append(name, value);
  return { method: 'POST', body, headers: json ? { Accept: 'application/json' } : {} };
}

function publish(db, { number = 1, story = STORY, image = 'abc123-1.jpg' } = {}) {
  db.sqlite.prepare(`INSERT INTO fumbles (id, story, submitted_on, status, number, published_at, image_key, image_alt)
    VALUES (?, ?, '2026-10-20', 'published', ?, '2026-10-20T16:00:00.000Z', ?, 'A man kneels by a wrecked car')`)
    .run(`id${number}`, story, number, image);
}

const rows = (db) => db.sqlite.prepare('SELECT * FROM fumbles ORDER BY rowid').all();

test('a posted story waits, unseen, until it is published', async () => {
  const { db, env, verified, fetchSiteverify } = setup();
  const response = await call(env, '/fumble', post({ story: `  ${STORY}\r\n\r\n\r\n\r\nNever again.  ` }), fetchSiteverify);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(verified, [{ secret: 'secret-key', response: 'token' }]);

  const [row] = rows(db);
  assert.equal(row.status, 'pending');
  assert.equal(row.story, `${STORY}\n\nNever again.`);
  assert.match(row.submitted_on, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(row.number, null);
  assert.deepEqual(Object.keys(row).sort(),
    ['id', 'image_alt', 'image_key', 'number', 'published_at', 'status', 'story', 'submitted_on']);

  const page = await (await call(env, '/fumble')).text();
  assert.doesNotMatch(page, /totaled/);
  assert.match(page, /Nothing on the walls yet/);
});

test('published stories hang on the wall, escaped, with their painting and permalink', async () => {
  const { db, env } = setup();
  publish(db, { story: 'Bought the top.\n\n<script>alert("x")</script> & cried' });
  publish(db, { number: 2, image: null });
  const response = await call(env, '/fumble/');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-cache');
  const html = await response.text();
  assert.match(html, /<h1>The Museum of Fumbled Bags<\/h1>/);
  assert.match(html, /<p>Bought the top\.<\/p>\s*<p>&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt; &amp; cried<\/p>/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /<img src="\/fumble\/images\/abc123-1\.jpg" alt="A man kneels by a wrecked car"/);
  assert.match(html, /href="\/fumble\/2">Fumble No\. 2<\/a>[\s\S]*href="\/fumble\/1">Fumble No\. 1<\/a>/);
  assert.match(html, /<time datetime="2026-10-20">October 20, 2026<\/time>/);
  assert.match(html, /data-sitekey="site-key"/);

  // The inline script runs only with this response's nonce.
  const nonce = response.headers.get('Content-Security-Policy').match(/'nonce-([0-9a-f]+)'/)[1];
  assert.match(html, new RegExp(`<script nonce="${nonce}">`));

  const single = await call(env, '/fumble/1');
  const singleHtml = await single.text();
  assert.equal(single.status, 200);
  assert.match(singleHtml, /<h1>Fumble No\. 1<\/h1>/);
  assert.match(singleHtml, /<meta property="og:image" content="https:\/\/songaday\.studio\/fumble\/images\/abc123-1\.jpg">/);
  assert.match(singleHtml, /<link rel="canonical" href="https:\/\/songaday\.studio\/fumble\/1">/);
  assert.doesNotMatch(singleHtml, /Fumble No\. 2/);
});

test('waiting and missing stories have no permalink', async () => {
  const { db, env, fetchSiteverify } = setup();
  await call(env, '/fumble', post({ story: STORY }), fetchSiteverify);
  db.sqlite.prepare('UPDATE fumbles SET number = 7').run();
  for (const path of ['/fumble/7', '/fumble/8', '/fumble/nope']) {
    const response = await call(env, path);
    assert.equal(response.status, 404, path);
    assert.match(await response.text(), /That fumble isn’t on the walls/, path);
  }
});

test('stories with problems are refused and nothing is saved', async () => {
  const cases = {
    'Too short.': /at least 20 characters/,
    [`${STORY} DM me at https://scam.example`]: /Leave out links/,
    [`${STORY} My wallet was 0x${'ab'.repeat(20)}`]: /wallet address/,
    ['x'.repeat(1501)]: /under 1,500 characters/
  };
  for (const [story, message] of Object.entries(cases)) {
    const { db, env, verified, fetchSiteverify } = setup();
    const response = await call(env, '/fumble', post({ story }), fetchSiteverify);
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, message);
    assert.equal(rows(db).length, 0);
    assert.equal(verified.length, 0, 'Turnstile is not asked about a story that will be refused');
  }
});

test('the human check, rate limit and honeypot all keep stories out', async () => {
  const failed = setup({ human: false });
  let response = await call(failed.env, '/fumble', post({ story: STORY }), failed.fetchSiteverify);
  assert.equal(response.status, 403);
  assert.equal(rows(failed.db).length, 0);

  const missingToken = setup();
  response = await call(missingToken.env, '/fumble', post({ story: STORY, 'cf-turnstile-response': '' }), missingToken.fetchSiteverify);
  assert.equal(response.status, 403);

  const limited = setup({ limited: true });
  response = await call(limited.env, '/fumble', post({ story: STORY }), limited.fetchSiteverify);
  assert.equal(response.status, 429);
  assert.equal(rows(limited.db).length, 0);

  const bot = setup();
  response = await call(bot.env, '/fumble', post({ story: STORY, website: 'http://spam.example' }), bot.fetchSiteverify);
  assert.equal(response.status, 200);
  assert.equal(rows(bot.db).length, 0);
});

test('posting stops while 300 stories are waiting', async () => {
  const { db, env, fetchSiteverify } = setup();
  const insert = db.sqlite.prepare("INSERT INTO fumbles (id, story, submitted_on) VALUES (?, 'waiting story here', '2026-10-20')");
  for (let i = 0; i < 300; i++) insert.run(`w${i}`);
  const response = await call(env, '/fumble', post({ story: STORY }), fetchSiteverify);
  assert.equal(response.status, 503);
  assert.equal(rows(db).length, 300);
});

test('without JavaScript, posting redirects on success and keeps the draft on a problem', async () => {
  const { env, fetchSiteverify } = setup();
  const ok = await call(env, '/fumble', post({ story: STORY }, { json: false }), fetchSiteverify);
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get('Location'), '/fumble?sent#tell');
  const thanks = await (await call(env, '/fumble?sent')).text();
  assert.match(thanks, /Got it\. Your fumble goes up once Jonathan has read it\./);
  assert.doesNotMatch(thanks, /<textarea/);

  const draft = `${STORY} https://example.com <b>`;
  const problem = await call(env, '/fumble', post({ story: draft }, { json: false }), fetchSiteverify);
  assert.equal(problem.status, 400);
  const html = await problem.text();
  assert.match(html, /Leave out links\./);
  assert.match(html, /totaled\. https:\/\/example\.com &lt;b&gt;<\/textarea>/);
});

test('posting is closed, not broken, without the database or Turnstile secret', async () => {
  const { env } = setup();
  delete env.TURNSTILE_SECRET_KEY;
  const response = await call(env, '/fumble', post({ story: STORY }));
  assert.equal(response.status, 503);
  delete env.FUMBLE_DB;
  const page = await call(env, '/fumble');
  assert.equal(page.status, 503);
  assert.match(await page.text(), /Posting is closed right now/);
});

test('paintings come from R2 with a long cache, and HEAD has no body', async () => {
  const { env } = setup();
  const response = await call(env, '/fumble/images/abc123-1.jpg');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'image/jpeg');
  assert.equal(response.headers.get('Cache-Control'), 'public, max-age=31536000, immutable');
  assert.equal(await response.text(), 'jpeg bytes');
  assert.equal((await call(env, '/fumble/images/missing.jpg')).status, 404);
  assert.equal((await call(env, '/fumble/images/abc123-1.jpg', { headers: { 'If-None-Match': '"e1"' } })).status, 304);

  const head = await call(env, '/fumble', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
});

test('only /fumble paths are handled here', async () => {
  const { env } = setup();
  for (const path of ['/', '/fumbles', '/plugins/', '/assets/fumble/x.png']) {
    assert.equal(await handleFumble(new Request('https://songaday.studio' + path), env, new URL('https://songaday.studio' + path)), null, path);
  }
  const put = await call(env, '/fumble', { method: 'PUT' });
  assert.equal(put.status, 405);
});

test('story cleanup and checks', () => {
  assert.equal(cleanStory('a\u0000b‮c \t\r\nd\n\n\n\ne'), 'abc\nd\n\ne');
  assert.equal(storyProblem('x'.repeat(20)), null);
  assert.equal(storyProblem(`${STORY} vitalik.eth bought it`), null);
  assert.match(storyProblem(`${STORY} t.me/recoverfunds`), /links/);
});

test('the fumble page header links to the same sections as the home page', async () => {
  const navLinks = (html) => [...html.match(/<nav class="site-sections"[\s\S]*?<\/nav>/)[0].matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
  const home = await readFile(new URL('profile.html', root), 'utf8');
  const { env } = setup();
  const fumble = await (await call(env, '/fumble')).text();
  assert.deepEqual(navLinks(fumble), navLinks(home));
  assert.match(fumble, /class="nav-donate" href="\/#donate"/);
});
