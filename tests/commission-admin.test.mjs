// Jonathan's admin at /commission/admin: the Access check, the queue, delivering, marking paid,
// every move a request can make, and the outbox.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LOCAL, accessKeys, accessToken, audio, call, commissionEnv, deliver, fakeEmail, fakeFetch, form, makeRequest, urlencoded
} from './fake-cloudflare.mjs';

const ADMIN_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; media-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";
let teams = 0;

// Access set up for a fresh team domain (the cert cache is per team), with its signing key.
async function withAccess(overrides = {}) {
  const team = `https://team${++teams}.cloudflareaccess.com`;
  const keys = await accessKeys();
  const env = await commissionEnv({ ACCESS_TEAM_DOMAIN: team, ACCESS_AUD: 'aud-tag', ADMIN_EMAILS: 'Jonathan@Example.com, other@example.com', ...overrides });
  const certs = fakeFetch([[`${team}/cdn-cgi/access/certs`, () => ({ keys: [keys.jwk], public_cert: { kid: keys.kid } })]]);
  const token = (claims = {}) => accessToken(keys, { aud: ['aud-tag'], iss: team, ...claims });
  return { env, team, keys, certs, token };
}

const asAdmin = (env, path, init = {}) => call(env, path, init, null, LOCAL);
const post = (env, id, fields) => asAdmin(env, `/commission/admin/${id}`, urlencoded({ form_id: crypto.randomUUID().replaceAll('-', ''), ...fields }, { Origin: LOCAL }));

test('without Access set up, the admin works only on localhost, and only with the dev-only var', async () => {
  const env = await commissionEnv();
  const remote = await call(env, '/commission/admin');
  assert.equal(remote.status, 403);
  assert.match(await remote.text(), /isn’t set up yet/);
  assert.equal((await call(env, '/commission/admin', {}, null, 'https://songaday-studios.example.workers.dev')).status, 403);
  const local = await asAdmin(env, '/commission/admin');
  assert.equal(local.status, 200);
  assert.match(await local.text(), /Signed in as local \(wrangler dev\)/);
  // wrangler dev shows every request as localhost, a phone on the Wi-Fi's included.
  const { COMMISSION_ADMIN_LOCAL, ...exposed } = env;
  assert.equal(COMMISSION_ADMIN_LOCAL, 'yes');
  assert.equal((await asAdmin(exposed, '/commission/admin')).status, 403);
  assert.equal((await asAdmin({ ...exposed, COMMISSION_ADMIN_LOCAL: 'true' }, '/commission/admin')).status, 403);
});

test('a team domain pasted without https:// still works', async () => {
  const { env, team, certs, token } = await withAccess();
  const bare = { ...env, ACCESS_TEAM_DOMAIN: team.replace('https://', '') };
  const response = await call(bare, '/commission/admin', { headers: { 'Cf-Access-Jwt-Assertion': await token() } }, certs);
  assert.equal(response.status, 200);
});

test('with Access, only a good token for this app, from an allowed email, gets in', async () => {
  const { env, team, keys, certs, token } = await withAccess();
  const get = (headers) => call(env, '/commission/admin', { headers }, certs);
  assert.equal((await get({})).status, 403, 'no token');
  const good = await token();
  const response = await get({ 'Cf-Access-Jwt-Assertion': good });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Signed in as jonathan@example\.com/);

  const [header, payload] = good.split('.');
  const other = await accessKeys();
  const cases = {
    'bad signature': `${header}.${payload}.${good.split('.')[2].slice(0, -4)}AAAA`,
    'signed by another key': await accessToken(other, { aud: ['aud-tag'], iss: team, kid: keys.kid }),
    'wrong aud': await token({ aud: ['another-app'] }),
    'wrong iss': await token({ iss: 'https://evil.cloudflareaccess.com' }),
    expired: await token({ exp: Math.floor(Date.now() / 1000) - 120 }),
    'not yet valid': await token({ nbf: Math.floor(Date.now() / 1000) + 600 }),
    'alg none': `${Buffer.from(JSON.stringify({ alg: 'none', kid: keys.kid })).toString('base64url')}.${payload}.`,
    'not allowed': await token({ email: 'stranger@example.com' }),
    junk: 'not-a-token'
  };
  for (const [name, value] of Object.entries(cases)) {
    assert.equal((await get({ 'Cf-Access-Jwt-Assertion': value })).status, 403, name);
  }
  assert.equal((await get({ 'Cf-Access-Jwt-Assertion': await token({ aud: 'aud-tag', email: 'OTHER@example.com' }) })).status, 200, 'aud as a string, email in any case');

  const noList = { ...env };
  delete noList.ADMIN_EMAILS;
  assert.equal((await call(noList, '/commission/admin', { headers: { 'Cf-Access-Jwt-Assertion': good } }, certs)).status, 403);
});

