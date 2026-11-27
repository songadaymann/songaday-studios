// songaday.studio/conference-troubadour/: the page the menu's Hire me > Conference troubadour
// leads to, built from conference-troubadour.html with the films page's video cards.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import worker from '../worker.mjs';
import { BOOKING_LIMITS, BUDGETS, bookingProblem, readBooking } from '../troubadour.mjs';
import { SITE, call, commissionEnv, fakeFetch, fakeRateLimit, form, turnstileRoute } from './fake-cloudflare.mjs';

const root = new URL('../', import.meta.url);
const read = (file) => readFile(new URL(file, root), 'utf8');
const VIDEOS = ['HCdwY4B3Ln8', 'VXu5XcWOIWo', 'u2PMmoKwLwg', 'EHuVXLyaDXQ'];

test('the build makes the Conference Troubadour page: what it is, four videos, what people said, every year', async () => {
  const out = await mkdtemp(path.join(tmpdir(), 'songaday-studio-troubadour-'));
  try {
    await promisify(execFile)(process.execPath, [fileURLToPath(new URL('build.mjs', root)), '--out', out], {
      env: { ...process.env, SONGADAY_OFFLINE: '1' }
    });
    const [page, home] = await Promise.all(['conference-troubadour/index.html', 'index.html'].map((file) => readFile(path.join(out, file), 'utf8')));
    assert.match(page, /<title>The Conference Troubadour · Song A Day Studio<\/title>/);
    assert.match(page, /<meta property="og:url" content="https:\/\/songaday\.studio\/conference-troubadour\/">/);
    assert.match(page, /<h1>The Conference Troubadour<\/h1>/);
    assert.doesNotMatch(page, /\{\{/);

    // The videos are the films page's cards: a still that becomes the player when pressed, so
    // the page loads four pictures and no players. The films page's script does the swap.
    assert.deepEqual([...page.matchAll(/<button class="film-play" type="button" data-film-id="([\w-]{11})" aria-label="Play [^"]+">/g)].map((match) => match[1]), VIDEOS);
    assert.doesNotMatch(page, /<iframe/);
    assert.match(page, /<script>[\s\S]*event\.target\.closest\("\[data-film-id\]"\)[\s\S]*<\/script>/);
    assert.deepEqual([...page.matchAll(/<h3 class="film-title">([^<]+)<\/h3>/g)].map((match) => match[1]), ['Gartner', 'Barclays Bank', 'Novartis']);

    // How it works, what three people said, and the years.
    assert.equal(page.match(/<ol class="troubadour-steps">[\s\S]*?<\/ol>/)[0].split('<li>').length - 1, 4);
    assert.deepEqual([...page.matchAll(/<figcaption>([^<]+)<\/figcaption>/g)].map((match) => match[1]),
      ['Michael Willi, Head of Communications, Novartis', 'Katherine Dillon, CCO, Gartner For Marketers', 'Amy Ledoux, SVP of Meetings, ASAE']);
    assert.deepEqual([...page.matchAll(/<dt>([^<]+)<\/dt>/g)].map((match) => match[1]),
      ['2026', '2025', '2023', '2022', '2020–21', '2019', '2018', '2017', '2016', '2015', '2014', '2013', '2012', '2011']);
    // One of them asked not to be named, so no picture of logos goes beside the list.
    assert.match(page, /Watchmaker that wishes to be anonymous/);
    assert.doesNotMatch(page, /logos|Tudor/i);

    // Book me, at the top and at the end, is one email link underneath (build.mjs), for when
    // the form can't be used. With scripts it opens the dialog instead.
    const book = [...page.matchAll(/<p class="troubadour-book"><a href="([^"]+)">Book me<\/a><\/p>/g)].map((match) => match[1]);
    assert.equal(book.length, 2);
    assert.equal(new Set(book).size, 1);
    assert.match(book[0], /^mailto:[^?@\s]+@[^?@\s]+\?subject=The%20Conference%20Troubadour$/);

    // The dialog: who they are, the event, and a budget from the server's own list.
    const dialog = page.match(/<dialog class="booking" id="booking" aria-labelledby="booking-title">[\s\S]*?<\/dialog>/)[0];
    assert.match(dialog, /<form class="booking-form" action="\/conference-troubadour\/booking" method="post" data-booking>/);
    const fields = [...dialog.matchAll(/<label class="booking-field">([^<]+)<input type="(text|email)" name="([a-z]+)" maxlength="(\d+)"[^>]* required><\/label>/g)];
    assert.deepEqual(fields.map((match) => [match[1], match[3]]),
      [['Your name', 'name'], ['Your email', 'email'], ['Event name', 'event'], ['Date', 'date'], ['Location', 'location'], ['Number of people', 'people']]);
    // The fields allow what the server allows, and the date is words, not a date picker.
    for (const match of fields) assert.equal(Number(match[4]), BOOKING_LIMITS[match[3]], match[3]);
    assert.doesNotMatch(dialog, /type="date"/);
    assert.deepEqual([...dialog.matchAll(/<input type="radio" name="budget" value="([^"]+)"/g)].map((match) => match[1]), BUDGETS);
    // The amounts are the fee: travel and lodging are theirs to cover on top.
    assert.match(dialog, /<legend>Budget, plus travel and lodging<\/legend>/);
    // Last, a bigger box for whatever they want to say. It can be left empty.
    const story = dialog.match(/<label class="booking-field booking-story">Tell me the story<textarea name="story" maxlength="(\d+)" rows="4"><\/textarea><\/label>/);
    assert.equal(Number(story[1]), BOOKING_LIMITS.story);
    assert.ok(dialog.indexOf('</fieldset>') < story.index && story.index < dialog.indexOf('data-booking-check'));
    assert.match(dialog, /<input class="booking-trap" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">/);
    assert.equal(dialog.match(/<a class="booking-quiet" href="([^"]+)">Email me instead<\/a>/)[1], book[0]);
    // The page's script opens it, and loads the human check only then.
    assert.match(page, /<script>[\s\S]*dialog\.showModal\(\);[\s\S]*<\/script>/);
    assert.doesNotMatch(page.replace(/<script>[\s\S]*?<\/script>/g, ''), /challenges\.cloudflare\.com/);

    // The same menu as the home page, with this page marked inside Hire me.
    const nav = (html) => [...html.match(/<nav class="site-sections"[\s\S]*?<\/nav>/)[0].matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(nav(page), nav(home));
    assert.match(page, /<summary>Hire me<\/summary>[\s\S]*?<a href="\/conference-troubadour\/" aria-current="page">Conference troubadour<\/a>/);
    assert.equal(page.match(/<header class="site-header">[\s\S]*?<\/header>/)[0].split('aria-current').length - 1, 1);

    // A booking is a purchase from Jonathan, like a commission: the menu keeps its Donate
    // button, and nothing else on the page says donate.
    const menuDonate = '<a class="nav-donate" href="/#donate" data-donate="header">Donate</a>';
    assert.ok(page.match(/<header class="site-header">[\s\S]*?<\/header>/)[0].includes(menuDonate));
    const markup = page.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<script[\s\S]*?<\/script>/g, '').replace(menuDonate, '');
    assert.doesNotMatch(markup, /nav-donate|#donate|tax.deductible|gifts|donat|patron/i);
    assert.match(page, /<p class="sponsor-line">Conference bookings and song commissions are purchases from Jonathan Mann\.<\/p>/);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('the page keeps to three sizes of type and solid, square shapes', async () => {
  const css = await read('conference-troubadour.css');
  const sizes = [...css.matchAll(/font-size: ([^;]+);/g)].map((match) => match[1]);
  assert.ok(sizes.length > 3);
  assert.deepEqual([...new Set(sizes)].sort(), ['var(--type-body)', 'var(--type-display)', 'var(--type-meta)']);
  // Square corners everywhere; the only border-radius is the one that squares a phone's fields.
  assert.doesNotMatch(css, /clamp\(|border-radius: (?!0;)|opacity|rgba\(|hsla\(/);
});

test('every copy of the menu, and the header other sites load, lead to the page', async () => {
  for (const file of ['profile.html', 'films.html', 'plugins/index.html', 'fumble-page.mjs']) {
    assert.match(await read(file), /<a href="\/conference-troubadour\/">Conference troubadour<\/a>/, file);
  }
  assert.match(await read('bar/v1/header.js'), /\{ id: 'conference-troubadour', label: 'Conference troubadour', path: '\/conference-troubadour\/' \}/);
  assert.ok((await read('build-production.mjs')).includes("cp('conference-troubadour/index.html', 'dist/conference-troubadour/index.html')"));
});

test('short addresses, the old site’s among them, land on the page', async () => {
  const asset = async () => new Response('page', { headers: { 'Content-Type': 'text/html' } });
  const fetchPath = (pathname) => worker.fetch(new Request(`https://songaday.studio${pathname}`), { ASSETS: { fetch: asset }, GALLERY: { fetch: asset } });
  for (const [from, to] of Object.entries({
    '/troubadour': '/conference-troubadour/',
    '/conf': '/conference-troubadour/',
    '/conf-troubadour': '/conference-troubadour/',
    '/Troubadour/': '/conference-troubadour/',
    '/conference-troubadour': '/conference-troubadour/'
  })) {
    const response = await fetchPath(from);
    assert.equal(response.status, 302, from);
    assert.equal(response.headers.get('Location'), to, from);
  }
});

// ---- The booking form's endpoint (troubadour.mjs) -------------------------------------------

const ANSWERS = { name: 'Dana Planner', email: 'Dana@Example.com', event: 'Widget Summit <2027>', date: 'March 2027, three days', location: 'Chicago', people: 'about 400', budget: BUDGETS[1] };
const human = () => fakeFetch([turnstileRoute({ success: true, action: 'booking' })]);
const book = async (env, answers = ANSWERS, { headers = { Origin: SITE }, stub = human() } = {}) =>
  call(env, '/conference-troubadour/booking', await form({ ...answers, 'cf-turnstile-response': 'token' }, { json: true, headers }), stub);

test('the form says whether it can be used, and gives the human check its key only then', async () => {
  const env = await commissionEnv({ email: true });
  const open = await call(env, '/conference-troubadour/booking');
  assert.equal(open.status, 200);
  assert.equal(open.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await open.json(), { open: true, siteKey: 'site-key' });
  // No way to send email, nowhere to send it, or no human check: the page keeps its email link.
  for (const missing of ['COMMISSION_EMAIL', 'COMMISSION_FROM_EMAIL', 'COMMISSION_NOTIFY_TO', 'TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY']) {
    const { [missing]: gone, ...rest } = env;
    assert.deepEqual(await (await call(rest, '/conference-troubadour/booking')).json(), { open: false, siteKey: null }, missing);
    const refused = await book(rest);
    assert.equal(refused.status, 503, missing);
    assert.match((await refused.json()).error, /Email me instead/);
  }
  assert.equal((await call(env, '/conference-troubadour/booking', { method: 'DELETE' })).status, 405);
});

test('a booking goes to Jonathan as one email he can answer by pressing Reply, and nothing is stored', async () => {
  const env = await commissionEnv({ email: true });
  const response = await book(env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(env.COMMISSION_EMAIL.sent.length, 1);
  const [message] = env.COMMISSION_EMAIL.sent;
  assert.equal(message.to, 'notify@songaday.studio');
  assert.deepEqual(message.from, { email: 'songs@songaday.studio', name: 'Conference Troubadour booking' });
  assert.equal(message.replyTo, 'dana@example.com');
  assert.equal(message.subject, 'Conference Troubadour: Widget Summit <2027>');
  for (const line of ['Name: Dana Planner', 'Email: dana@example.com', 'Event: Widget Summit <2027>', 'Date: March 2027, three days',
    'Location: Chicago', 'People: about 400', `Budget: ${BUDGETS[1]}`]) assert.ok(message.text.includes(line), line);
  // The answers are a stranger's words: escaped in the HTML.
  assert.ok(message.html.includes('<td>Widget Summit &lt;2027&gt;</td>'));
  assert.doesNotMatch(message.html, /<2027>/);
  // No row anywhere: not a request, not a queued email.
  assert.equal(env.COMMISSIONS_DB.one('SELECT COUNT(*) AS count FROM outbox').count, 0);
  assert.equal(env.COMMISSIONS_DB.one('SELECT COUNT(*) AS count FROM requests').count, 0);
  // The rate limit counts bookings apart from commissions.
  assert.match(env.COMMISSION_LIMIT.calls[0].key, /^booking:/);
  // With no story, the email doesn't mention one.
  assert.doesNotMatch(message.text + message.html, /The story/);
});

test('the story they tell arrives with its paragraphs, after the answers', async () => {
  const env = await commissionEnv({ email: true });
  const story = '  We end with a toast to <Ada>.\r\nShe founded it.\n\n\n\nKeep it warm & funny.  ';
  assert.equal((await book(env, { ...ANSWERS, story })).status, 200);
  const [message] = env.COMMISSION_EMAIL.sent;
  assert.ok(message.text.includes(`Budget: ${BUDGETS[1]}\n\nThe story:\nWe end with a toast to <Ada>.\nShe founded it.\n\nKeep it warm & funny.\n\nReply to this email`));
  // A stranger's words: escaped, a paragraph each, line breaks kept.
  assert.ok(message.html.includes('<p><strong>The story</strong></p>\n<p>We end with a toast to &lt;Ada&gt;.<br>She founded it.</p>\n<p>Keep it warm &amp; funny.</p>'));
  // Room to say a lot, not to send a book.
  const long = await book(env, { ...ANSWERS, story: 'x'.repeat(BOOKING_LIMITS.story + 1) }, { stub: fakeFetch([]) });
  assert.deepEqual([long.status, await long.json()], [400, { error: 'One of those answers is too long.' }]);
  assert.equal((await book(env, { ...ANSWERS, story: 'x'.repeat(BOOKING_LIMITS.story) })).status, 200);
});

test('answers are cleaned to one line each, and a missing or made-up one is refused before anything is sent', async () => {
  const cleaned = readBooking(new Map(Object.entries({ ...ANSWERS, name: '  Dana\n  Planner ', email: ' DANA@Example.com ' })));
  assert.equal(cleaned.name, 'Dana Planner');
  assert.equal(cleaned.email, 'dana@example.com');
  assert.equal(bookingProblem(cleaned), null);

  const env = await commissionEnv({ email: true });
  const cases = {
    'Add your name.': { name: ' ' },
    'That email doesn’t look right.': { email: 'dana at example.com' },
    'Add the event’s name.': { event: '' },
    'Add the date, even a rough one.': { date: '' },
    'Add where it is.': { location: '' },
    'Add about how many people will be there.': { people: '' },
    'Pick a budget.': { budget: '$1 to $2' },
    'One of those answers is too long.': { event: 'x'.repeat(BOOKING_LIMITS.event + 1) }
  };
  for (const [error, change] of Object.entries(cases)) {
    // The human check is never asked about answers that will be refused.
    const never = fakeFetch([]);
    const response = await book(env, { ...ANSWERS, ...change }, { stub: never });
    assert.equal(response.status, 400, error);
    assert.deepEqual(await response.json(), { error });
  }
  // An address that would smuggle a second recipient into Reply-To is not an address.
  assert.equal((await book(env, { ...ANSWERS, email: 'a@example.com, b@example.com' })).status, 400);
  assert.equal(env.COMMISSION_EMAIL.sent.length, 0);
});

test('bots, floods, other sites and failed human checks send nothing', async () => {
  const env = await commissionEnv({ email: true });
  // A bot that fills in the field people can't see is told it worked.
  const trapped = await book(env, { ...ANSWERS, website: 'https://spam.example' }, { stub: fakeFetch([]) });
  assert.deepEqual([trapped.status, await trapped.json()], [200, { ok: true }]);
  // Another site's page can't post here.
  assert.equal((await book(env, ANSWERS, { headers: { Origin: 'https://elsewhere.example' }, stub: fakeFetch([]) })).status, 403);
  assert.equal((await book(env, ANSWERS, { headers: {}, stub: fakeFetch([]) })).status, 403);
  // Too many at once.
  const flooded = await book({ ...env, COMMISSION_LIMIT: fakeRateLimit(false) }, ANSWERS, { stub: fakeFetch([]) });
  assert.equal(flooded.status, 429);
  // Not a person, or a token meant for another form.
  assert.equal((await book(env, ANSWERS, { stub: fakeFetch([turnstileRoute({ success: false })]) })).status, 403);
  assert.equal((await book(env, ANSWERS, { stub: fakeFetch([turnstileRoute({ success: true, action: 'commission' })]) })).status, 403);
  // Too big to be this form.
  const huge = await book(env, { ...ANSWERS, event: 'x'.repeat(20_000) }, { stub: fakeFetch([]) });
  assert.equal(huge.status, 413);
  assert.equal(env.COMMISSION_EMAIL.sent.length, 0);
});

test('when the email can’t be sent, the person is told, and pointed at the email link', async () => {
  const env = await commissionEnv({ email: true });
  env.COMMISSION_EMAIL.fail = 'E_INTERNAL_SERVER_ERROR';
  const response = await book(env);
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: 'That didn’t go through. Email me instead.' });
  assert.equal(env.COMMISSION_EMAIL.sent.length, 0);
});
