// Emails for songaday.studio/commission. Every email is written to the outbox table first, in the
// same batch as the fact it announces, then sent through the Email Service binding
// (COMMISSION_EMAIL) when there is one. Without it, or while sending isn't working yet (the
// domain not verified, the quota used up), the emails wait in the outbox, where the admin
// shows them, and nothing is lost. wrangler dev simulates the binding and marks them sent.
import { escapeHtml } from './fumble-page.mjs';
import { D1_QUERY_BUDGET, OUTBOX_BATCH, OUTBOX_MAX_ATTEMPTS, PLAN_MONTHS } from './commission-config.mjs';
import { dollars, pageUrl, shareUrl, siteOrigin } from './commission-core.mjs';

// The form can mail any address, so the only words a buyer typed that reach an email are their
// first name and who the song is for, and each is left out when it looks like a link or an
// address. Otherwise the form would be a way to mail a stranger a link from Jonathan's domain.
const looksLikeLink = (text) => /@|:\/\/|www\.|\p{L}\.\p{L}/iu.test(text);

export function greeting(request) {
  const name = String(request.buyer_name ?? '').trim();
  const first = name.split(/\s+/)[0];
  return first && !looksLikeLink(name) ? `Hi ${first},` : 'Hi,';
}

function forWhom(request) {
  const recipient = String(request.recipient ?? '').trim();
  if (!recipient || looksLikeLink(recipient)) return '';
  return ` for ${recipient.length > 60 ? recipient.slice(0, 60).trimEnd() + '…' : recipient}`;
}

const SIGN = 'Jonathan';
const others = PLAN_MONTHS.slice(0, -1).join(', ') + ' or ' + PLAN_MONTHS.at(-1);

// The emails a buyer is most likely to forward, to the person the song is for, carry two links:
// their own page, and one that only plays the song.
const PRIVATE = 'Keep that link to yourself: anyone who has it can see everything you told me, and pay or stop payments.';
const share = (d) => ({ lead: 'To share the song, send this link instead. It plays the song and shows the lyrics, and nothing else:', url: d.share, label: 'Link to share' });

