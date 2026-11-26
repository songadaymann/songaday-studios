import { renderFumblePage } from './fumble-page.mjs';
import { isHuman } from './turnstile.mjs';

// songaday.studio/fumble: anonymous bag-fumble stories. A visitor's story goes into the D1
// database bound as FUMBLE_DB, waiting. Nothing is public until Jonathan publishes it with
// `node fumble-approve.mjs`, which also has Codex paint a picture for it; the paintings live in
// the R2 bucket bound as FUMBLE_IMAGES. Posting needs a Turnstile check
// (TURNSTILE_SITE_KEY in wrangler.jsonc, TURNSTILE_SECRET_KEY as a Worker secret).

export const FUMBLE_DATABASE = 'songaday-fumble';
export const FUMBLE_BUCKET = 'songaday-fumble';
export const STORY_MIN = 20;
export const STORY_MAX = 1500;
const PAGE_SIZE = 30;
// While this many stories wait for review, new ones are turned away (a flood can't fill D1).
const WAITING_LIMIT = 300;
const MAX_BODY = 32 * 1024;
const IMAGE_PATH = /^\/fumble\/images\/([a-z0-9-]+\.(?:jpg|png))$/;

const PUBLISHED = `SELECT number, story, published_at, image_key, image_alt FROM fumbles
  WHERE status = 'published'`;

// Line breaks kept (paragraphs at most one blank line apart), other control characters dropped.
export function cleanStory(value) {
  return String(value ?? '').normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f​-‏‪-‮⁦-⁩]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Why a story can't be posted as written, or null when it can.
export function storyProblem(story) {
  if (story.length < STORY_MIN) return `Tell a little more (at least ${STORY_MIN} characters).`;
  if (story.length > STORY_MAX) return `Keep it under ${STORY_MAX.toLocaleString('en-US')} characters.`;
  if (/https?:\/\/|www\.|\b(?:t\.me|discord\.gg)\//i.test(story)) return 'Leave out links.';
  if (/0x[0-9a-f]{40}/i.test(story)) return 'Take out the wallet address or transaction hash. It would show who you are.';
  return null;
}

const newId = () => [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join('');

function page(request, url, options, status = 200) {
  const nonce = newId();
  const html = renderFumblePage({ origin: url.origin, siteKey: options.env?.TURNSTILE_SITE_KEY, nonce, ...options });
  return new Response(request.method === 'HEAD' ? null : html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Content-Security-Policy': [
        "default-src 'none'",
        "img-src 'self' data:",
        "style-src 'self' 'unsafe-inline'",
        `script-src 'nonce-${nonce}' https://challenges.cloudflare.com`,
        'frame-src https://challenges.cloudflare.com',
        "connect-src 'self'",
        "form-action 'self'",
        "base-uri 'none'",
        "frame-ancestors 'none'"
      ].join('; '),
      'Referrer-Policy': 'same-origin',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

async function collection(request, env, url) {
  if (!env.FUMBLE_DB) return page(request, url, { env, stories: [], closed: true }, 503);
  const before = Number(url.searchParams.get('before'));
  const { results } = await env.FUMBLE_DB.prepare(`${PUBLISHED} AND number < ? ORDER BY number DESC LIMIT ?`)
    .bind(Number.isInteger(before) && before > 0 ? before : 2 ** 31, PAGE_SIZE).all();
  return page(request, url, {
    env,
    stories: results,
    olderThan: results.length === PAGE_SIZE ? results.at(-1).number : null,
    sent: url.searchParams.has('sent')
  });
}

async function single(request, env, url, number) {
  const story = env.FUMBLE_DB &&
    await env.FUMBLE_DB.prepare(`${PUBLISHED} AND number = ?`).bind(number).first();
  if (!story) return page(request, url, { env, stories: [], missing: true }, 404);
  return page(request, url, { env, stories: [story], single: true });
}

async function submit(request, env, url) {
  const wantsJson = request.headers.get('Accept')?.includes('application/json');
  // Without JavaScript the form posts normally: success redirects, a problem re-shows the page.
  const reply = (status, error = null, draft = '') => {
    if (wantsJson) return Response.json(error ? { error } : { ok: true }, { status, headers: { 'Cache-Control': 'no-store' } });
    if (!error) return new Response(null, { status: 303, headers: { Location: '/fumble?sent#tell' } });
    return page(request, url, { env, stories: [], error, draft }, status);
  };

  if (!env.FUMBLE_DB || !env.TURNSTILE_SECRET_KEY) return reply(503, 'Posting is closed right now. Try again later.');
  if (Number(request.headers.get('Content-Length')) > MAX_BODY) return reply(413, 'That’s too long to post.');
  let form;
  try {
    form = await request.formData();
  } catch {
    return reply(400, 'That didn’t come through. Try again.');
  }
  const story = cleanStory(form.get('story'));
  // Bots fill in every field, including this one people can't see.
  if (form.get('website')) return reply(200);
  const problem = storyProblem(story);
  if (problem) return reply(400, problem, story);
  if (env.FUMBLE_LIMIT) {
    const { success } = await env.FUMBLE_LIMIT.limit({ key: request.headers.get('CF-Connecting-IP') ?? 'unknown' });
    if (!success) return reply(429, 'Too many at once. Try again in a minute.', story);
  }
  if (!(await isHuman(env, form.get('cf-turnstile-response'), 'fumble'))) {
    return reply(403, 'The human check didn’t go through. Try again.', story);
  }
  const waiting = await env.FUMBLE_DB.prepare("SELECT COUNT(*) AS count FROM fumbles WHERE status = 'pending'").first('count');
  if (waiting >= WAITING_LIMIT) return reply(503, 'Too many stories are waiting to be read. Try again in a few days.', story);
  await env.FUMBLE_DB.prepare('INSERT INTO fumbles (id, story, submitted_on) VALUES (?, ?, ?)')
    .bind(newId(), story, new Date().toISOString().slice(0, 10)).run();
  return reply(200);
}

async function painting(request, env, key) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  const object = env.FUMBLE_IMAGES &&
    await (request.method === 'HEAD' ? env.FUMBLE_IMAGES.head(key) : env.FUMBLE_IMAGES.get(key));
  if (!object) return new Response('Not found', { status: 404 });
  const headers = new Headers({
    'Content-Type': object.httpMetadata?.contentType || (key.endsWith('.png') ? 'image/png' : 'image/jpeg'),
    // Every painting gets a new key, so a key's bytes never change.
    'Cache-Control': 'public, max-age=31536000, immutable',
    ETag: object.httpEtag
  });
  if (request.headers.get('If-None-Match') === object.httpEtag) return new Response(null, { status: 304, headers });
  headers.set('Content-Length', String(object.size));
  return new Response(request.method === 'HEAD' ? null : object.body, { headers });
}

// Answers everything under /fumble, or returns null for other paths.
export async function handleFumble(request, env, url) {
  if (!/^\/fumble(?:\/|$)/i.test(url.pathname)) return null;
  const image = IMAGE_PATH.exec(url.pathname);
  if (image) return painting(request, env, image[1]);

  const rest = url.pathname.replace(/^\/fumble\/?/i, '').replace(/\/+$/, '');
  const method = request.method;
  if (rest === '' || rest === 'index.html') {
    if (method === 'POST') return submit(request, env, url);
    if (method === 'GET' || method === 'HEAD') return collection(request, env, url);
    return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD, POST' } });
  }
  if (/^[1-9]\d{0,8}$/.test(rest) && (method === 'GET' || method === 'HEAD')) {
    return single(request, env, url, Number(rest));
  }
  return page(request, url, { env, stories: [], missing: true }, 404);
}
