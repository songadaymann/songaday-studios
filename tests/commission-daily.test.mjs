// The daily cron: place-in-line emails, the payment reminder, Jonathan's summary, and the outbox.
// The clock is passed in.
import assert from 'node:assert/strict';
import test from 'node:test';
import { runCommissionDaily } from '../commission.mjs';
import { EMAIL_KINDS, flushOutbox, queueEmail, renderEmail } from '../commission-email.mjs';
import { recordPayment } from '../commission-stripe.mjs';
import { LOCAL, call, commissionEnv, deliver, fakeEmail, makeRequest, markSent, urlencoded } from './fake-cloudflare.mjs';

const DAY1 = new Date('2026-11-03T14:00:00Z');
const DAY2 = new Date('2026-11-04T14:00:00Z');
const DAY3 = new Date('2026-11-05T14:00:00Z');
const EARLIER = '2026-11-01T15:00:00.000Z';

// n requests in line, made two days before DAY1, their "received" emails sent.
async function line(n, env) {
  env ??= await commissionEnv();
  const made = [];
  for (let i = 1; i <= n; i++) {
    made.push(await makeRequest(env, { email: `buyer${i}@example.com`, name: `Buyer${i} Doe`, story: `Story ${i}: she loves the ocean and terrible puns.` }));
  }
  env.COMMISSIONS_DB.exec('UPDATE requests SET requested_at = ?', EARLIER);
  markSent(env.COMMISSIONS_DB, EARLIER);
  return { env, made };
}

const moved = (db, where = '1') => db.rows('outbox', `kind = 'moved' AND ${where}`).map((row) => ({ id: row.request_id, position: row.position, text: row.text }));
const admin = async (env, id, fields) => call(env, `/commission/admin/${id}`, urlencoded({ form_id: crypto.randomUUID().replaceAll('-', ''), ...fields }, { Origin: LOCAL }), null, LOCAL);