// Each template gives a subject and a body: paragraphs (strings), and links ({ lead, url,
// label }), which the HTML part shows as buttons.
const TEMPLATES = {
  received: (r, d) => ({
    subject: `Got it. You're #${d.position} in line`,
    body: [
      greeting(r),
      `Thanks for asking me to write a song${forWhom(r)}. You're #${d.position} in line.`,
      `I write songs in the order they come in, and I'll email you when you move up (once a day at most). When your song is done, you'll get a private page where you can listen to it and read the lyrics. You pay then, whatever you want from ${dollars(r.floor_cents)}, and that unlocks the download.`,
      { lead: "Here's your page, with everything you told me:", url: d.page, label: 'Your page' },
      'Keep that link to yourself. Anyone who has it can see your page. Changed your mind? You can cancel there until I start writing.',
      'If you think of anything else, just reply to this email.',
      SIGN
    ]
  }),
  moved: (r, d) => ({
    subject: `You're now #${d.position} in line`,
    body: [
      greeting(r),
      `Your song${forWhom(r)} is now #${d.position} in line (it was #${d.was}).`,
      { lead: 'Your page:', url: d.page, label: 'Your page' },
      SIGN,
      "You're getting this because you asked me for a song at songaday.studio. To stop these updates, turn them off on your page."
    ]
  }),
  delivered: (r, d) => ({
    subject: 'Your song is ready',
    body: [
      greeting(r),
      `I finished your song${forWhom(r)}. It's called "${r.title}".`,
      { lead: 'Listen to it and read the lyrics on your page:', url: d.page, label: 'Listen to your song' },
      `When you're ready, pay what you want, from ${dollars(r.floor_cents)}. You can pay all at once or spread it over ${others} months. Paying unlocks the download.`,
      PRIVATE,
      share(d),
      "If something isn't right, reply and tell me.",
      SIGN
    ]
  }),
  updated: (r, d) => ({
    subject: 'I updated your song',
    body: [
      greeting(r),
      { lead: `I made changes to "${r.title}". The new version is on your page:`, url: d.page, label: 'Your page' },
      SIGN
    ]
  }),
  paid: (r, d) => ({
    subject: 'Thank you. Your song is ready to download',
    body: [
      greeting(r),
      {
        lead: d.months
          ? `Thank you! I got your first payment of ${dollars(d.amount)}. The other ${d.months - 1} come out once a month and stop by themselves after the last one. You can download "${r.title}" from your page now:`
          : `Thank you! I got your payment of ${dollars(d.amount)}. You can download "${r.title}" from your page now:`,
        url: d.page,
        label: 'Download your song'
      },
      PRIVATE,
      share(d),
      SIGN
    ]
  }),
  'plan-finished': (r, d) => ({
    subject: 'That was your last payment',
    body: [
      greeting(r),
      `That was the last of your ${d.months} payments for "${r.title}". Nothing more will be charged. Thank you.`,
      SIGN
    ]
  }),
  'plan-stopped': (r, d) => ({
    subject: 'Your monthly payments are stopped',
    body: [
      greeting(r),
      `Your monthly payments for "${r.title}" are stopped, from your page: ${d.paid} of ${d.months} went through. Nothing more will be charged. The song is still yours, and the download stays unlocked.`,
      "If you didn't stop them, reply and tell me.",
      SIGN
    ]
  }),
  'extra-thanks': (r, d) => ({
    subject: 'Thank you for the extra',
    body: [greeting(r), `I got your extra ${dollars(d.amount)} for "${r.title}". Thank you. It means a lot.`, SIGN]
  }),
  reminder: (r, d) => ({
    subject: 'Your song is waiting for you',
    body: [
      greeting(r),
      { lead: `Just a reminder that "${r.title}" is ready on your page:`, url: d.page, label: 'Your page' },
      `Pay what you want, from ${dollars(r.floor_cents)}, whenever you're ready, and the download unlocks.`,
      PRIVATE,
      SIGN
    ]
  }),
  cancelled: (r, d) => ({
    subject: 'Your song request is cancelled',
    body: d.by === 'buyer'
      ? [greeting(r), `You cancelled your request for a song${forWhom(r)}. If that was a mistake, just reply and I'll put it back, in the same place in line.`, SIGN]
      : [greeting(r), `I've cancelled your request for a song${forWhom(r)}.`, ...(d.message ? [d.message] : []), SIGN]
  }),
  // To Jonathan (COMMISSION_NOTIFY_TO). d.lines and d.subject come from runCommissionDaily.
  summary: (r, d) => ({
    subject: d.subject,
    body: [d.lines.join('\n'), { lead: '', url: `${d.origin}/commission/admin`, label: 'Open the admin' }]
  })
};

export const EMAIL_KINDS = Object.keys(TEMPLATES);

const BUTTON = 'display:inline-block;padding:12px 18px;background:#e6203f;color:#ffffff;font-weight:700;text-decoration:none';

// { subject, text, html } for one email. Every value in the HTML part is escaped, the title
// Jonathan typed included. Subjects carry nothing a buyer typed.
export function renderEmail(kind, request, data) {
  const { subject, body } = TEMPLATES[kind](request ?? {}, data);
  const text = body.map((part) => typeof part === 'string' ? part : [part.lead, part.url].filter(Boolean).join('\n')).join('\n\n') + '\n';
  const paragraph = (value) => `<p style="margin:0 0 16px">${escapeHtml(value).replaceAll('\n', '<br>')}</p>`;
  const html = `<!doctype html><html><body style="margin:0;padding:24px;font:16px/1.5 -apple-system,'Helvetica Neue',Arial,sans-serif;color:#111111;background:#ffffff">
${body.map((part) => typeof part === 'string' ? paragraph(part)
    : `${part.lead ? paragraph(part.lead) : ''}<p style="margin:0 0 16px"><a href="${escapeHtml(part.url)}" style="${BUTTON}">${escapeHtml(part.label)}</a></p>
<p style="margin:0 0 16px;font-size:13px;color:#555555;word-break:break-all">${escapeHtml(part.url)}</p>`).join('\n')}
</body></html>`;
  return { subject, text, html };
}

