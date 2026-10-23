// Stand-ins for the Cloudflare bindings and outside services the commission tests need: D1 over
// node:sqlite with the real migration, R2 as a Map, the rate limit and email bindings, a fetch
// that answers Turnstile, Stripe and Access, Stripe webhook signatures, and Access tokens.
// Not a .test.mjs, so the suite doesn't run it on its own.
import { execFile } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import worker from '../worker.mjs';

const root = new URL('../', import.meta.url);
export const migration = await readFile(new URL('commission-migrations/0001_commissions.sql', root), 'utf8');

// D1's prepare/bind/all/first/run/batch over node:sqlite. A batch is one transaction, like D1's.
// Each call runs synchronously, so two "concurrent" requests interleave only at awaits, as they
// would against D1's single writer. `queries` counts them the way D1's per-invocation limit
// does: every all, first and run, and every statement in a batch.
export function fakeD1(sql = migration) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(sql);
  const execute = (text, args) => {
    const statement = sqlite.prepare(text);
    if (/^\s*(SELECT|WITH)\b/i.test(text)) return { results: statement.all(...args), success: true, meta: { changes: 0 } };
    const info = statement.run(...args);
    return { results: [], success: true, meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
  };
  const db = {
    sqlite,
    queries: 0,
    prepare(text) {
      const statement = (args) => ({
        sql: text,
        args,
        bind: (...values) => statement(values.map((value) => value === undefined ? null : value)),
        all: async () => {
          db.queries++;
          return { results: sqlite.prepare(text).all(...args), success: true };
        },
        first: async (column) => {
          db.queries++;
          const row = sqlite.prepare(text).get(...args);
          return row === undefined ? null : column ? row[column] : row;
        },
        run: async () => {
          db.queries++;
          return execute(text, args);
        }
      });
      return statement([]);
    },
    async batch(statements) {
      db.queries += statements.length;
      sqlite.exec('BEGIN');
      try {
        const results = statements.map((statement) => execute(statement.sql, statement.args));
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
    rows: (table, where = '1') => sqlite.prepare(`SELECT * FROM ${table} WHERE ${where} ORDER BY rowid`).all().map((row) => ({ ...row })),
    one: (text, ...args) => {
      const row = sqlite.prepare(text).get(...args);
      return row ? { ...row } : row;
    },
    exec: (text, ...args) => sqlite.prepare(text).run(...args)
  };
  return db;
}

// An R2 bucket: put (a Blob, bytes or a string), get with a range, head and delete.
export function fakeR2() {
  const objects = new Map();
  const meta = (key, object) => ({
    key, size: object.bytes.length, httpEtag: `"${object.etag}"`, etag: object.etag, uploaded: object.uploaded,
    httpMetadata: object.httpMetadata
  });
  return {
    objects,
    async put(key, value, options = {}) {
      const bytes = value instanceof Blob ? new Uint8Array(await value.arrayBuffer())
        : typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
      objects.set(key, { bytes, httpMetadata: options.httpMetadata ?? {}, uploaded: new Date('2026-10-23T12:00:00Z'), etag: `e${objects.size + 1}` });
      return meta(key, objects.get(key));
    },
    async head(key) {
      return objects.has(key) ? meta(key, objects.get(key)) : null;
    },
    async get(key, options) {
      const object = objects.get(key);
      if (!object) return null;
      const { offset = 0, length = object.bytes.length - offset } = options?.range ?? {};
      const bytes = object.bytes.subarray(offset, offset + length);
      return { ...meta(key, object), body: new Blob([bytes]).stream(), arrayBuffer: async () => bytes.slice().buffer };
    },
    async delete(keys) {
      for (const key of [keys].flat()) objects.delete(key);
    }
  };
}

export const fakeRateLimit = (success = true) => ({ calls: [], async limit(options) { this.calls.push(options); return { success: typeof success === 'function' ? success(options) : success }; } });

// The send_email binding. `fail` is an error code to throw, or a function of the message.
export function fakeEmail() {
  const binding = {
    sent: [],
    fail: null,
    async send(message) {
      const code = typeof binding.fail === 'function' ? binding.fail(message) : binding.fail;
      if (code) throw Object.assign(new Error(`send failed for ${message.to}`), { code });
      binding.sent.push(message);
      return { messageId: `msg-${binding.sent.length}` };
    }
  };
  return binding;
}

// The real build, offline, once per test file, served by a fake ASSETS binding.
let built = null;
export function builtSite() {
  built ??= (async () => {
    const out = await mkdtemp(path.join(tmpdir(), 'songaday-commission-build-'));
    await promisify(execFile)(process.execPath, [fileURLToPath(new URL('build.mjs', root)), '--out', out], {
      env: { ...process.env, SONGADAY_OFFLINE: '1' }
    });
    const pages = {
      '/commission/': await readFile(path.join(out, 'commission/index.html'), 'utf8'),
      '/commission/song': await readFile(path.join(out, 'commission/song.html'), 'utf8')
    };
    await rm(out, { recursive: true, force: true });
    return pages;
  })();
  return built;
}

export async function fakeAssets() {
  const pages = await builtSite();
  return {
    pages,
    async fetch(input) {
      const { pathname } = new URL(typeof input === 'string' ? input : input.url ?? String(input));
      if (pages[pathname]) return new Response(pages[pathname], { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain' } });
    }
  };
}

// A fetch that answers by URL. Each route is [test, handler]: test is a string the URL starts
// with, or a function of the call; handler returns a Response or a JSON-able value. Every call
// is recorded with its parsed form body. Anything unrouted fails the test.
export function fakeFetch(routes = []) {
  const calls = [];
  const fetch = async (input, init = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? init.body : init.body instanceof URLSearchParams ? init.body.toString() : '';
    const call = { url, method, headers: new Headers(init.headers), body, form: new URLSearchParams(body) };
    calls.push(call);
    for (const [match, handler] of routes) {
      if (typeof match === 'string' ? url.startsWith(match) : match(call)) {
        const answer = await handler(call);
        return answer instanceof Response ? answer : Response.json(answer);
      }
    }
    throw new Error(`unexpected fetch ${method} ${url}`);
  };
  return { fetch, calls, routes };
}

export const turnstileRoute = (outcome = { success: true, action: 'commission' }) =>
  ['https://challenges.cloudflare.com/turnstile/v0/siteverify', () => outcome];

// The Stripe-Signature header for a body, as Stripe makes it.
export function signStripe(body, secret, t = Math.floor(Date.now() / 1000)) {
  const bytes = typeof body === 'string' ? Buffer.from(body, 'utf8') : Buffer.from(body);
  const signature = createHmac('sha256', secret).update(Buffer.concat([Buffer.from(`${t}.`), bytes])).digest('hex');
  return `t=${t},v1=${signature}`;
}

// An RS256 key pair standing in for an Access team's signing key.
export async function accessKeys(kid = 'kid-1') {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid, alg: 'RS256', use: 'sig' };
  return { kid, privateKey: pair.privateKey, jwk };
}

const base64url = (bytes) => Buffer.from(bytes).toString('base64url');

export async function accessToken(keys, { aud, iss, email = 'jonathan@example.com', exp = Math.floor(Date.now() / 1000) + 600, kid = keys.kid, alg = 'RS256', nbf } = {}) {
  const header = base64url(JSON.stringify({ alg, kid, typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ aud, iss, email, exp, iat: Math.floor(Date.now() / 1000), ...(nbf ? { nbf } : {}) }));
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${base64url(new Uint8Array(signature))}`;
}

// Audio files' first bytes, padded.
export const audio = {
  mp3: () => new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0, ...new Array(54).fill(7)]),
  m4a: () => new Uint8Array([0, 0, 0, 0x20, ...Buffer.from('ftypM4A '), 0, 0, 0, 0, ...new Array(48).fill(3)]),
  heic: () => new Uint8Array([0, 0, 0, 0x18, ...Buffer.from('ftypheic'), 0, 0, 0, 0, ...new Array(48).fill(3)]),
  png: () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(56).fill(1)])
};

export const SITE = 'https://songaday.studio';

// A commission env with every binding faked. Pass `email: true` for an email binding.
export async function commissionEnv(overrides = {}) {
  const { email = false, ...rest } = overrides;
  return {
    COMMISSIONS_DB: fakeD1(),
    COMMISSION_FILES: fakeR2(),
    COMMISSION_LIMIT: fakeRateLimit(true),
    ASSETS: await fakeAssets(),
    TURNSTILE_SITE_KEY: 'site-key',
    TURNSTILE_SECRET_KEY: 'turnstile-secret',
    COMMISSION_REQUESTS: 'open',
    SITE_ORIGIN: SITE,
    COMMISSION_FROM_EMAIL: 'songs@songaday.studio',
    COMMISSION_FROM_NAME: 'Jonathan Mann',
    COMMISSION_REPLY_TO: 'jonathan@songaday.studio',
    COMMISSION_NOTIFY_TO: 'notify@songaday.studio',
    ...(email ? { COMMISSION_EMAIL: fakeEmail() } : {}),
    ...rest
  };
}

// worker.fetch with a stubbed global fetch for the call.
export async function call(env, path, init = {}, stub, origin = SITE) {
  const realFetch = globalThis.fetch;
  if (stub) globalThis.fetch = stub.fetch ?? stub;
  try {
    return await worker.fetch(new Request(origin + path, init), env);
  } finally {
    globalThis.fetch = realFetch;
  }
}

// A form body with its Content-Length, as a browser sends it.
export async function form(fields, { json = false, method = 'POST', headers = {} } = {}) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) data.append(name, new File([value[0]], value[1], { type: value[2] ?? 'application/octet-stream' }));
    else data.append(name, value);
  }
  const encoded = new Response(data);
  const body = new Uint8Array(await encoded.arrayBuffer());
  return {
    method,
    body,
    headers: {
      'Content-Type': encoded.headers.get('Content-Type'),
      'Content-Length': String(body.length),
      ...(json ? { Accept: 'application/json' } : {}),
      ...headers
    }
  };
}

// A small urlencoded body with its Content-Length.
export function urlencoded(fields, headers = {}) {
  const body = new URLSearchParams(fields).toString();
  return { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': String(Buffer.byteLength(body)), ...headers } };
}

export const ANSWERS = {
  kind: 'personal',
  recipient: 'Siobhan, my sister',
  relationship: 'My sister',
  occasion: 'A 40th birthday',
  names: 'Siobhan (shi-VAWN), her dog Biscuit',
  story: 'She grew up in Galway, moved to Boston, and still sings Dolly Parton in the car with the windows down.',
  leave_out: 'Her ex.',
  may_publish: 'yes',
  name: 'Pat Doe',
  email: 'pat@example.com',
  'cf-turnstile-response': 'token'
};

// Makes a request through the real form. Returns { token, id }.
export async function makeRequest(env, answers = {}, extra = {}) {
  const stub = fakeFetch([turnstileRoute()]);
  const response = await call(env, '/commission', await form({ ...ANSWERS, ...answers }, { json: true }), stub);
  const result = await response.json();
  if (!result.ok) throw new Error(`request refused: ${result.error}`);
  const token = /\/commission\/s\/([0-9a-f]{32})/.exec(result.url)[1];
  const { id } = env.COMMISSIONS_DB.one('SELECT id FROM requests WHERE token = ?', token);
  return { token, id, ...extra };
}

// Delivers a request the way the admin does, on localhost (no Access).
export async function deliver(env, id, { title = 'Siobhan at Forty', lyrics = 'Line one\nLine two', file = audio.mp3(), email = 'yes', formId } = {}) {
  return call(env, `/commission/admin/${id}`, await form({
    action: 'deliver', form_id: formId ?? crypto.randomUUID().replaceAll('-', ''), title, lyrics,
    song: file ? [file, 'song.mp3', 'audio/mpeg'] : undefined, email_them: email || undefined
  }, { headers: { Origin: LOCAL } }), null, LOCAL);
}

export const LOCAL = 'http://localhost:8787';

// Marks an outbox's unsent rows as sent, as if a binding had sent them.
export const markSent = (db, at = new Date().toISOString()) => db.exec('UPDATE outbox SET sent_at = ? WHERE sent_at IS NULL', at);