test('the morning after two songs are delivered, everyone behind them hears their new place', async () => {
  const { env, made } = await line(5);
  await deliver(env, made[0].id);
  await deliver(env, made[1].id);
  await runCommissionDaily(env, DAY1);
  const rows = moved(env.COMMISSIONS_DB);
  assert.deepEqual(rows.map(({ id, position }) => [id, position]), [[3, 1], [4, 2], [5, 3]]);
  assert.match(rows[0].text, /Your song for Siobhan, my sister is now #1 in line \(it was #3\)\./);
  assert.match(rows[2].text, /now #3 in line \(it was #5\)/);
  const email = env.COMMISSIONS_DB.one("SELECT * FROM outbox WHERE kind = 'moved' AND request_id = 3");
  assert.equal(email.subject, "You're now #1 in line");
  assert.equal(email.once_key, 'moved:3:2026-11-03');
  assert.equal(email.unsubscribe_url, `https://songaday.studio/commission/s/${made[2].token}/quiet`);
  assert.match(email.text, /To stop these updates, turn them off on your page\./);
});

test('a second run the same day sends nothing, nor do two runs at once, nor a day with no change', async () => {
  const { env, made } = await line(4);
  env.COMMISSION_EMAIL = fakeEmail();
  await deliver(env, made[0].id);
  await runCommissionDaily(env, DAY1);
  const sentAfterFirst = env.COMMISSION_EMAIL.sent.filter((message) => /now #/.test(message.subject)).length;
  assert.equal(sentAfterFirst, 3);
  await runCommissionDaily(env, new Date('2026-11-03T20:00:00Z'));
  await runCommissionDaily(env, DAY2);
  assert.equal(moved(env.COMMISSIONS_DB).length, 3);
  assert.equal(env.COMMISSION_EMAIL.sent.filter((message) => /now #/.test(message.subject)).length, 3);

  const together = await line(4);
  together.env.COMMISSION_EMAIL = fakeEmail();
  // One came in yesterday afternoon, so there's news for a summary too.
  together.env.COMMISSIONS_DB.exec('UPDATE requests SET requested_at = ? WHERE id = 4', '2026-11-02T18:00:00.000Z');
  await deliver(together.env, together.made[0].id);
  await Promise.all([runCommissionDaily(together.env, DAY1), runCommissionDaily(together.env, DAY1)]);
  assert.equal(moved(together.env.COMMISSIONS_DB).length, 3);
  assert.equal(together.env.COMMISSION_EMAIL.sent.filter((message) => /now #/.test(message.subject)).length, 3);
  assert.equal(together.env.COMMISSION_EMAIL.sent.filter((message) => message.subject.startsWith('Commissions:')).length, 1);
});

test('quiet requests and songs being written get no email, but still count in the line', async () => {
  const { env, made } = await line(4);
  env.COMMISSIONS_DB.exec('UPDATE requests SET quiet = 1 WHERE id = 3');
  await admin(env, made[1].id, { action: 'writing' });
  await deliver(env, made[0].id);
  await runCommissionDaily(env, DAY1);
  // #2 is being written (now #1), #3 is quiet (now #2), #4 goes from #4 to #3.
  assert.deepEqual(moved(env.COMMISSIONS_DB).map(({ id, position }) => [id, position]), [[4, 3]]);
});

test('a request made this morning gets no moved email today', async () => {
  const { env, made } = await line(2);
  const late = await makeRequest(env, { email: 'late@example.com', story: 'Made this morning, about a cat called Toast.' });
  env.COMMISSIONS_DB.exec('UPDATE requests SET requested_at = ? WHERE id = ?', '2026-11-03T12:30:00.000Z', late.id);
  markSent(env.COMMISSIONS_DB);
  await deliver(env, made[0].id);
  await runCommissionDaily(env, DAY1);
  assert.deepEqual(moved(env.COMMISSIONS_DB).map(({ id }) => id), [2]);
});

test('a moved email that couldn’t go out is dropped, and the next one says what they last really heard', async () => {
  const { env, made } = await line(3);
  env.COMMISSION_EMAIL = fakeEmail();
  env.COMMISSION_EMAIL.fail = (message) => /now #/.test(message.subject) ? 'E_DAILY_LIMIT_EXCEEDED' : null;
  await deliver(env, made[0].id);
  await runCommissionDaily(env, DAY1);
  const stuck = env.COMMISSIONS_DB.rows('outbox', "kind = 'moved'");
  assert.equal(stuck.length, 2);
  assert.ok(stuck.every((row) => row.sent_at === null && row.attempts === 0 && row.claimed_at === null && row.failed_at === null));
  assert.equal(stuck[0].last_error, 'E_DAILY_LIMIT_EXCEEDED', 'the run stopped there');

  env.COMMISSION_EMAIL.fail = null;
  await deliver(env, made[1].id);
  await runCommissionDaily(env, DAY2);
  const rows = env.COMMISSIONS_DB.rows('outbox', "kind = 'moved'");
  assert.deepEqual(rows.map((row) => [row.request_id, row.position, row.once_key]), [[3, 1, 'moved:3:2026-11-04']]);
  assert.match(rows[0].text, /now #1 in line \(it was #3\)/);
  assert.ok(rows[0].sent_at);
});

test('putting a request back in line, or undoing a delivery, moves people back with no email', async () => {
  const { env, made } = await line(4);
  env.COMMISSION_EMAIL = fakeEmail();
  // Jonathan cancels #2 by mistake: #3 and #4 move up and hear about it.
  await admin(env, made[1].id, { action: 'cancel' });
  await runCommissionDaily(env, DAY1);
  assert.deepEqual(moved(env.COMMISSIONS_DB).map(({ id, position }) => [id, position]), [[3, 2], [4, 3]]);

  // Put back in line: it's #2 again and gets a received email with its place; #3 and #4 go
  // back to #3 and #4 with no email.
  await admin(env, made[1].id, { action: 'restore' });
  const restored = env.COMMISSIONS_DB.one("SELECT * FROM outbox WHERE kind = 'received' AND request_id = 2 ORDER BY id DESC LIMIT 1");
  assert.equal(restored.position, 2);
  assert.match(restored.text, /You're #2 in line\./);
  assert.equal(env.COMMISSIONS_DB.one('SELECT status FROM requests WHERE id = 2').status, 'requested');
  await runCommissionDaily(env, DAY2);
  assert.equal(moved(env.COMMISSIONS_DB).length, 2);

  // Undo delivery does the same: #1 is delivered, then undone.
  await deliver(env, made[0].id);
  await admin(env, made[0].id, { action: 'undeliver' });
  await runCommissionDaily(env, DAY3);
  assert.equal(moved(env.COMMISSIONS_DB).length, 2);

  // When their number drops below what they last heard, the email says what that was.
  await deliver(env, made[0].id);
  await deliver(env, made[1].id);
  await runCommissionDaily(env, new Date('2026-11-06T14:00:00Z'));
  const latest = moved(env.COMMISSIONS_DB, "once_key LIKE '%2026-11-06'");
  assert.deepEqual(latest.map(({ id, position }) => [id, position]), [[3, 1], [4, 2]]);
  assert.match(latest[1].text, /now #2 in line \(it was #3\)/);
});

test('one payment reminder, a week after delivery, only when unpaid and not archived', async () => {
  const { env, made } = await line(3);
  for (const { id } of made) await deliver(env, id);
  env.COMMISSIONS_DB.exec('UPDATE requests SET delivered_at = ?', '2026-10-26T15:00:00.000Z');
  env.COMMISSIONS_DB.exec("UPDATE requests SET paid_at = '2026-10-27T00:00:00Z' WHERE id = 2");
  env.COMMISSIONS_DB.exec("UPDATE requests SET archived_at = '2026-10-27T00:00:00Z' WHERE id = 3");
  await runCommissionDaily(env, new Date('2026-11-01T14:00:00Z'));
  assert.equal(env.COMMISSIONS_DB.rows('outbox', "kind = 'reminder'").length, 0, 'six days is too soon');
  await Promise.all([runCommissionDaily(env, DAY1), runCommissionDaily(env, DAY1)]);
  await runCommissionDaily(env, DAY2);
  const reminders = env.COMMISSIONS_DB.rows('outbox', "kind = 'reminder'");
  assert.deepEqual(reminders.map((row) => row.request_id), [1]);
  assert.equal(reminders[0].subject, 'Your song is waiting for you');
  assert.match(reminders[0].text, /"Siobhan at Forty" is ready on your page/);
  assert.ok(env.COMMISSIONS_DB.one('SELECT reminded_at FROM requests WHERE id = 1').reminded_at);
});

test('Jonathan’s summary goes only when there’s news, and flags what needs a look', async () => {
  const env = await commissionEnv();
  await runCommissionDaily(env, DAY1);
  assert.equal(env.COMMISSIONS_DB.rows('outbox', "kind = 'summary'").length, 0, 'nothing happened');

  const a = await makeRequest(env, { deadline: '2026-11-08', occasion: 'A retirement' });
  const b = await makeRequest(env, { email: 'b@example.com', story: 'For my brother, who builds boats in his garage.' });
  await deliver(env, b.id);
  await admin(env, b.id, { action: 'cancel' });
  const cancelled = env.COMMISSIONS_DB.one('SELECT * FROM requests WHERE id = ?', b.id);
  await env.COMMISSIONS_DB.batch(recordPayment(env, cancelled, { kind: 'once', ref: 'cs_test_old_tab', amount: 30000 }));
  markSent(env.COMMISSIONS_DB);
  env.COMMISSIONS_DB.exec('UPDATE requests SET requested_at = ?', '2026-11-03T12:00:00.000Z');
  env.COMMISSIONS_DB.exec('UPDATE payments SET paid_at = ?', '2026-11-03T13:00:00.000Z');

  await runCommissionDaily(env, new Date('2026-11-03T14:00:00Z'));
  const [summary] = env.COMMISSIONS_DB.rows('outbox', "kind = 'summary'");
  assert.equal(summary.to_email, 'notify@songaday.studio');
  assert.equal(summary.request_id, null);
  assert.equal(summary.subject, 'Commissions: 2 new, 1 paid ($300), 1 in line');
  assert.match(summary.text, new RegExp(`#${a.id} · personal · A retirement · deadline 2026-11-08 · Pat Doe`));
  assert.match(summary.text, /Deadlines in the next 7 days: #1 \(2026-11-08\)/);
  assert.match(summary.text, new RegExp(`Needs a look: #${b.id} was paid after it was cancelled`));
  assert.match(summary.text, /https:\/\/songaday\.studio\/commission\/admin/);

  // The same day again: one summary. The next day, the deadline is still close, so there's news.
  await runCommissionDaily(env, new Date('2026-11-03T18:00:00Z'));
  assert.equal(env.COMMISSIONS_DB.rows('outbox', "kind = 'summary'").length, 1);
  markSent(env.COMMISSIONS_DB);
  env.COMMISSIONS_DB.exec('UPDATE requests SET deadline = NULL');
  await runCommissionDaily(env, DAY2);
  assert.equal(env.COMMISSIONS_DB.rows('outbox', "kind = 'summary'").length, 1, 'no news, no summary');
});

test('without an email binding nothing is claimed and nothing counts as an attempt', async () => {
  const { env } = await line(2);
  env.COMMISSIONS_DB.exec('UPDATE outbox SET sent_at = NULL');
  const result = await runCommissionDaily(env, DAY1);
  assert.equal(result.sent, 0);
  for (const row of env.COMMISSIONS_DB.rows('outbox')) {
    assert.equal(row.claimed_at, null);
    assert.equal(row.attempts, 0);
    assert.equal(row.sent_at, null);
  }
});

test('with the binding, emails go out from Jonathan, and only place-in-line ones can be unsubscribed', async () => {
  const { env, made } = await line(3);
  env.COMMISSION_EMAIL = fakeEmail();
  await deliver(env, made[0].id);
  await runCommissionDaily(env, DAY1);
  const sent = env.COMMISSION_EMAIL.sent;
  assert.ok(sent.length >= 3);
  for (const message of sent) {
    assert.deepEqual(message.from, { email: 'songs@songaday.studio', name: 'Jonathan Mann' });
    assert.equal(message.replyTo, 'jonathan@songaday.studio');
    assert.ok(message.text && message.html);
    const unsubscribe = message.headers?.['List-Unsubscribe'];
    if (/now #/.test(message.subject)) {
      assert.match(unsubscribe, /^<https:\/\/songaday\.studio\/commission\/s\/[0-9a-f]{32}\/quiet>$/);
      assert.equal(message.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
    } else {
      assert.equal(message.headers, undefined, message.subject);
    }
  }
  for (const row of env.COMMISSIONS_DB.rows('outbox', "kind != 'received'")) {
    assert.ok(row.sent_at, row.kind);
    assert.match(row.message_id, /^msg-\d+$/);
  }
});

test('send errors: permanent ones fail at once, quota ones stop the run, others retry five times', async () => {
  const { env } = await line(3);
  env.COMMISSIONS_DB.exec('UPDATE outbox SET sent_at = NULL');
  env.COMMISSION_EMAIL = fakeEmail();
  env.COMMISSION_EMAIL.fail = (message) => message.to === 'buyer1@example.com' ? 'E_RECIPIENT_SUPPRESSED' : null;
  await flushOutbox(env, { now: DAY1 });
  const [first, second, third] = env.COMMISSIONS_DB.rows('outbox');
  assert.ok(first.failed_at);
  assert.equal(first.last_error, 'E_RECIPIENT_SUPPRESSED');
  assert.equal(first.attempts, 1);
  assert.ok(second.sent_at && third.sent_at);
  assert.doesNotMatch(JSON.stringify(first), /send failed/, 'only the code is kept');

  const quota = await line(3);
  quota.env.COMMISSIONS_DB.exec('UPDATE outbox SET sent_at = NULL');
  quota.env.COMMISSION_EMAIL = fakeEmail();
  quota.env.COMMISSION_EMAIL.fail = 'E_DAILY_LIMIT_EXCEEDED';
  await flushOutbox(quota.env, { now: DAY1 });
  assert.equal(quota.env.COMMISSION_EMAIL.sent.length, 0);
  const rows = quota.env.COMMISSIONS_DB.rows('outbox');
  assert.deepEqual(rows.map((row) => [row.attempts, row.claimed_at, row.failed_at]), [[0, null, null], [0, null, null], [0, null, null]]);
  assert.equal(rows.filter((row) => row.last_error).length, 1, 'the run stopped at the first one');

  const flaky = await line(1);
  flaky.env.COMMISSIONS_DB.exec('UPDATE outbox SET sent_at = NULL');
  flaky.env.COMMISSION_EMAIL = fakeEmail();
  flaky.env.COMMISSION_EMAIL.fail = 'E_INTERNAL_SERVER_ERROR';
  for (let i = 0; i < 7; i++) await flushOutbox(flaky.env, { now: DAY1 });
  const [row] = flaky.env.COMMISSIONS_DB.rows('outbox');
  assert.equal(row.attempts, 5);
  assert.ok(row.failed_at);
});

test('transactional email goes before place-in-line email, and a stale place-in-line email is deleted', async () => {
  const { env, made } = await line(3);
  await deliver(env, made[0].id);
  await runCommissionDaily(env, DAY1);
  // #2's song is delivered before its moved email goes out.
  await deliver(env, made[1].id);
  env.COMMISSION_EMAIL = fakeEmail();
  await flushOutbox(env, { now: DAY1 });
  const subjects = env.COMMISSION_EMAIL.sent.map((message) => message.subject);
  const firstMoved = subjects.findIndex((subject) => /now #/.test(subject));
  assert.ok(firstMoved > subjects.lastIndexOf('Your song is ready'), subjects.join(' | '));
  assert.deepEqual(env.COMMISSIONS_DB.rows('outbox', "kind = 'moved'").map((row) => row.request_id), [3]);
});

test('two flushes at once send each email once', async () => {
  const { env } = await line(4);
  env.COMMISSIONS_DB.exec('UPDATE outbox SET sent_at = NULL');
  env.COMMISSION_EMAIL = fakeEmail();
  await Promise.all([flushOutbox(env, { now: DAY1 }), flushOutbox(env, { now: DAY1 }), flushOutbox(env, { now: DAY1 })]);
  assert.equal(env.COMMISSION_EMAIL.sent.length, 4);
  assert.deepEqual(env.COMMISSION_EMAIL.sent.map((message) => message.to).sort(),
    ['buyer1@example.com', 'buyer2@example.com', 'buyer3@example.com', 'buyer4@example.com']);
});

test('what a buyer typed is escaped in the HTML part, and left out when it looks like a link', async () => {
  const env = await commissionEnv();
  const { token } = await makeRequest(env, { name: '<b>Pat</b> Doe', recipient: 'Siobhan & <i>co</i>' });
  const [row] = env.COMMISSIONS_DB.rows('outbox');
  assert.match(row.html, /Hi &lt;b&gt;Pat&lt;\/b&gt;,/);
  assert.match(row.html, /for Siobhan &amp; &lt;i&gt;co&lt;\/i&gt;/);
  assert.doesNotMatch(row.html, /<b>Pat|<i>co/);
  assert.ok(row.html.includes(`href="https://songaday.studio/commission/s/${token}"`));
  assert.doesNotMatch(row.html, /<img|<script|https:\/\/fonts/);

  const spam = { buyer_name: 'visit scam.example', recipient: 'win at https://scam.example', title: 'x', floor_cents: 20000, token: 'a'.repeat(32) };
  const { text } = renderEmail('received', spam, { position: 3, page: 'https://songaday.studio/commission/s/x' });
  assert.match(text, /^Hi,\n/);
  assert.match(text, /Thanks for asking me to write a song\. You're #3 in line\./);
  assert.doesNotMatch(text, /scam/);
  for (const name of ['pat@example.com', 'www.example', 'J.R. Smith']) {
    assert.match(renderEmail('received', { ...spam, buyer_name: name }, { position: 1, page: 'x' }).text, /^Hi,\n/, name);
  }
  assert.match(renderEmail('received', { ...spam, buyer_name: 'Pat Doe', recipient: 'x'.repeat(80) }, { position: 1, page: 'x' }).text,
    new RegExp(`^Hi Pat,\\n\\nThanks for asking me to write a song for ${'x'.repeat(60)}…\\.`));
});

test('no email says donate, gift, tax-deductible or patron, and none links to Patreon', () => {
  const request = { buyer_name: 'Pat Doe', recipient: 'Siobhan', title: 'Siobhan at Forty', floor_cents: 20000, token: 'a'.repeat(32) };
  const data = { position: 2, was: 4, amount: 50000, months: 6, by: 'jonathan', message: 'Sorry!', page: 'https://songaday.studio/commission/s/x', origin: 'https://songaday.studio', lines: ['In line: 3'], subject: 'Commissions: 1 new' };
  for (const kind of EMAIL_KINDS) {
    for (const variant of [data, { ...data, months: undefined, by: 'buyer' }]) {
      const { subject, text, html } = renderEmail(kind, request, variant);
      assert.doesNotMatch(subject + text + html, /donat|gift|tax-deductible|patron/i, kind);
      assert.ok(subject && text && html, kind);
    }
  }
});

test('sent emails are purged after 180 days, except what someone in line was last told', async () => {
  const { env } = await line(1);
  const delivered = await makeRequest(env, { email: 'old@example.com', story: 'An old one, long since delivered and paid for.' });
  env.COMMISSIONS_DB.exec("UPDATE requests SET status = 'delivered' WHERE id = ?", delivered.id);
  env.COMMISSIONS_DB.exec('UPDATE outbox SET sent_at = ?', '2026-01-01T00:00:00.000Z');
  await runCommissionDaily(env, DAY1);
  assert.deepEqual(env.COMMISSIONS_DB.rows('outbox').map((row) => row.request_id), [1]);
});

test('queueEmail skips a summary when there’s nowhere to send it', async () => {
  const env = await commissionEnv({ COMMISSION_NOTIFY_TO: '' });
  assert.equal(queueEmail(env, 'summary', null, { lines: [], subject: 'x' }), null);
  const { env: busy } = await line(1);
  delete busy.COMMISSION_NOTIFY_TO;
  await runCommissionDaily(busy, DAY1);
  assert.equal(busy.COMMISSIONS_DB.rows('outbox', "kind = 'summary'").length, 0);
});

test('the scheduled handler runs the daily step', async () => {
  const { default: worker } = await import('../worker.mjs');
  const { env, made } = await line(2);
  await deliver(env, made[0].id);
  const waits = [];
  await worker.scheduled({ scheduledTime: DAY1.getTime(), cron: '0 14 * * *' }, env, { waitUntil: (promise) => waits.push(promise) });
  await Promise.all(waits);
  assert.deepEqual(moved(env.COMMISSIONS_DB).map(({ id, position }) => [id, position]), [[2, 1]]);
});