// One email's subject, text and HTML, with the links filled in for this site.
export const emailParts = (env, kind, request, data = {}) => renderEmail(kind, request, {
  ...data,
  page: request ? pageUrl(env, request) : null,
  share: request?.share_token ? shareUrl(env, request) : null,
  origin: siteOrigin(env)
});

// The INSERT for one email, for the caller's own db.batch, so an email exists if and only if the
// fact it announces does. With once_key it's ON CONFLICT DO NOTHING, so it exists once. `when`
// is an SQL condition that must hold at insert time (bound with whenArgs). The request's id is
// looked up by its token, so an email can go in the same batch as the request it's about.
export function queueEmail(env, kind, request, data = {}) {
  const now = data.now ?? new Date();
  const page = request ? pageUrl(env, request) : null;
  const to = TO_JONATHAN.has(kind) ? env.COMMISSION_NOTIFY_TO : request.buyer_email;
  if (!to) return null;
  const { subject, text, html } = emailParts(env, kind, request, data);
  const unsubscribe = kind === 'moved' ? `${page}/quiet` : null;
  return env.COMMISSIONS_DB.prepare(`INSERT INTO outbox
      (request_id, kind, once_key, position, to_email, subject, text, html, unsubscribe_url, created_at)
    SELECT (SELECT id FROM requests WHERE token = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?
    WHERE ${data.when ?? '1'}${data.onceKey ? ' ON CONFLICT (once_key) DO NOTHING' : ''}`)
    .bind(request?.token ?? null, kind, data.onceKey ?? null, data.position ?? null, to, subject, text, html,
      unsubscribe, now.toISOString(), ...(data.whenArgs ?? []));
}

// Emails to Jonathan rather than a buyer.
const TO_JONATHAN = new Set(['summary']);

// Sending again can't help these.
const PERMANENT = new Set(['E_RECIPIENT_SUPPRESSED', 'E_RECIPIENT_NOT_ALLOWED', 'E_VALIDATION_ERROR', 'E_FIELD_MISSING']);
// Sending itself isn't working: the domain isn't verified or onboarded yet, or the account is
// paused. No email is at fault, so the run stops and every email waits for the fix, rather
// than each one failing for good after five tries.
export const SENDING_BROKEN = new Set(['E_SENDER_NOT_VERIFIED', 'E_SENDER_DOMAIN_NOT_AVAILABLE', 'E_ACCOUNT_SUSPENDED']);
// The quota isn't the email's fault either: stop this run and try again later, counting nothing.
const STOP = new Set(['E_DAILY_LIMIT_EXCEEDED', 'E_RATE_LIMIT_EXCEEDED', ...SENDING_BROKEN]);
// Email Service down: this many in a row is an outage, so the run stops before every email
// spends a try on it. One on its own counts against that email, like any other error.
const OUTAGE_AFTER = 3;
const CLAIM_MINUTES = 10;

export const claimLapsedBefore = (now) => new Date(now.getTime() - CLAIM_MINUTES * 60_000).toISOString();

// Whether an email would only confuse them now, from its request as it is at send time.
function outOfDate(kind, request) {
  if (!request) return kind !== 'summary';
  switch (kind) {
    // A place in line for someone no longer waiting (delivered, being written, cancelled), or
    // who turned the updates off.
    case 'moved': return request.status !== 'requested' || Boolean(request.quiet);
    case 'received': return request.status === 'cancelled';
    // A song pulled back with Undo delivery, or cancelled since.
    case 'delivered': case 'updated': return request.status !== 'delivered';
    case 'reminder': return request.status !== 'delivered' || Boolean(request.paid_at);
    default: return false;
  }
}

