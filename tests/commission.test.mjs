// songaday.studio/commission: the public page, making a request, and the buyer's private page.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { handleCommission, requestProblem, readAnswers } from '../commission.mjs';
import { TRANSITIONS, emailKey, sniffAudio, transitionProblem, visitorKey } from '../commission-core.mjs';
import {
  ANSWERS, LOCAL, audio, call, commissionEnv, deliver, fakeFetch, form, makeRequest, turnstileRoute, urlencoded
} from './fake-cloudflare.mjs';

const root = new URL('../', import.meta.url);
const TOKEN = /^\/commission\/s\/([0-9a-f]{32})\?new$/;

// What a reader sees and where its links go: <style>, <script> and every attribute but href
// are dropped first, since every page inlines profile.css, whose class names include
// nav-donate, gift-card and patronage-box.
export function visible(html) {
  return html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<([a-z0-9]+)\b[^>]*?(\shref="[^"]*")?[^>]*>/gi, (match, tag, href) => `<${tag}${href ?? ''}>`);
}
const FORBIDDEN = /donat|gift|tax.deductible|patron/i;

const navLinks = (html) => [...html.match(/<nav class="site-sections"[\s\S]*?<\/nav>/)[0].matchAll(/href="([^"]+)"/g)].map((match) => match[1]);

async function post(env, fields, { json = true, outcome } = {}) {
  const stub = fakeFetch([turnstileRoute(outcome)]);
  const response = await call(env, '/commission', await form({ ...ANSWERS, ...fields }, { json }), stub);
  return { response, stub, turnstile: stub.calls.filter((entry) => entry.url.includes('siteverify')) };
}