test('with Access set up, localhost needs a token too, and odd spellings never reach the admin without one', async () => {
  const { env, certs, token } = await withAccess();
  assert.equal((await call(env, '/commission/admin', {}, certs, LOCAL)).status, 403);
  for (const path of ['/Commission/Admin', '/commission//admin', '/COMMISSION/ADMIN/1', '//commission/admin', '/commission/admin/emails/', '/commission/Admin/1/memo']) {
    const response = await call(env, path, {}, certs);
    assert.equal(response.status, 403, path);
  }
  // Signed in, an odd spelling is just not found.
  const signed = await call(env, '/Commission/Admin', { headers: { 'Cf-Access-Jwt-Assertion': await token() } }, certs);
  assert.equal(signed.status, 404);
});

test('certs are fetched once, and again once on an unknown key id, not more than once a minute', async () => {
  const { env, certs, token } = await withAccess();
  const good = await token();
  await call(env, '/commission/admin', { headers: { 'Cf-Access-Jwt-Assertion': good } }, certs);
  await call(env, '/commission/admin', { headers: { 'Cf-Access-Jwt-Assertion': good } }, certs);
  assert.equal(certs.calls.length, 1);
  const unknown = await token({ kid: 'rotated-key' });
  assert.equal((await call(env, '/commission/admin', { headers: { 'Cf-Access-Jwt-Assertion': unknown } }, certs)).status, 403);
  assert.equal((await call(env, '/commission/admin', { headers: { 'Cf-Access-Jwt-Assertion': unknown } }, certs)).status, 403);
  assert.equal(certs.calls.length, 2);
  assert.equal((await call(env, '/commission/admin', { headers: { 'Cf-Access-Jwt-Assertion': good } }, certs)).status, 200);
});

test('admin posts must come from the admin itself', async () => {
  const env = await commissionEnv();
  const { id } = await makeRequest(env);
  for (const headers of [{}, { Origin: 'https://evil.example' }, { Origin: 'null' }]) {
    const response = await asAdmin(env, `/commission/admin/${id}`, urlencoded({ action: 'writing' }, headers));
    assert.equal(response.status, 403, JSON.stringify(headers));
  }
  assert.equal(env.COMMISSIONS_DB.one('SELECT status FROM requests').status, 'requested');
  const page = await asAdmin(env, '/commission/admin');
  assert.equal(page.headers.get('Referrer-Policy'), 'same-origin');
});