// Sends unsent emails: one request's (after an action), some ids (the admin's Send now), or the
// rest (the daily cron), transactional mail before place-in-line updates, oldest first. Each
// email costs up to three D1 queries, and an invocation gets about 1,000 (D1's limit on Workers
// Paid), so the run stops when `budget` would run out; the rest go next time.
export async function flushOutbox(env, { requestId = null, ids = null, now = new Date(), limit = OUTBOX_BATCH, budget = D1_QUERY_BUDGET } = {}) {
  const db = env.COMMISSIONS_DB;
  const result = { sent: 0, failed: 0, deleted: 0, stopped: false };
  // No binding or sender: everything waits, and no attempt is counted.
  if (!db || !env.COMMISSION_EMAIL || !env.COMMISSION_FROM_EMAIL) return result;
  const lapsed = claimLapsedBefore(now);
  const filters = [];
  const args = [lapsed];
  if (requestId !== null) { filters.push('AND request_id = ?'); args.push(requestId); }
  if (ids) { filters.push(`AND id IN (${ids.map(() => '?').join(', ') || 'NULL'})`); args.push(...ids); }
  const { results } = await db.prepare(`SELECT * FROM outbox
    WHERE sent_at IS NULL AND failed_at IS NULL AND (claimed_at IS NULL OR claimed_at < ?) ${filters.join(' ')}
    ORDER BY (kind = 'moved'), id LIMIT ?`).bind(...args, limit).all();
  let queries = 1;

  // One clock for the whole run (the cron passes its scheduled time), so claims compare fairly.
  const at = now.toISOString();
  let outage = 0;
  for (const row of results) {
    if (queries + 3 > budget) {
      result.stopped = true;
      break;
    }
    const claim = await db.prepare(`UPDATE outbox SET claimed_at = ? WHERE id = ? AND sent_at IS NULL
      AND failed_at IS NULL AND (claimed_at IS NULL OR claimed_at < ?)`).bind(at, row.id, lapsed).run();
    queries++;
    if (claim.meta.changes !== 1) continue;

    if (row.request_id !== null) {
      const request = await db.prepare('SELECT status, quiet, paid_at FROM requests WHERE id = ?').bind(row.request_id).first();
      queries++;
      if (outOfDate(row.kind, request)) {
        await db.prepare('DELETE FROM outbox WHERE id = ?').bind(row.id).run();
        queries++;
        result.deleted++;
        continue;
      }
    }

    try {
      const sent = await env.COMMISSION_EMAIL.send({
        to: row.to_email,
        from: { email: env.COMMISSION_FROM_EMAIL, name: env.COMMISSION_FROM_NAME || 'Jonathan Mann' },
        ...(env.COMMISSION_REPLY_TO ? { replyTo: env.COMMISSION_REPLY_TO } : {}),
        subject: row.subject,
        text: row.text,
        html: row.html,
        // Email Service takes only https unsubscribe links, so local (http) ones are left off.
        ...(row.unsubscribe_url?.startsWith('https://') ? {
          headers: { 'List-Unsubscribe': `<${row.unsubscribe_url}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }
        } : {})
      });
      await db.prepare('UPDATE outbox SET sent_at = ?, message_id = ? WHERE id = ?')
        .bind(at, sent?.messageId ?? null, row.id).run();
      queries++;
      result.sent++;
      outage = 0;
    } catch (error) {
      // Only the code is kept, never the message: it can quote the address or the body.
      const code = typeof error?.code === 'string' ? error.code.slice(0, 64) : 'unknown';
      console.log('commission email', row.kind, row.id, code);
      queries++;
      if (STOP.has(code)) {
        await db.prepare('UPDATE outbox SET claimed_at = NULL, last_error = ? WHERE id = ?').bind(code, row.id).run();
        result.stopped = true;
        break;
      }
      const attempts = row.attempts + 1;
      const failed = PERMANENT.has(code) || attempts >= OUTBOX_MAX_ATTEMPTS;
      await db.prepare(`UPDATE outbox SET attempts = ?, last_error = ?, claimed_at = NULL, failed_at = ? WHERE id = ?`)
        .bind(attempts, code, failed ? at : null, row.id).run();
      if (failed) result.failed++;
      outage = code === 'E_INTERNAL_SERVER_ERROR' ? outage + 1 : 0;
      if (outage >= OUTAGE_AFTER) {
        result.stopped = true;
        break;
      }
    }
  }
  return result;
}