test('the page says how many songs are in line, and shows the form only when requests are open', async () => {
  const env = await commissionEnv();
  let html = await (await call(env, '/commission')).text();
  assert.match(html, /<strong class="commission-line">Nobody’s in line right now\.<\/strong>/);
  assert.match(html, /<form class="commission-form" id="request"/);
  assert.match(html, /data-sitekey="site-key" data-action="commission"/);
  assert.match(html, /For a person: pay what you can, from \$200\. Suggested: \$300, \$500, or \$1,000 \(or more\)\./);
  assert.match(html, /from \$1,500, pay what you can/);
  assert.match(html, /spread it over 3, 6 or 12 months/);
  assert.match(html, /A music video: tick the box on the form and I’ll be in touch about it\./);
  assert.doesNotMatch(html, /\{\{|commission-site-key/);
  // Theme songs are business songs; going public can come before the occasion; how long the line is.
  assert.match(html, /or a theme song for a podcast, show or channel: from \$1,500, pay what you can\./);
  assert.match(html, /value="personal" required> A person \(from \$200\)/);
  assert.match(html, /value="business"> A company, brand, event or organization, or a theme song for a podcast, show or channel \(from \$1,500\)/);
  assert.match(html, /If yes, it may go up the day I write it, which can be before your occasion\. If it’s a surprise, choose private \(it’s free\)\./);
  assert.match(html, /I accept every request\. I write them in the order they come in\. I can write about 10 a day\./);
  assert.match(html, /placeholder="Frodo" autocomplete/);
  assert.match(html, /For a business: what you do, who’ll hear it, and where it’ll play\./);
  assert.match(html, /data-error-callback="commissionError"/);
  assert.match(html, /<noscript><p class="commission-status">This form needs JavaScript/);
  assert.match(html, /The human check didn’t load\./);

  await makeRequest(env);
  await makeRequest(env, { email: 'two@example.com', story: 'A different story about a different person who is great.' });
  html = await (await call(env, '/commission/')).text();
  assert.match(html, /2 songs in line right now\./);

  // Before requests open, the page goes to the Bandcamp listings commissions were sold through,
  // so there's always a way to buy one; posting is refused.
  const before = await call({ ...env, COMMISSION_REQUESTS: 'closed' }, '/commission');
  assert.equal(before.status, 302);
  assert.equal(before.headers.get('Location'), 'https://jonathanmann.bandcamp.com/merch');
  const posted = await post({ ...env, COMMISSION_REQUESTS: 'closed' }, {});
  assert.equal(posted.response.status, 503);
  assert.match((await posted.response.json()).error, /Requests open soon/);
});

test('without the database or the Turnstile secret, the form is closed and posting is a 503', async () => {
  for (const missing of ['COMMISSIONS_DB', 'TURNSTILE_SECRET_KEY']) {
    const env = await commissionEnv();
    delete env[missing];
    const page = await call(env, '/commission');
    assert.equal(page.status, 200, missing);
    assert.match(await page.text(), /Requests are closed right now\. Try again later\./, missing);
    const { response, turnstile } = await post(env, {});
    assert.equal(response.status, 503, missing);
    assert.equal(turnstile.length, 0, missing);
  }
});

test('the page wears the studio header and footer, with no donate wording or Patreon anywhere', async () => {
  const env = await commissionEnv();
  const response = await call(env, '/commission');
  assert.equal(response.headers.get('Content-Security-Policy'), "frame-ancestors 'none'");
  const html = await response.text();
  const home = await readFile(new URL('profile.html', root), 'utf8');
  assert.deepEqual(navLinks(html), navLinks(home));
  assert.match(html, /<a href="\/commission" aria-current="page">Get a song<\/a>/);
  assert.doesNotMatch(html.replace(/<style[\s\S]*?<\/style>/g, ''), /class="nav-donate"|href="\/#donate"/);
  assert.match(html, /<p class="sponsor-line">Song commissions are purchases from Jonathan Mann\.<\/p>/);
  assert.doesNotMatch(visible(html), FORBIDDEN);
  assert.doesNotMatch(html, /patreon\.com/i);
  assert.doesNotMatch(html, /style question|What style/i);
});

test('a good request is saved cleaned, gets its place in line, and queues the received email', async () => {
  const env = await commissionEnv();
  const { response, turnstile } = await post(env, {
    recipient: '  Siobhan,\nmy sister ', email: ' PAT@Example.com ', story: `${ANSWERS.story}\r\n\r\n\r\n\r\nShe hates cilantro.‮`,
    deadline: '2027-01-15', video: 'yes', memo: [audio.m4a(), 'names.m4a', 'audio/x-m4a']
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(Object.keys(result).sort(), ['ok', 'url']);
  assert.equal(result.ok, true);
  const [, token] = TOKEN.exec(result.url);

  assert.equal(turnstile.length, 1);
  assert.equal(turnstile[0].form.get('secret'), 'turnstile-secret');
  assert.equal(turnstile[0].form.get('response'), 'token');

  const [row] = env.COMMISSIONS_DB.rows('requests');
  assert.equal(row.token, token);
  assert.equal(row.status, 'requested');
  assert.equal(row.recipient, 'Siobhan, my sister');
  assert.equal(row.buyer_email, 'pat@example.com');
  assert.equal(row.story, `${ANSWERS.story}\n\nShe hates cilantro.`);
  assert.equal(row.deadline, '2027-01-15');
  assert.equal(row.wants_video, 1);
  assert.equal(row.may_publish, 1);
  assert.equal(row.floor_cents, 20000);
  assert.match(row.memo_key, /^memos\/[0-9a-f]{32}\.m4a$/);
  assert.equal(env.COMMISSION_FILES.objects.get(row.memo_key).httpMetadata.contentType, 'audio/mp4');

  const [email] = env.COMMISSIONS_DB.rows('outbox');
  assert.equal(email.kind, 'received');
  assert.equal(email.position, 1);
  assert.equal(email.request_id, row.id);
  assert.equal(email.to_email, 'pat@example.com');
  assert.equal(email.subject, `Got it. You're #1 in line (request ${row.id})`);
  assert.match(email.text, /You're #1 in line\./);
  assert.ok(email.text.includes(`https://songaday.studio/commission/s/${token}`));
  assert.equal(email.sent_at, null, 'no email binding: it waits');

  const second = await post(env, { email: 'b@example.com', story: 'Someone else entirely, who loves birds and bad puns.' });
  const secondToken = TOKEN.exec((await second.response.json()).url)[1];
  assert.notEqual(secondToken, token);
  assert.equal(env.COMMISSIONS_DB.one("SELECT position FROM outbox WHERE kind = 'received' ORDER BY id DESC LIMIT 1").position, 2);

  const business = await post(env, { kind: 'business', email: 'c@example.com', story: 'Our podcast about bees needs a theme song with a hook.' });
  assert.equal(business.response.status, 200);
  assert.equal(env.COMMISSIONS_DB.one("SELECT floor_cents FROM requests WHERE kind = 'business'").floor_cents, 150000);
});

test('the human check must be for this form: a token for another action is refused', async () => {
  const env = await commissionEnv();
  const { response } = await post(env, {}, { outcome: { success: true, action: 'fumble' } });
  assert.equal(response.status, 403);
  assert.equal(env.COMMISSIONS_DB.rows('requests').length, 0);
});

test('without JavaScript, success goes to the buyer page, which says their place', async () => {
  const env = await commissionEnv();
  await makeRequest(env);
  const { response } = await post(env, { email: 'second@example.com', story: 'The second story, about a dog called Pickle.' }, { json: false });
  assert.equal(response.status, 303);
  const location = response.headers.get('Location');
  assert.match(location, TOKEN);
  const page = await call(env, location);
  const html = await page.text();
  assert.match(html, /<h1>You’re #2 in line\.<\/h1>/);
  assert.match(html, /Got it\. Bookmark this page: it’s your way back to your request\./);

  const problem = await post(env, { story: 'short' }, { json: false });
  assert.equal(problem.response.status, 400);
  const text = await problem.response.text();
  assert.match(text, /Tell me a little more about them/);
  assert.match(text, /Go back to fix it; your answers are still there\./);
});

test('requests with problems save nothing and never reach Turnstile', async () => {
  const cases = [
    [{ kind: '' }, /person or a business/],
    [{ recipient: ' ' }, /who the song is for/],
    [{ story: 'Too short.' }, /at least 20 characters/],
    [{ may_publish: undefined }, /Song A Day/],
    [{ name: '' }, /your name/],
    [{ email: '' }, /your email/],
    [{ email: 'a@b.com, c@d.com' }, /email address doesn’t look right/],
    [{ email: '"x"@y.com' }, /email address doesn’t look right/],
    [{ email: 'pat@example.com\nbcc: x@y.com' }, /email address doesn’t look right/],
    [{ email: 'pat‮@example.com' }, /email address doesn’t look right/],
    [{ email: 'pat\u0085@example.com' }, /email address doesn’t look right/],
    [{ email: 'påt@example.com' }, /email address doesn’t look right/],
    [{ email: 'pat@localhost' }, /email address doesn’t look right/],
    [{ email: `${'a'.repeat(250)}@b.com` }, /email address doesn’t look right/],
    [{ recipient: 'x'.repeat(201) }, /under 200 characters/],
    [{ story: 'x'.repeat(10001) }, /under 10,000 characters/],
    [{ names: 'x'.repeat(1001) }, /under 1,000 characters/],
    [{ leave_out: 'x'.repeat(2001) }, /under 2,000 characters/],
    [{ name: 'x'.repeat(101) }, /under 100 characters/],
    [{ deadline: '2020-01-01' }, /already passed/],
    [{ deadline: '2027-02-30' }, /as a date/],
    [{ deadline: '2099-01-01' }, /two years/],
    [{ memo: [audio.png(), 'names.m4a', 'audio/mp4'] }, /doesn’t look like an audio file/],
    [{ memo: [audio.heic(), 'IMG_0001.heic', 'audio/mp4'] }, /doesn’t look like an audio file/]
  ];
  for (const [fields, message] of cases) {
    const env = await commissionEnv();
    const { response, turnstile } = await post(env, fields);
    assert.equal(response.status, 400, JSON.stringify(fields).slice(0, 80));
    assert.match((await response.json()).error, message, JSON.stringify(fields).slice(0, 80));
    assert.equal(env.COMMISSIONS_DB.rows('requests').length, 0);
    assert.equal(env.COMMISSION_FILES.objects.size, 0);
    assert.equal(turnstile.length, 0, 'Turnstile is not asked about a request that will be refused');
  }
});

test('a body with no length is a 411, and a memo over 10 MB is a 413', async () => {
  const env = await commissionEnv();
  const stub = fakeFetch([turnstileRoute()]);
  const init = await form(ANSWERS, { json: true });
  delete init.headers['Content-Length'];
  let response = await call(env, '/commission', init, stub);
  assert.equal(response.status, 411);

  const big = new Uint8Array(10 * 1024 * 1024 + 1);
  big.set(audio.mp3());
  response = await call(env, '/commission', await form({ ...ANSWERS, memo: [big, 'big.mp3', 'audio/mpeg'] }, { json: true }), stub);
  assert.equal(response.status, 413);
  assert.match((await response.json()).error, /10 MB/);
  // Over the whole form's limit, refused before it's read.
  const huge = await form({ ...ANSWERS, memo: [new Uint8Array(11 * 1024 * 1024), 'huge.mp3'] }, { json: true });
  response = await call(env, '/commission', huge, stub);
  assert.equal(response.status, 413);
  assert.equal(env.COMMISSIONS_DB.rows('requests').length, 0);
  assert.equal(stub.calls.length, 0);
});

test('a failed human check, the rate limit and the honeypot keep requests out', async () => {
  const failed = await commissionEnv();
  let result = await post(failed, {}, { outcome: { success: false } });
  assert.equal(result.response.status, 403);
  assert.equal(failed.COMMISSIONS_DB.rows('requests').length, 0);

  const limited = await commissionEnv();
  limited.COMMISSION_LIMIT.limit = async () => ({ success: false });
  result = await post(limited, {});
  assert.equal(result.response.status, 429);
  assert.equal(result.turnstile.length, 0);
  assert.equal(limited.COMMISSIONS_DB.rows('requests').length, 0);

  const bot = await commissionEnv();
  result = await post(bot, { website: 'http://spam.example' });
  assert.equal(result.response.status, 200);
  assert.equal(bot.COMMISSIONS_DB.rows('requests').length, 0);
  assert.equal(result.turnstile.length, 0);
});

test('one email can have five songs waiting, +tags included; paid and cancelled ones don’t count', async () => {
  const env = await commissionEnv();
  for (let i = 0; i < 5; i++) await makeRequest(env, { email: `pat+${i}@example.com`, story: `Story number ${i} about my friend who likes trains.` });
  let { response } = await post(env, { email: 'PAT@example.com', story: 'The sixth story, which is one too many for now.' });
  assert.equal(response.status, 429);
  assert.match((await response.json()).error, /5 songs waiting with me already\. Reply to one of my emails, or write to jonathan@songaday\.studio, if you need another\./);

  env.COMMISSIONS_DB.exec("UPDATE requests SET status = 'cancelled', cancelled_at = '2026-10-23T00:00:00Z' WHERE id = 1");
  env.COMMISSIONS_DB.exec("UPDATE requests SET status = 'delivered', paid_at = '2026-10-23T00:00:00Z' WHERE id = 2");
  ({ response } = await post(env, { email: 'PAT@example.com', story: 'The sixth story, which is fine now.' }));
  assert.equal(response.status, 200);
});

test('a double submit within ten minutes is one request, and the second doesn’t hand out its link', async () => {
  const env = await commissionEnv();
  const first = await (await post(env, {})).response.json();
  const second = await post(env, { email: 'PAT@EXAMPLE.COM', 'cf-turnstile-response': undefined });
  const { url } = await second.response.json();
  assert.equal(url, '/commission?sent#request');
  assert.notEqual(url, first.url);
  assert.equal(second.turnstile.length, 0, 'the second click’s Turnstile token would already be spent');
  assert.equal(env.COMMISSIONS_DB.rows('requests').length, 1);
  assert.match(await (await call(env, '/commission?sent')).text(), /Got it\. I’ve emailed you the link to your page\./);
  assert.doesNotMatch(await (await call(env, '/commission')).text(), /I’ve emailed you the link/);
  env.COMMISSIONS_DB.exec("UPDATE requests SET requested_at = '2026-01-01T00:00:00Z'");
  await post(env, {});
  assert.equal(env.COMMISSIONS_DB.rows('requests').length, 2);
});

test('the buyer page is private, escaped, and its place moves when earlier songs are done', async () => {
  const env = await commissionEnv();
  const first = await makeRequest(env);
  const mine = await makeRequest(env, { email: 'me@example.com', story: 'She said <script>alert("x")</script> & laughed at her own joke.' });

  const missing = await call(env, `/commission/s/${'0'.repeat(32)}`);
  assert.equal(missing.status, 404);
  assert.match(await missing.text(), /That page isn’t here/);

  const response = await call(env, `/commission/s/${mine.token}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, nofollow');
  assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(response.headers.get('Content-Security-Policy'), "frame-ancestors 'none'");
  const html = await response.text();
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.match(html, /<title>Your song · Song A Day Studio<\/title>/);
  assert.match(html, /You’re #2 in line\./);
  assert.match(html, /She said &lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt; &amp; laughed/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.doesNotMatch(visible(html), FORBIDDEN);

  await deliver(env, first.id);
  assert.match(await (await call(env, `/commission/s/${mine.token}`)).text(), /<h1>You’re next\.<\/h1>/);
});

test('a return from Stripe with anything but a Checkout Session id makes no Stripe call', async () => {
  const env = await commissionEnv({ STRIPE_SECRET_KEY: 'rk_test_x' });
  const { token, id } = await makeRequest(env);
  await deliver(env, id);
  for (const bad of ['../../customers', 'cs_test_abc/../../x', 'pi_123', '']) {
    const stub = fakeFetch([]);
    const response = await call(env, `/commission/s/${token}?session_id=${encodeURIComponent(bad)}`, {}, stub);
    assert.equal(response.status, 303, bad);
    assert.equal(response.headers.get('Location'), `/commission/s/${token}#pay`);
    assert.equal(stub.calls.length, 0, bad);
  }
});

test('the buyer can cancel while in line, but not once writing has started', async () => {
  const env = await commissionEnv();
  const { token, id } = await makeRequest(env);
  const response = await call(env, `/commission/s/${token}`, urlencoded({ action: 'cancel' }));
  assert.equal(response.status, 303);
  const row = env.COMMISSIONS_DB.one('SELECT status, cancelled_by FROM requests WHERE id = ?', id);
  assert.deepEqual(row, { status: 'cancelled', cancelled_by: 'buyer' });
  const email = env.COMMISSIONS_DB.one("SELECT * FROM outbox WHERE kind = 'cancelled'");
  assert.match(email.text, /You cancelled your request for a song for Siobhan, my sister\. If that was a mistake, just reply/);
  assert.match(await (await call(env, `/commission/s/${token}`)).text(), /This request was cancelled\./);
  // Again does nothing more.
  await call(env, `/commission/s/${token}`, urlencoded({ action: 'cancel' }));
  assert.equal(env.COMMISSIONS_DB.rows('outbox', "kind = 'cancelled'").length, 1);

  const writing = await makeRequest(env, { email: 'w@example.com' });
  env.COMMISSIONS_DB.exec("UPDATE requests SET status = 'writing' WHERE id = ?", writing.id);
  const refused = await call(env, `/commission/s/${writing.token}`, urlencoded({ action: 'cancel' }));
  assert.equal(refused.status, 409);
  assert.match(await refused.text(), /I’ve already started writing your song\. Email me instead\./);
  assert.equal(env.COMMISSIONS_DB.one('SELECT status FROM requests WHERE id = ?', writing.id).status, 'writing');
});

test('place-in-line emails turn off from the page or with one click from the email', async () => {
  const env = await commissionEnv();
  const ahead = await makeRequest(env, { email: 'ahead@example.com' });
  // #1 has nowhere to move, so its page doesn't offer them.
  assert.doesNotMatch(await (await call(env, `/commission/s/${ahead.token}`)).text(), /Place-in-line emails/);
  const { token, id } = await makeRequest(env);
  assert.match(await (await call(env, `/commission/s/${token}`)).text(), /<h1>You’re #2 in line\.<\/h1>[\s\S]*Place-in-line emails[\s\S]*class="commission-quiet">Turn them off/);
  let response = await call(env, `/commission/s/${token}`, urlencoded({ action: 'updates', value: 'off' }));
  assert.equal(response.headers.get('Location'), `/commission/s/${token}#updates`);
  assert.equal(env.COMMISSIONS_DB.one('SELECT quiet FROM requests WHERE id = ?', id).quiet, 1);
  assert.match(await (await call(env, `/commission/s/${token}`)).text(), /They’re off\./);
  await call(env, `/commission/s/${token}`, urlencoded({ action: 'updates', value: 'on' }));
  assert.equal(env.COMMISSIONS_DB.one('SELECT quiet FROM requests WHERE id = ?', id).quiet, 0);

  response = await call(env, `/commission/s/${token}/quiet`, urlencoded({ 'List-Unsubscribe': 'One-Click' }));
  assert.equal(response.status, 200);
  assert.match(await response.text(), /No more place-in-line emails/);
  assert.equal(env.COMMISSIONS_DB.one('SELECT quiet FROM requests WHERE id = ?', id).quiet, 1);
  response = await call(env, `/commission/s/${token}/quiet`);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('Location'), `/commission/s/${token}#updates`);
});

test('the song streams once delivered, and downloads only once paid', async () => {
  const env = await commissionEnv();
  const { token, id } = await makeRequest(env);
  for (const sub of ['listen', 'download']) assert.equal((await call(env, `/commission/s/${token}/${sub}`)).status, 404, sub);

  await deliver(env, id);
  const listen = await call(env, `/commission/s/${token}/listen`, { headers: { Range: 'bytes=0-9' } });
  assert.equal(listen.status, 206);
  assert.equal(listen.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(listen.headers.get('Content-Security-Policy'), 'sandbox');
  assert.equal(listen.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(listen.headers.get('Content-Type'), 'audio/mpeg');
  assert.equal((await listen.arrayBuffer()).byteLength, 10);
  const locked = await call(env, `/commission/s/${token}/download`);
  assert.equal(locked.status, 303);
  assert.equal(locked.headers.get('Location'), `/commission/s/${token}#pay`);
  const html = await (await call(env, `/commission/s/${token}`)).text();
  assert.match(html, /<h1>“Siobhan at Forty”<\/h1>/);
  assert.match(html, new RegExp(`<audio class="commission-player" controls controlslist="nodownload" preload="metadata" src="/commission/s/${token}/listen">`));
  assert.match(html, /<p>Line one<br>Line two<\/p>/);
  assert.match(html, /Payments aren’t set up yet\./);
  assert.doesNotMatch(html, /Download the song/);
  assert.doesNotMatch(visible(html), FORBIDDEN);

  env.COMMISSIONS_DB.exec("UPDATE requests SET paid_at = '2026-10-23T15:00:00Z' WHERE id = ?", id);
  const download = await call(env, `/commission/s/${token}/download`);
  assert.equal(download.status, 200);
  assert.equal(download.headers.get('Content-Disposition'),
    "attachment; filename=\"Siobhan at Forty - Jonathan Mann.mp3\"; filename*=UTF-8''Siobhan%20at%20Forty%20-%20Jonathan%20Mann.mp3");
  const head = await call(env, `/commission/s/${token}/download`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.body, null);
  assert.equal(head.headers.get('Content-Length'), '64');
  assert.match(await (await call(env, `/commission/s/${token}`)).text(), /Download the song/);

  env.COMMISSIONS_DB.exec("UPDATE requests SET status = 'cancelled' WHERE id = ?", id);
  for (const sub of ['listen', 'download']) assert.equal((await call(env, `/commission/s/${token}/${sub}`)).status, 404, sub);
});

test('other spellings land on the page, /commissions is an alias, and unknown paths are a 404', async () => {
  const env = await commissionEnv();
  for (const path of ['/Commission', '/COMMISSION/', '/commission//']) {
    const response = await call(env, path + '?from=x');
    assert.equal(response.status, 302, path);
    assert.equal(response.headers.get('Location'), '/commission?from=x', path);
  }
  for (const path of ['/commissions', '/commissions/', '/Commissions']) {
    const response = await call(env, path);
    assert.equal(response.status, 302, path);
    assert.equal(response.headers.get('Location'), '/commission', path);
  }
  for (const path of ['/commission/song', '/commission/song.html', '/commission/index.html', '/commission/s/abc', '/commission/nope']) {
    assert.equal((await call(env, path)).status, 404, path);
  }
  assert.equal(await handleCommission(new Request('https://songaday.studio/commissioned'), env, new URL('https://songaday.studio/commissioned')), null);
  assert.equal((await call(env, '/commission', { method: 'PUT' })).status, 405);
  assert.equal((await call(env, '/commission/stripe')).status, 405);
});

test('without a build, the pages fall back to bare documents and still work', async () => {
  const env = await commissionEnv({ ASSETS: { fetch: async () => new Response('png', { headers: { 'Content-Type': 'image/png' } }) } });
  const page = await call(env, '/commission');
  assert.equal(page.status, 200);
  // Their CSP is a header, since there's no built page to carry the meta tag.
  const bare = "default-src 'none'; style-src 'unsafe-inline'; media-src 'self'; form-action 'self' https://checkout.stripe.com; base-uri 'none'; frame-ancestors 'none'";
  assert.equal(page.headers.get('Content-Security-Policy'), bare);
  assert.match(await page.text(), /Nobody’s in line right now\./);
  const { token } = await makeRequest(env);
  const buyer = await call(env, `/commission/s/${token}`);
  assert.equal(buyer.headers.get('Content-Security-Policy'), bare);
  assert.equal(buyer.headers.get('Cache-Control'), 'no-store');
  assert.match(await buyer.text(), /<h1>You’re next\.<\/h1>/);
});

test('audio is recognized by its first bytes', () => {
  assert.deepEqual(sniffAudio(audio.mp3()), { ext: 'mp3', type: 'audio/mpeg' });
  assert.deepEqual(sniffAudio(new Uint8Array([0xff, 0xfb, 0x90, 0x64, 0, 0, 0, 0, 0, 0, 0, 0])), { ext: 'mp3', type: 'audio/mpeg' });
  assert.deepEqual(sniffAudio(audio.m4a()), { ext: 'm4a', type: 'audio/mp4' });
  assert.deepEqual(sniffAudio(new Uint8Array([...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WAVE')])), { ext: 'wav', type: 'audio/wav' });
  assert.deepEqual(sniffAudio(new Uint8Array([...Buffer.from('OggS'), 0, 2, 0, 0, 0, 0, 0, 0])), { ext: 'ogg', type: 'audio/ogg' });
  assert.deepEqual(sniffAudio(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0])), { ext: 'webm', type: 'audio/webm' });
  for (const brand of ['heic', 'mif1', 'avif']) {
    assert.equal(sniffAudio(new Uint8Array([0, 0, 0, 0x18, ...Buffer.from('ftyp' + brand), 0, 0, 0, 0])), null, brand);
  }
  assert.equal(sniffAudio(audio.png()), null);
  assert.equal(sniffAudio(new Uint8Array([0x49, 0x44])), null);
});

test('every move a request can and can’t make', () => {
  const at = '2026-10-23T00:00:00Z';
  const states = {
    held: { status: 'held' },
    requested: { status: 'requested' },
    writing: { status: 'writing' },
    delivered: { status: 'delivered', delivered_at: at },
    'delivered, paid': { status: 'delivered', delivered_at: at, paid_at: at },
    'delivered, archived': { status: 'delivered', delivered_at: at, archived_at: at },
    cancelled: { status: 'cancelled', cancelled_at: at },
    'cancelled after delivery': { status: 'cancelled', cancelled_at: at, delivered_at: at },
    'cancelled, archived': { status: 'cancelled', cancelled_at: at, archived_at: at }
  };
  const allowed = {
    'let-in': ['held'],
    writing: ['requested'],
    deliver: ['requested', 'writing', 'delivered', 'delivered, paid', 'delivered, archived'],
    undeliver: ['delivered', 'delivered, archived'],
    'buyer-cancel': ['held', 'requested'],
    cancel: ['held', 'requested', 'writing', 'delivered', 'delivered, archived'],
    restore: ['cancelled', 'cancelled, archived'],
    archive: ['delivered', 'delivered, paid', 'cancelled', 'cancelled after delivery'],
    unarchive: ['delivered, archived', 'cancelled, archived'],
    paid: ['delivered', 'delivered, paid', 'delivered, archived'],
    edit: Object.keys(states),
    delete: Object.keys(states)
  };
  assert.deepEqual(Object.keys(allowed).sort(), Object.keys(TRANSITIONS).sort());
  for (const [action, yes] of Object.entries(allowed)) {
    for (const [name, request] of Object.entries(states)) {
      const problem = transitionProblem(request, action);
      assert.equal(problem === null, yes.includes(name), `${action} from ${name}: ${problem}`);
    }
  }
  assert.equal(transitionProblem(states.delivered, 'writing'), 'That request is already delivered.');
  assert.equal(transitionProblem(states['delivered, paid'], 'cancel'), 'That song is paid for. Refunds happen in Stripe.');
  assert.match(transitionProblem(states['cancelled after delivery'], 'restore'), /can’t go back in line/);
  for (const action of Object.keys(TRANSITIONS)) {
    assert.equal(transitionProblem({ ...states.cancelled, deleted_at: at }, action), 'That request was deleted.', action);
  }
});

test('answers are read and checked the same way the form describes', () => {
  const data = new FormData();
  for (const [name, value] of Object.entries({ ...ANSWERS, deadline: '2026-10-23' })) data.append(name, value);
  const answers = readAnswers(data);
  assert.equal(requestProblem(answers, new Date('2026-10-23T03:00:00Z')), null, 'still Oct 22 in New York, so Oct 23 is ahead');
  assert.equal(requestProblem(answers, new Date('2026-10-24T05:00:00Z')), 'That deadline has already passed.');
  assert.equal(requestProblem({ ...answers, deadline: '2028-10-22' }, new Date('2026-10-23T12:00:00Z')), null);
  assert.match(requestProblem({ ...answers, deadline: '2028-10-26' }, new Date('2026-10-23T12:00:00Z')), /two years/);
});

test('the admin and buyer links are not reachable through the local admin by accident', async () => {
  // On localhost without Access the admin answers; the same path on the real host doesn't.
  const env = await commissionEnv();
  assert.equal((await call(env, '/commission/admin', {}, null, LOCAL)).status, 200);
  assert.equal((await call(env, '/commission/admin')).status, 403);
});

test('rate limits count an IPv6 visitor by its /64, and the cap counts pat+x@ as pat@', async () => {
  assert.equal(visitorKey('203.0.113.9'), '203.0.113.9');
  assert.equal(visitorKey('2001:db8:aa:bb:1:2:3:4'), '2001:db8:aa:bb::/64');
  assert.equal(visitorKey('2001:DB8:AA:BB::9'), '2001:db8:aa:bb::/64');
  assert.equal(visitorKey('2001:db8::1'), '2001:db8:0:0::/64');
  assert.equal(visitorKey('::ffff:203.0.113.9'), '203.0.113.9');
  assert.equal(visitorKey(null), 'unknown');
  const env = await commissionEnv();
  await call(env, '/commission', await form({ ...ANSWERS, email: 'two@example.com', story: 'Another one, from a phone on the same network.' }, { json: true, headers: { 'CF-Connecting-IP': '2001:db8:aa:bb:ffff::1' } }), fakeFetch([turnstileRoute()]));
  assert.equal(env.COMMISSION_LIMIT.calls.at(-1).key, '2001:db8:aa:bb::/64');
  assert.equal(emailKey('pat+birthday@example.com'), 'pat@example.com');
  assert.equal(emailKey('pat@example.com'), 'pat@example.com');
});

test('past the day’s alarm, new requests are held out of line, Jonathan hears once, and he can let them in', async () => {
  const env = await commissionEnv();
  const db = env.COMMISSIONS_DB;
  const recent = new Date(Date.now() - 3_600_000).toISOString();
  for (let i = 0; i < 30; i++) {
    db.exec(`INSERT INTO requests (token, share_token, status, kind, floor_cents, buyer_name, buyer_email, email_key, recipient, story, may_publish, requested_at)
      VALUES (?, ?, 'cancelled', 'personal', 20000, 'X', ?, ?, 'Y', 'A story long enough to count.', 1, ?)`,
    `a${String(i).padStart(31, '0')}`, `b${String(i).padStart(31, '0')}`, `x${i}@example.com`, `x${i}@example.com`, recent);
  }
  const first = await makeRequest(env, { recipient: 'Your invoice is overdue, call 555-0100', name: 'Billing Dept' });
  await makeRequest(env, { email: 'second@example.com', story: 'A second one during the flood.' });
  assert.equal(db.rows('requests', "status = 'held'").length, 2);
  const html = await (await call(env, `/commission/s/${first.token}`)).text();
  assert.match(html, /<h1>Got it\.<\/h1>/);
  assert.match(html, /reading each new one before it goes in line/);
  assert.match(html, /Cancel my request/);
  assert.match(await (await call(env, '/commission')).text(), /Nobody’s in line right now\./, 'held isn’t in line');

  const [held] = db.rows('outbox', `kind = 'held' AND request_id = ${first.id}`);
  assert.equal(held.subject, `Got your song request (request ${first.id})`);
  assert.doesNotMatch(held.text + held.html, /invoice|555-0100|Billing/);
  assert.match(held.text, /^Hi,\n/);
  const alarms = db.rows('outbox', "kind = 'alarm'");
  assert.equal(alarms.length, 1, 'once a day');
  assert.equal(alarms[0].to_email, 'notify@songaday.studio');
  assert.equal(alarms[0].subject, 'Commissions: 31 requests in 24 hours, so new ones are held');
  assert.equal(db.rows('outbox', "kind = 'received'").length, 0);

  const admin = await (await call(env, '/commission/admin?show=held', {}, null, LOCAL)).text();
  assert.match(admin, /class="alert">Held 2<\/a>/);
  assert.match(admin, /Let the oldest 50 in/);
  const letIn = await call(env, `/commission/admin/${first.id}`, urlencoded({ action: 'let-in' }, { Origin: LOCAL }), null, LOCAL);
  assert.equal(letIn.status, 303);
  assert.equal(db.one('SELECT status FROM requests WHERE id = ?', first.id).status, 'requested');
  const [received] = db.rows('outbox', `kind = 'received' AND request_id = ${first.id}`);
  assert.equal(received.position, 1);
  assert.match(await (await call(env, `/commission/s/${first.token}`)).text(), /<h1>You’re next\.<\/h1>/);

  const cancelAll = await call(env, '/commission/admin/held', urlencoded({ action: 'cancel-all', confirm: 'yes' }, { Origin: LOCAL }), null, LOCAL);
  assert.equal(cancelAll.status, 303);
  assert.equal(db.rows('requests', "status = 'held'").length, 0);
  assert.equal(db.rows('outbox', "kind = 'cancelled'").length, 0, 'no email to strangers');
  assert.doesNotMatch(await (await call(env, '/commission/admin', {}, null, LOCAL)).text(), />Held \d/, 'the tab goes when nothing is held');
});

test('the share link plays the song and shows the lyrics, and nothing the buyer told me', async () => {
  const env = await commissionEnv({ STRIPE_SECRET_KEY: 'rk_test_x' });
  const { id, token } = await makeRequest(env, { story: 'A private story about her surgery and the long recovery.' });
  const { share_token: share } = env.COMMISSIONS_DB.one('SELECT share_token FROM requests WHERE id = ?', id);
  assert.match(share, /^[0-9a-f]{32}$/);
  assert.notEqual(share, token);
  assert.equal((await call(env, `/commission/share/${share}`)).status, 404, 'not delivered yet');

  await deliver(env, id);
  const email = env.COMMISSIONS_DB.one("SELECT text FROM outbox WHERE kind = 'delivered'").text;
  assert.ok(email.includes(`https://songaday.studio/commission/share/${share}`));
  assert.ok(email.includes(`https://songaday.studio/commission/s/${token}`));
  assert.match(email, /Keep that link to yourself/);

  const response = await call(env, `/commission/share/${share}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, nofollow');
  const html = (await response.text()).match(/<main[\s\S]*<\/main>/)[0];
  assert.match(html, /<h1>“Siobhan at Forty”<\/h1>/);
  assert.match(html, /<p>Line one<br>Line two<\/p>/);
  assert.match(html, new RegExp(`src="/commission/share/${share}/listen"`));
  assert.doesNotMatch(html, /surgery|Siobhan, my sister|pat@example\.com|Pat Doe|\$200|Pay |<form|Download the song/);
  assert.equal((await call(env, `/commission/share/${share}/listen`, { headers: { Range: 'bytes=0-9' } })).status, 206);
  const locked = await call(env, `/commission/share/${share}/download`);
  assert.equal(locked.status, 303);
  assert.equal(locked.headers.get('Location'), `/commission/share/${share}`);
  assert.equal((await call(env, `/commission/share/${share}`, urlencoded({ action: 'cancel' }))).status, 405);

  env.COMMISSIONS_DB.exec("UPDATE requests SET paid_at = '2026-10-23T15:00:00Z' WHERE id = ?", id);
  assert.match(await (await call(env, `/commission/share/${share}`)).text(), /Download the song/);
  assert.equal((await call(env, `/commission/share/${share}/download`)).status, 200);
  assert.equal((await call(env, `/commission/share/${'0'.repeat(32)}`)).status, 404);
});


test('a buyer whose place in line is after their deadline hears so straight away, on the page and by email', async () => {
  const env = await commissionEnv();
  const db = env.COMMISSIONS_DB;
  for (let i = 0; i < 24; i++) {
    db.exec(`INSERT INTO requests (token, share_token, kind, floor_cents, buyer_name, buyer_email, email_key, recipient, story, may_publish, requested_at)
      VALUES (?, ?, 'personal', 20000, 'X', ?, ?, 'Y', 'A story long enough to count.', 1, '2026-10-01T00:00:00Z')`,
    `c${String(i).padStart(31, '0')}`, `d${String(i).padStart(31, '0')}`, `q${i}@example.com`, `q${i}@example.com`);
  }
  const tomorrow = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(Date.now() + 86_400_000));
  const late = await makeRequest(env, { deadline: tomorrow, video: 'yes' });
  const email = db.one("SELECT text FROM outbox WHERE kind = 'received' AND request_id = ?", late.id).text;
  assert.match(email, /At #25 your song is about 3 days away, after your deadline \([A-Z][a-z]{2} \d+\)\. There's a good chance I can do yours first anyway, but I can't promise\. You can keep your place, or cancel for free from your page\./);
  assert.match(email, /You asked about a music video too\. I'll email you about it\./);
  assert.match(await (await call(env, `/commission/s/${late.token}`)).text(), /At #25 your song is about 3 days away, after your deadline/);

  const fine = await makeRequest(env, { email: 'fine@example.com', story: 'No rush on this one at all.', deadline: '2027-06-01' });
  assert.doesNotMatch(db.one("SELECT text FROM outbox WHERE kind = 'received' AND request_id = ?", fine.id).text, /after your deadline|music video/);
  assert.doesNotMatch(await (await call(env, `/commission/s/${fine.token}`)).text(), /after your deadline/);
});