test('the queue shows every answer, in order, escaped, with deadlines that are close marked', async () => {
  const env = await commissionEnv();
  const soon = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  await makeRequest(env, { story: 'First in line.\n\nShe loves <b>bold</b> things & https://example.com links.', deadline: soon, video: 'yes' });
  await makeRequest(env, { email: 'b@example.com', kind: 'business', recipient: 'Acme Bees', story: 'A jingle for our honey, please.', may_publish: 'no' });
  const third = await makeRequest(env, { email: 'c@example.com', story: 'Third, with a voice memo.', memo: [audio.m4a(), 'names.m4a', 'audio/mp4'] });
  await deliver(env, 1);
  const response = await asAdmin(env, '/commission/admin');
  assert.equal(response.headers.get('Content-Security-Policy'), ADMIN_CSP);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, nofollow');
  const html = await response.text();
  assert.doesNotMatch(html, /<script/);
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.match(html, /In line 2 \(0 being written\)/);
  assert.match(html, />In line 2<\/a>/);
  assert.match(html, />Delivered 1<\/a>/);
  const cards = [...html.matchAll(/<article class="card" id="r(\d+)">/g)].map((match) => Number(match[1]));
  assert.deepEqual(cards, [2, third.id]);
  assert.match(html, /<strong>Request 2 · #1 in line<\/strong> · received [A-Z][a-z]{2} \d+ · <span class="tag">BUSINESS<\/span> · <span class="tag">PRIVATE<\/span>/);
  assert.match(html, /<strong>Request 3 · #2 in line<\/strong>[^\n]*PERSONAL<\/span> · <span class="tag">PUBLIC OK<\/span>/);
  assert.match(html, /<dt>For<\/dt><dd>Acme Bees, My sister<\/dd>/);
  assert.match(html, /<dt>From<\/dt><dd>Pat Doe · <a href="mailto:b@example\.com">b@example\.com<\/a><\/dd>/);
  assert.match(html, /<form class="search" method="get" action="\/commission\/admin">/);
  assert.match(html, new RegExp(`<audio controls preload="none" src="/commission/admin/${third.id}/memo">`));

  const delivered = await (await asAdmin(env, '/commission/admin?show=delivered')).text();
  assert.match(delivered, /First in line\.<\/p><p>She loves &lt;b&gt;bold&lt;\/b&gt; things &amp; https:\/\/example\.com links\./);
  assert.doesNotMatch(delivered, /<a href="https:\/\/example\.com/);
  assert.match(delivered, /VIDEO WANTED/);

  env.COMMISSIONS_DB.exec("UPDATE requests SET status = 'requested', delivered_at = NULL WHERE id = 1");
  const marked = await (await asAdmin(env, '/commission/admin')).text();
  assert.match(marked, /<span class="tag soon">DEADLINE [A-Z][a-z]{2} \d+ \(3 days\)<\/span>/);
  env.COMMISSIONS_DB.exec("UPDATE requests SET deadline = '2026-01-02' WHERE id = 1");
  assert.match(await (await asAdmin(env, '/commission/admin')).text(), /DEADLINE Jan 2 \(passed\)/);
});

test('delivering stores the song, marks it delivered and emails them the title', async () => {
  const env = await commissionEnv();
  const { id, token } = await makeRequest(env);
  const response = await deliver(env, id, { title: 'Forty & Fabulous', lyrics: 'Verse <one>' });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('Location'), `/commission/admin/${id}?done=deliver`);
  const row = env.COMMISSIONS_DB.one('SELECT * FROM requests WHERE id = ?', id);
  assert.equal(row.status, 'delivered');
  assert.equal(row.title, 'Forty & Fabulous');
  assert.match(row.audio_key, new RegExp(`^songs/${id}/[0-9a-f]{16}\\.mp3$`));
  assert.equal(env.COMMISSION_FILES.objects.get(row.audio_key).httpMetadata.contentType, 'audio/mpeg');
  const [email] = env.COMMISSIONS_DB.rows('outbox', "kind = 'delivered'");
  assert.equal(email.subject, `Your song is ready (request ${id})`);
  assert.match(email.text, /I finished your song for Siobhan, my sister\. It's called "Forty & Fabulous"\./);
  assert.match(email.html, /Forty &amp; Fabulous/);
  assert.match(email.text, /spread it over 3, 6 or 12 months/);

  const detail = await (await asAdmin(env, `/commission/admin/${id}?done=deliver`)).text();
  assert.match(detail, /<p class="done" role="status">Delivered\.<\/p>/);
  assert.match(detail, /<button type="submit">Save changes<\/button>/);
  assert.match(detail, new RegExp(`<audio controls preload="none" src="/commission/admin/${id}/audio">`));
  assert.ok(detail.includes(`https://songaday.studio/commission/s/${token}`));

  // A redeliver replaces the file and deletes the old one; it emails only when ticked.
  const oldKey = row.audio_key;
  await deliver(env, id, { title: 'Forty & Fabulous (v2)', email: '' });
  const after = env.COMMISSIONS_DB.one('SELECT * FROM requests WHERE id = ?', id);
  assert.notEqual(after.audio_key, oldKey);
  assert.equal(env.COMMISSION_FILES.objects.has(oldKey), false);
  assert.equal(after.delivered_at, row.delivered_at, 'the first delivery time stays');
  assert.equal(env.COMMISSIONS_DB.rows('outbox', "kind = 'updated'").length, 0);
  await deliver(env, id, { title: 'Forty & Fabulous (v3)', file: null });
  assert.equal(env.COMMISSIONS_DB.one('SELECT audio_key FROM requests WHERE id = ?', id).audio_key, after.audio_key, 'no file keeps the song');
  const [updated] = env.COMMISSIONS_DB.rows('outbox', "kind = 'updated'");
  assert.match(updated.text, /I made changes to "Forty & Fabulous \(v3\)"\./);

  // The same form twice sends one email.
  const second = await makeRequest(env, { email: 'twice@example.com' });
  await deliver(env, second.id, { formId: 'f'.repeat(32) });
  await deliver(env, second.id, { formId: 'f'.repeat(32) });
  assert.equal(env.COMMISSIONS_DB.rows('outbox', `request_id = ${second.id} AND kind IN ('delivered', 'updated')`).length, 1);
});

test('a song that isn’t audio, or is over 30 MB, or has no title, is refused', async () => {
  const env = await commissionEnv();
  const { id } = await makeRequest(env);
  let response = await deliver(env, id, { file: audio.png() });
  assert.equal(response.status, 400);
  assert.match(await response.text(), /doesn’t look like an audio file/);
  response = await deliver(env, id, { file: audio.heic() });
  assert.equal(response.status, 400);
  const big = new Uint8Array(30 * 1024 * 1024 + 1);
  big.set(audio.mp3());
  response = await deliver(env, id, { file: big });
  assert.equal(response.status, 413);
  response = await deliver(env, id, { title: '' });
  assert.equal(response.status, 400);
  assert.match(await response.text(), /Give the song a title/);
  response = await deliver(env, id, { file: null });
  assert.match(await response.text(), /Add the song file/);
  response = await asAdmin(env, `/commission/admin/${id}`, await form({ action: 'deliver', form_id: 'a'.repeat(32), title: 'x', video_url: 'javascript:alert(1)', song: [audio.mp3(), 's.mp3'] }, { headers: { Origin: LOCAL } }));
  assert.match(await response.text(), /video link must be an https address/);
  assert.equal(env.COMMISSIONS_DB.one('SELECT status FROM requests').status, 'requested');
  assert.equal(env.COMMISSION_FILES.objects.size, 0);

  // With a video link, the email says there's a video too.
  await asAdmin(env, `/commission/admin/${id}`, await form({ action: 'deliver', form_id: 'b'.repeat(32), title: 'Forty', video_url: 'https://youtu.be/abc', email_them: 'yes', song: [audio.mp3(), 's.mp3'] }, { headers: { Origin: LOCAL } }));
  assert.match(env.COMMISSIONS_DB.one("SELECT text FROM outbox WHERE kind = 'delivered'").text, /It's called "Forty"\. There's a video too\./);
});

test('marking paid by hand records one payment per form and emails only when ticked', async () => {
  const env = await commissionEnv();
  const { id, token } = await makeRequest(env);
  await deliver(env, id);
  const fields = { action: 'paid', form_id: 'b'.repeat(32), amount: '250', method: 'venmo', note: 'Venmo @pat' };
  await post(env, id, fields);
  await post(env, id, fields);
  const [payment] = env.COMMISSIONS_DB.rows('payments');
  assert.deepEqual([payment.kind, payment.amount_cents, payment.method, payment.ref, payment.note], ['manual', 25000, 'venmo', `manual:${'b'.repeat(32)}`, 'Venmo @pat']);
  assert.equal(env.COMMISSIONS_DB.rows('payments').length, 1);
  assert.ok(env.COMMISSIONS_DB.one('SELECT paid_at FROM requests').paid_at);
  assert.equal(env.COMMISSIONS_DB.rows('outbox', "kind = 'paid'").length, 0, 'not ticked');
  await post(env, id, { ...fields, form_id: 'c'.repeat(32), amount: '50.50', method: 'paypal', email_them: 'yes' });
  assert.equal(env.COMMISSIONS_DB.rows('payments').length, 2);
  assert.match(env.COMMISSIONS_DB.one("SELECT text FROM outbox WHERE kind = 'paid'").text, /I got your payment of \$50\.50\./);
  assert.equal((await call(env, `/commission/s/${token}/download`)).status, 200);
  const refused = await post(env, id, { ...fields, form_id: 'd'.repeat(32), amount: 'lots' });
  assert.equal(refused.status, 400);
});

test('every move goes through the transition rules, and a refused one is a 409', async () => {
  const env = await commissionEnv();
  const { id, token } = await makeRequest(env);
  const status = () => env.COMMISSIONS_DB.one('SELECT * FROM requests WHERE id = ?', id);

  assert.equal((await post(env, id, { action: 'archive' })).status, 409, 'in line can’t be archived');
  assert.equal((await post(env, id, { action: 'undeliver' })).status, 409);
  assert.equal((await post(env, id, { action: 'paid', amount: '100' })).status, 409);
  assert.equal((await post(env, id, { action: 'restore' })).status, 409);
  assert.equal((await post(env, id, { action: 'fly' })).status, 400);

  await post(env, id, { action: 'writing' });
  assert.equal(status().status, 'writing');
  assert.ok(status().writing_at);
  const again = await post(env, id, { action: 'writing' });
  assert.equal(again.status, 409);
  assert.match(await again.text(), /That song is being written\./);

  // Undo delivery: the file is deleted, the page goes back to the line, /listen is gone.
  await deliver(env, id);
  const key = status().audio_key;
  assert.equal((await call(env, `/commission/s/${token}/listen`)).status, 200);
  await post(env, id, { action: 'undeliver' });
  assert.equal(status().status, 'writing');
  assert.equal(status().audio_key, null);
  assert.equal(status().delivered_at, null);
  assert.equal(env.COMMISSION_FILES.objects.has(key), false);
  assert.equal((await call(env, `/commission/s/${token}/listen`)).status, 404);
  assert.match(await (await call(env, `/commission/s/${token}`)).text(), /I’m writing your song now\./);

  // Jonathan cancels with a message, then puts it back in its old place.
  const behind = await makeRequest(env, { email: 'behind@example.com' });
  await post(env, id, { action: 'cancel', message: 'Sorry, I double-booked.' });
  assert.equal(status().status, 'cancelled');
  assert.equal(status().cancelled_by, 'jonathan');
  assert.match(env.COMMISSIONS_DB.one("SELECT text FROM outbox WHERE kind = 'cancelled'").text, /I've cancelled your request for a song for Siobhan, my sister\.\n\nSorry, I double-booked\./);
  await post(env, id, { action: 'archive' });
  await post(env, id, { action: 'restore' });
  assert.equal(status().status, 'requested');
  assert.equal(status().archived_at, null);
  assert.equal(status().cancelled_at, null);
  assert.match(await (await call(env, `/commission/s/${token}`)).text(), /<h1>You’re next\.<\/h1>/);
  assert.match(await (await call(env, `/commission/s/${behind.token}`)).text(), /You’re #2 in line\./);

  // Paid requests can't be cancelled or undone.
  await deliver(env, id);
  await post(env, id, { action: 'paid', amount: '300', method: 'other' });
  for (const action of ['cancel', 'undeliver']) {
    const response = await post(env, id, { action });
    assert.equal(response.status, 409, action);
    assert.match(await response.text(), /paid for/);
  }
  // A song cancelled after delivery can't go back in line.
  const late = await makeRequest(env, { email: 'late@example.com' });
  await deliver(env, late.id);
  await post(env, late.id, { action: 'cancel' });
  assert.match(env.COMMISSIONS_DB.one("SELECT text FROM outbox WHERE kind = 'cancelled' AND request_id = ?", late.id).text,
    /I've cancelled your request for a song for Siobhan, my sister\.\n\nIf you have questions, just reply\./);
  assert.equal((await post(env, late.id, { action: 'restore' })).status, 409);
  assert.equal((await call(env, `/commission/s/${late.token}/listen`)).status, 404);
});

test('archiving changes nothing for the buyer', async () => {
  const env = await commissionEnv({ STRIPE_SECRET_KEY: 'rk_test_x' });
  const { id, token } = await makeRequest(env);
  await deliver(env, id);
  const snapshot = async () => {
    const page = (await (await call(env, `/commission/s/${token}`)).text()).replace(/value="[0-9a-f]{32}"/g, '');
    const stub = fakeFetch([['https://api.stripe.com/v1/checkout/sessions', () => ({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' })]]);
    const below = await call(env, `/commission/s/${token}/pay`, urlencoded({ plan: 'once', amount: '199' }), stub);
    return [page, (await call(env, `/commission/s/${token}/listen`)).status, (await call(env, `/commission/s/${token}/download`)).status, below.status];
  };
  const before = await snapshot();
  await post(env, id, { action: 'archive' });
  assert.ok(env.COMMISSIONS_DB.one('SELECT archived_at FROM requests').archived_at);
  assert.deepEqual(await snapshot(), before);
  assert.match(await (await asAdmin(env, '/commission/admin?show=archived')).text(), new RegExp(`id="r${id}"`));
  assert.doesNotMatch(await (await asAdmin(env, '/commission/admin?show=delivered')).text(), new RegExp(`id="r${id}"`));
  await post(env, id, { action: 'unarchive' });
  assert.equal(env.COMMISSIONS_DB.one('SELECT archived_at FROM requests').archived_at, null);
  assert.deepEqual(await snapshot(), before);
});

test('editing the floor changes what the buyer sees and what they can pay', async () => {
  const env = await commissionEnv({ STRIPE_SECRET_KEY: 'rk_test_x' });
  const { id, token } = await makeRequest(env);
  await deliver(env, id);
  await post(env, id, { action: 'edit', floor: '600', may_publish: 'no', wants_video: 'yes', admin_note: 'Agreed $600 with a video.' });
  const row = env.COMMISSIONS_DB.one('SELECT * FROM requests');
  assert.deepEqual([row.floor_cents, row.may_publish, row.wants_video, row.admin_note], [60000, 0, 1, 'Agreed $600 with a video.']);
  const html = await (await call(env, `/commission/s/${token}`)).text();
  assert.match(html, /Pay what you want, from \$600\./);
  assert.match(html, /name="amount" value="1000" checked/);
  assert.doesNotMatch(html, /value="300"|value="500"/);
  assert.doesNotMatch(html, /Agreed \$600/, 'the note is Jonathan’s alone');
  const stub = fakeFetch([]);
  const below = await call(env, `/commission/s/${token}/pay`, urlencoded({ plan: 'once', amount: '500' }), stub);
  assert.equal(below.status, 400);
  assert.match(await below.text(), /The least you can pay is \$600\./);
  assert.equal(stub.calls.length, 0);
  assert.equal((await post(env, id, { action: 'edit', floor: 'free' })).status, 400);
});

test('the emails page puts waiting and failed emails first, and resend sends a new copy', async () => {
  const env = await commissionEnv();
  await makeRequest(env);
  await makeRequest(env, { email: 'b@example.com', story: 'The second one, about a grandmother who fences.' });
  env.COMMISSIONS_DB.exec("UPDATE outbox SET sent_at = '2026-10-23T12:00:00Z', message_id = 'm1' WHERE id = 1");
  const page = await (await asAdmin(env, '/commission/admin/emails')).text();
  assert.match(page, /Email isn’t set up here, so every email waits/);
  const order = [...page.matchAll(/href="\/commission\/admin\/emails\/(\d+)">View/g)].map((match) => Number(match[1]));
  assert.deepEqual(order, [2, 1]);
  const view = await (await asAdmin(env, '/commission/admin/emails/2')).text();
  assert.match(view, /<pre>Hi Pat,\n\nThanks for asking me to write a song/);

  env.COMMISSION_EMAIL = fakeEmail();
  const resend = await asAdmin(env, '/commission/admin/emails/1', urlencoded({ action: 'send' }, { Origin: LOCAL }));
  assert.equal(resend.status, 303);
  const rows = env.COMMISSIONS_DB.rows('outbox');
  assert.equal(rows.length, 3);
  assert.equal(rows[0].message_id, 'm1', 'the first stays as it was');
  assert.ok(rows[2].sent_at);
  assert.equal(rows[2].subject, rows[0].subject);
  assert.equal(rows[1].sent_at, null, 'only the one asked for is sent');
  await asAdmin(env, '/commission/admin/emails/2', urlencoded({ action: 'send' }, { Origin: LOCAL }));
  assert.ok(env.COMMISSIONS_DB.one('SELECT sent_at FROM outbox WHERE id = 2').sent_at);
  assert.equal(env.COMMISSION_EMAIL.sent.length, 2);
});

test('the voice memo and the song play in the admin, privately and sandboxed', async () => {
  const env = await commissionEnv();
  const { id } = await makeRequest(env, { memo: [audio.m4a(), 'names.m4a', 'audio/mp4'] });
  const memo = await asAdmin(env, `/commission/admin/${id}/memo`);
  assert.equal(memo.status, 200);
  assert.equal(memo.headers.get('Content-Type'), 'audio/mp4');
  assert.equal(memo.headers.get('Content-Security-Policy'), 'sandbox');
  assert.equal(memo.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(memo.headers.get('Cache-Control'), 'private, no-store');
  assert.equal((await asAdmin(env, `/commission/admin/${id}/audio`)).status, 404);
  assert.equal((await call(env, `/commission/admin/${id}/memo`)).status, 403);
  assert.equal((await asAdmin(env, '/commission/admin/999')).status, 404);
  assert.equal((await asAdmin(env, '/commission/admin/nothing')).status, 404);
});

test('the detail page offers only the moves that are allowed', async () => {
  const env = await commissionEnv();
  const { id } = await makeRequest(env);
  let html = await (await asAdmin(env, `/commission/admin/${id}`)).text();
  assert.match(html, /value="writing"/);
  assert.match(html, /Cancel this request/);
  assert.doesNotMatch(html, /value="restore"|value="archive"|Mark paid|Undo delivery/);
  assert.match(html, /<button type="submit">Deliver<\/button>/);
  await deliver(env, id);
  html = await (await asAdmin(env, `/commission/admin/${id}`)).text();
  assert.match(html, /Mark paid/);
  assert.match(html, /Undo delivery/);
  assert.match(html, /value="archive"/);
  assert.doesNotMatch(html, /value="writing"|value="restore"/);
});

test('a delivery that loses a race with the buyer cancelling sends nothing and keeps no file', async () => {
  const env = await commissionEnv();
  const { id } = await makeRequest(env);
  // The buyer cancels while the song uploads.
  const put = env.COMMISSION_FILES.put.bind(env.COMMISSION_FILES);
  env.COMMISSION_FILES.put = async (...args) => {
    env.COMMISSIONS_DB.exec("UPDATE requests SET status = 'cancelled', cancelled_at = '2026-10-23T00:00:00Z', cancelled_by = 'buyer' WHERE id = ?", id);
    return put(...args);
  };
  const response = await deliver(env, id);
  assert.equal(response.status, 409);
  assert.match(await response.text(), /changed while you were delivering it/);
  assert.equal(env.COMMISSIONS_DB.one('SELECT status FROM requests WHERE id = ?', id).status, 'cancelled');
  assert.equal(env.COMMISSIONS_DB.rows('outbox', "kind = 'delivered'").length, 0);
  assert.equal(env.COMMISSION_FILES.objects.size, 0);
});

test('Delete for good removes a request with no payments, and blanks one with payments', async () => {
  const env = await commissionEnv();
  const { id, token } = await makeRequest(env, { memo: [audio.m4a(), 'names.m4a', 'audio/mp4'] });
  await deliver(env, id);
  assert.equal(env.COMMISSION_FILES.objects.size, 2);
  let response = await post(env, id, { action: 'delete' });
  assert.equal(response.status, 400, 'the box must be ticked');
  assert.ok(env.COMMISSIONS_DB.one('SELECT id FROM requests WHERE id = ?', id));
  response = await post(env, id, { action: 'delete', confirm: 'yes' });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('Location'), '/commission/admin?done=delete');
  assert.match(await (await asAdmin(env, '/commission/admin?done=delete')).text(), /Deleted for good\./);
  assert.equal(env.COMMISSIONS_DB.one('SELECT id FROM requests WHERE id = ?', id), undefined);
  assert.equal(env.COMMISSIONS_DB.rows('outbox').length, 0);
  assert.equal(env.COMMISSION_FILES.objects.size, 0);
  assert.equal((await call(env, `/commission/s/${token}`)).status, 404);

  const paid = await makeRequest(env, { email: 'paid@example.com', story: 'Paid for, then asked to be forgotten.' });
  await deliver(env, paid.id);
  await post(env, paid.id, { action: 'paid', amount: '300', method: 'venmo', note: 'Venmo @paid-person' });
  await post(env, paid.id, { action: 'delete', confirm: 'yes' });
  const row = env.COMMISSIONS_DB.one('SELECT * FROM requests WHERE id = ?', paid.id);
  assert.ok(row.deleted_at);
  assert.equal(row.status, 'cancelled');
  assert.deepEqual([row.buyer_name, row.buyer_email, row.recipient, row.story, row.title, row.audio_key], ['', '', '', '', null, null]);
  assert.notEqual(row.token, paid.token);
  assert.equal((await call(env, `/commission/s/${paid.token}`)).status, 404);
  const [payment] = env.COMMISSIONS_DB.rows('payments');
  assert.deepEqual([payment.amount_cents, payment.note], [30000, '']);
  assert.equal(env.COMMISSIONS_DB.rows('outbox', `request_id = ${paid.id}`).length, 0);
  assert.equal((await post(env, paid.id, { action: 'restore' })).status, 409, 'nothing more can happen to it');

  const planned = await makeRequest(env, { email: 'plan@example.com', story: 'Paying monthly, still going.' });
  await deliver(env, planned.id);
  env.COMMISSIONS_DB.exec(`INSERT INTO plans (subscription_id, request_id, months, monthly_cents, started_at) VALUES ('sub_x', ?, 3, 10000, '2026-10-23T00:00:00Z')`, planned.id);
  response = await post(env, planned.id, { action: 'delete', confirm: 'yes' });
  assert.equal(response.status, 409);
  assert.match(await response.text(), /monthly payments are still going/);
});


test('the admin finds a request by number, email, name or who it’s for, in any state', async () => {
  const env = await commissionEnv();
  const one = await makeRequest(env, { email: 'pat.reply@example.com', name: 'Pat Reply', recipient: 'Grandma Jo' });
  const two = await makeRequest(env, { email: 'other@example.com', name: 'Someone Else', recipient: 'Uncle Bo', story: 'A different story entirely, about bowling.' });
  await post(env, two.id, { action: 'cancel' });
  const find = async (q) => [...(await (await asAdmin(env, `/commission/admin?q=${encodeURIComponent(q)}`)).text()).matchAll(/<article class="card" id="r(\d+)">/g)].map((match) => Number(match[1]));
  assert.deepEqual(await find('PAT.REPLY@'), [one.id]);
  assert.deepEqual(await find('grandma'), [one.id]);
  assert.deepEqual(await find(`request ${two.id}`), [two.id]);
  assert.deepEqual(await find(`#${two.id}`), [two.id]);
  assert.deepEqual(await find('example.com'), [two.id, one.id]);
  assert.deepEqual(await find('nobody'), []);
  assert.match(await (await asAdmin(env, '/commission/admin?q=%3Cb%3E')).text(), /matching “&lt;b&gt;”/);
});

test('the line opens with the deadlines that are close or at risk, linked', async () => {
  const env = await commissionEnv();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  const inDays = (days) => new Date(Date.parse(`${today}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
  const soon = await makeRequest(env, { deadline: inDays(3), recipient: 'Soon Person' });
  await makeRequest(env, { email: 'far@example.com', deadline: inDays(60), recipient: 'Far Person', story: 'Months away, no hurry at all.' });
  const html = await (await asAdmin(env, '/commission/admin')).text();
  assert.match(html, new RegExp(`<h2 id="watch-title">Deadlines in the next 7 days, or at risk</h2><ul>\\n  <li><a href="/commission/admin/${soon.id}">#1 in line · request ${soon.id} · for Soon Person</a> · [A-Z][a-z]{2} \\d+ \\(3 days\\)</li>`));
  assert.doesNotMatch(html.match(/<section class="watch"[\s\S]*?<\/section>/)[0], /Far Person/);
});

test('after delivering, the admin offers the next in line; Start writing on the line goes back to the line', async () => {
  const env = await commissionEnv();
  const first = await makeRequest(env);
  const second = await makeRequest(env, { email: 'second@example.com', story: 'The next one along, about a tandem bike.' });
  await deliver(env, first.id);
  const detail = await (await asAdmin(env, `/commission/admin/${first.id}?done=deliver`)).text();
  assert.match(detail, new RegExp(`Delivered\\. <a href="/commission/admin/${second.id}">Next in line →</a>`));
  // Fixing a typo in a delivered song doesn't email them unless asked.
  assert.match(detail, /<input type="checkbox" name="email_them" value="yes"> Email them that I updated it/);
  assert.match(detail, /The link they can pass on/);
  assert.match(await (await asAdmin(env, '/commission/admin')).text(), /name="back" value="line"/);
  const fromLine = await asAdmin(env, `/commission/admin/${second.id}`, urlencoded({ action: 'writing', back: 'line' }, { Origin: LOCAL }));
  assert.equal(fromLine.headers.get('Location'), `/commission/admin#r${second.id}`);
});
