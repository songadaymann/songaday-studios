// songaday.studio/business/: a song for a company, brand, event, podcast or show. The page, its
// request form's endpoint (business.mjs, on inquiry.mjs), and the personal commission page it
// was split out of.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import worker from '../worker.mjs';
import { BUSINESS_BUDGETS, BUSINESS_LIMITS, BUSINESS_STORY_MIN, businessProblem, readBusiness } from '../business.mjs';
import { SITE, call, commissionEnv, fakeFetch, fakeRateLimit, form, turnstileRoute } from './fake-cloudflare.mjs';

const root = new URL('../', import.meta.url);
const read = (file) => readFile(new URL(file, root), 'utf8');

test('the build makes the business page: what it is, three videos, who it’s been for, and the form', async () => {
  const out = await mkdtemp(path.join(tmpdir(), 'songaday-studio-business-'));
  try {
    await promisify(execFile)(process.execPath, [fileURLToPath(new URL('build.mjs', root)), '--out', out], {
      env: { ...process.env, SONGADAY_OFFLINE: '1' }
    });
    const [page, home, troubadour, personal] = await Promise.all(['business/index.html', 'index.html', 'conference-troubadour/index.html', 'commission/index.html']
      .map((file) => readFile(path.join(out, file), 'utf8')));
    assert.match(page, /<title>A song for your business · Song A Day Studio<\/title>/);
    assert.match(page, /<meta property="og:url" content="https:\/\/songaday\.studio\/business\/">/);
    assert.match(page, /<h1>A song for your business<\/h1>/);
    assert.doesNotMatch(page, /\{\{/);

    // The examples: ENS and GoDaddy first, then 1Password and the ATP theme, as stills that
    // become players when pressed.
    assert.deepEqual([...page.matchAll(/<button class="film-play" type="button" data-film-id="([\w-]{11})"/g)].map((match) => match[1]),
      ['tYeOAECmHig', 'oBBk_dpOX7w', 'iCXItGrjqrw']);
    assert.deepEqual([...page.matchAll(/<h[23] class="film-title">([^<]+)<\/h[23]>/g)].map((match) => match[1]),
      ['ENS, for its partnership with GoDaddy', '1Password', 'Accidental Tech Podcast']);
    assert.doesNotMatch(page, /<iframe/);
    // Who it's been for: a square picture and a name each.
    const logos = page.match(/<ul class="business-logos"[^>]*>[\s\S]*?<\/ul>/)[0];
    assert.deepEqual([...logos.matchAll(/<li><img(?: class="business-mark[a-z -]*")? src="\/assets\/logos\/([a-z0-9-]+\.(?:jpg|png|svg))" alt=""[^>]*><span>([^<]+)<\/span><\/li>/g)].map((match) => [match[1], match[2]]),
      [['1password.png', '1Password'], ['ens.jpg', 'ENS'], ['accidental-tech-podcast.jpg', 'Accidental Tech Podcast'], ['sleep-with-me.png', 'Sleep With Me']]);

    // The form, on the page itself, with the server's own budget choices and limits.
    const request = page.match(/<form class="booking-form" action="\/business\/request" method="post" data-booking>[\s\S]*?<\/form>/)[0];
    const fields = [...request.matchAll(/<label class="booking-field(?: booking-wide)?">([^<]+)<input type="(?:text|email)" name="([a-z]+)" maxlength="(\d+)"([^>]*)><\/label>/g)];
    assert.deepEqual(fields.map((match) => [match[1], match[2], match[4].includes('required')]),
      [['Your name', 'name', true], ['Your email', 'email', true], ['Company or project', 'company', true], ['What’s the song for?', 'purpose', true], ['Is there a deadline?', 'deadline', false]]);
    for (const match of fields) assert.equal(Number(match[3]), BUSINESS_LIMITS[match[2]], match[2]);
    assert.deepEqual([...request.matchAll(/<input type="radio" name="budget" value="([^"]+)"/g)].map((match) => match[1]), BUSINESS_BUDGETS);
    const story = request.match(/<textarea name="story" minlength="(\d+)" maxlength="(\d+)" rows="8" required><\/textarea>/);
    assert.deepEqual([Number(story[1]), Number(story[2])], [BUSINESS_STORY_MIN, BUSINESS_LIMITS.story]);
    assert.match(request, /<input class="booking-trap" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">/);
    assert.match(request, /<a class="booking-quiet" href="mailto:[^?@\s]+@[^?@\s]+\?subject=A%20song%20for%20my%20business">Email me instead<\/a>/);
    assert.match(page, /<a class="booking-send" href="#request">Tell me about it<\/a>/);
    // Its script is the same form code the Book me dialog runs, started when someone begins.
    for (const html of [page, troubadour]) assert.match(html, /const \{ initBookingForm \} = \(\(\) => \{/);
    assert.match(page, /form\.addEventListener\("focusin", start, \{ once: true \}\);/);
    assert.doesNotMatch(page + troubadour, /BOOKING_FORM_HELPER/);
    assert.doesNotMatch(page.replace(/<script>[\s\S]*?<\/script>/g, ''), /challenges\.cloudflare\.com/);

    // The same menu as the home page, with Business marked inside Hire me.
    const nav = (html) => [...html.match(/<nav class="site-sections"[\s\S]*?<\/nav>/)[0].matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(nav(page), nav(home));
    assert.match(page, /<a href="\/commission">Personal<\/a>\s*<a href="\/business\/" aria-current="page">Business<\/a>/);
    assert.equal(page.match(/<header class="site-header">[\s\S]*?<\/header>/)[0].split('aria-current').length - 1, 1);

    // A purchase page: the menu keeps its Donate button, and nothing else says donate.
    const menuDonate = '<a class="nav-donate" href="/#donate" data-donate="header">Donate</a>';
    const markup = page.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<script[\s\S]*?<\/script>/g, '').replace(menuDonate, '');
    assert.doesNotMatch(markup, /nav-donate|#donate|tax.deductible|gifts|donat|patron/i);
    assert.match(page, /<p class="sponsor-line">Song commissions are purchases from Jonathan Mann\.<\/p>/);

    // The personal page it was split from no longer asks, and sends a business here.
    assert.match(personal, /<input type="hidden" name="kind" value="personal">/);
    assert.doesNotMatch(personal, /type="radio" name="kind"/);
    assert.equal(personal.split('<a href="/business/">a song for your business</a>').length - 1, 2);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('the business page and the shared form keep to three sizes of type and square shapes', async () => {
  for (const file of ['business.css', 'booking-form.css']) {
    const css = await read(file);
    const sizes = [...css.matchAll(/font-size: ([^;]+);/g)].map((match) => match[1]);
    assert.ok(sizes.length > 2, file);
    for (const size of sizes) assert.ok(['var(--type-body)', 'var(--type-display)', 'var(--type-meta)'].includes(size), `${file}: ${size}`);
    assert.doesNotMatch(css, /clamp\(|border-radius: (?!0;)|opacity|rgba\(|hsla\(/, file);
  }
});

test('the menu, the footer and the header other sites load send Personal and Business to their own pages', async () => {
  for (const file of ['profile.html', 'films.html', 'plugins/index.html', 'fumble-page.mjs']) {
    const source = await read(file);
    assert.match(source, /<a href="\/commission">Personal<\/a>\s*<a href="\/business\/">Business<\/a>/, file);
    assert.doesNotMatch(source, /\?kind=/, file);
  }
  const header = await read('bar/v1/header.js');
  assert.match(header, /\{ id: 'personal', label: 'Personal', path: '\/commission' \}/);
  assert.match(header, /\{ id: 'business', label: 'Business', path: '\/business\/' \}/);
  assert.ok((await read('build-production.mjs')).includes("cp('business/index.html', 'dist/business/index.html')"));
});

test('old addresses for business songs land on the page', async () => {
  const asset = async () => new Response('page', { headers: { 'Content-Type': 'text/html' } });
  const fetchPath = (pathname) => worker.fetch(new Request(`https://songaday.studio${pathname}`), { ASSETS: { fetch: asset }, GALLERY: { fetch: asset } });
  for (const [from, to] of Object.entries({
    '/commission?kind=business': '/business/',
    '/theme-songs': '/business/',
    '/themes': '/business/',
    '/Business': '/business/',
    '/business': '/business/'
  })) {
    const response = await fetchPath(from);
    assert.equal(response.status, 302, from);
    assert.equal(response.headers.get('Location'), to, from);
  }
});

// ---- The request form's endpoint (business.mjs) --------------------------------------------

const ANSWERS = { name: 'Dana Planner', email: 'Dana@Example.com', company: 'Widget Works <Inc>', purpose: 'A theme song for our podcast',
  deadline: 'Early spring', budget: BUSINESS_BUDGETS[1], story: 'We make widgets for people who love widgets.\nIt plays at the top of every episode.\n\nUpbeat & a little silly.' };
const human = () => fakeFetch([turnstileRoute({ success: true, action: 'business' })]);
const ask = async (env, answers = ANSWERS, { headers = { Origin: SITE }, stub = human() } = {}) =>
  call(env, '/business/request', await form({ ...answers, 'cf-turnstile-response': 'token' }, { json: true, headers }), stub);

test('a business request goes to Jonathan as one email he can answer by pressing Reply, and nothing is stored', async () => {
  const env = await commissionEnv({ email: true });
  assert.deepEqual(await (await call(env, '/business/request')).json(), { open: true, siteKey: 'site-key' });
  const response = await ask(env);
  assert.deepEqual([response.status, await response.json()], [200, { ok: true }]);
  assert.equal(env.COMMISSION_EMAIL.sent.length, 1);
  const [message] = env.COMMISSION_EMAIL.sent;
  assert.equal(message.to, 'notify@songaday.studio');
  assert.deepEqual(message.from, { email: 'songs@songaday.studio', name: 'Business song request' });
  assert.equal(message.replyTo, 'dana@example.com');
  assert.equal(message.subject, 'Business song: Widget Works <Inc>');
  for (const line of ['Dana Planner wants a song for Widget Works <Inc>.', 'Name: Dana Planner', 'Email: dana@example.com', 'Company or project: Widget Works <Inc>',
    'What it’s for: A theme song for our podcast', 'Deadline: Early spring', `Budget: ${BUSINESS_BUDGETS[1]}`,
    'Everything they told me:\nWe make widgets for people who love widgets.\nIt plays at the top of every episode.\n\nUpbeat & a little silly.']) {
    assert.ok(message.text.includes(line), line);
  }
  // A stranger's words: escaped, a paragraph each.
  assert.ok(message.html.includes('<td>Widget Works &lt;Inc&gt;</td>'));
  assert.ok(message.html.includes('<p><strong>Everything they told me</strong></p>\n<p>We make widgets for people who love widgets.<br>It plays at the top of every episode.</p>\n<p>Upbeat &amp; a little silly.</p>'));
  assert.doesNotMatch(message.html, /<Inc>/);
  // No row anywhere, and the rate limit counts these apart from commissions and bookings.
  assert.equal(env.COMMISSIONS_DB.one('SELECT COUNT(*) AS count FROM outbox').count, 0);
  assert.equal(env.COMMISSIONS_DB.one('SELECT COUNT(*) AS count FROM requests').count, 0);
  assert.match(env.COMMISSION_LIMIT.calls[0].key, /^business:/);

  // A deadline is optional.
  const { deadline, ...open } = ANSWERS;
  assert.equal((await ask(env, open)).status, 200);
  assert.ok(env.COMMISSION_EMAIL.sent[1].text.includes('Deadline: None given'));
});

test('a missing or made-up answer is refused before anything is sent', async () => {
  const cleaned = readBusiness(new Map(Object.entries({ ...ANSWERS, company: '  Widget\n  Works ' })));
  assert.equal(cleaned.company, 'Widget Works');
  assert.equal(businessProblem(cleaned), null);

  const env = await commissionEnv({ email: true });
  const cases = {
    'Add your name.': { name: ' ' },
    'That email doesn’t look right.': { email: 'dana at example.com' },
    'Add the company or project.': { company: '' },
    'Add what the song is for.': { purpose: '' },
    'Pick a budget.': { budget: '$1 to $2' },
    'Tell me a little more about it.': { story: 'A song.' },
    'One of those answers is too long.': { story: 'x'.repeat(BUSINESS_LIMITS.story + 1) }
  };
  for (const [error, change] of Object.entries(cases)) {
    const response = await ask(env, { ...ANSWERS, ...change }, { stub: fakeFetch([]) });
    assert.deepEqual([response.status, await response.json()], [400, { error }], error);
  }
  // The other form's budgets aren't this one's.
  assert.equal((await ask(env, { ...ANSWERS, budget: '$2,500 to $5,000' }, { stub: fakeFetch([]) })).status, 400);
  assert.equal(env.COMMISSION_EMAIL.sent.length, 0);
});

test('bots, floods, other sites and the wrong human check send nothing', async () => {
  const env = await commissionEnv({ email: true });
  const trapped = await ask(env, { ...ANSWERS, website: 'https://spam.example' }, { stub: fakeFetch([]) });
  assert.deepEqual([trapped.status, await trapped.json()], [200, { ok: true }]);
  assert.equal((await ask(env, ANSWERS, { headers: { Origin: 'https://elsewhere.example' }, stub: fakeFetch([]) })).status, 403);
  assert.equal((await ask({ ...env, COMMISSION_LIMIT: fakeRateLimit(false) }, ANSWERS, { stub: fakeFetch([]) })).status, 429);
  assert.equal((await ask(env, ANSWERS, { stub: fakeFetch([turnstileRoute({ success: false })]) })).status, 403);
  // A token earned on the Book me dialog isn't good here.
  assert.equal((await ask(env, ANSWERS, { stub: fakeFetch([turnstileRoute({ success: true, action: 'booking' })]) })).status, 403);
  // No way to send email: the page keeps its email link.
  const { COMMISSION_EMAIL, ...without } = env;
  assert.deepEqual(await (await call(without, '/business/request')).json(), { open: false, siteKey: null });
  assert.equal((await ask(without)).status, 503);
  assert.equal(env.COMMISSION_EMAIL.sent.length, 0);
  // And when sending fails, they're told.
  env.COMMISSION_EMAIL.fail = 'E_INTERNAL_SERVER_ERROR';
  const failed = await ask(env);
  assert.deepEqual([failed.status, await failed.json()], [502, { error: 'That didn’t go through. Email me instead.' }]);
});
