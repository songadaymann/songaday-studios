// songaday.studio/commission/admin: Jonathan's queue, behind Cloudflare Access. The Worker checks
// the Access token itself (RS256 against the team's certs, with the application's audience) and
// an ADMIN_EMAILS allowlist behind it, and fails closed: without Access set up, the admin works
// only on localhost (wrangler dev). The pages render on the server and run no script at all.
import { escapeHtml } from './fumble-page.mjs';
import { serveMedia } from './media.mjs';
import { ADMIN_PAGE_SIZE, AMOUNT_MAX_CENTS, DELIVER_MAX_BYTES, LIMITS, SONG_MAX_BYTES } from './commission-config.mjs';
import {
  IN_LINE, LOCAL_HOSTS, cleanLine, cleanText, daysBetween, dollars, later, loadRequest, newYorkDate,
  pageUrl, parseDollars, parseMoney, placeInLine, randomHex, readForm, shortDate, sniffAudio, transitionProblem
} from './commission-core.mjs';
import { flushOutbox, queueEmail } from './commission-email.mjs';
import { recordPayment } from './commission-stripe.mjs';

// ---- Access ---------------------------------------------------------------------------------

const HOUR = 3_600_000;
const MINUTE = 60_000;
// Per team domain: { jwks: Map(kid → JWK), keys: Map(kid → CryptoKey), fetchedAt, missFetchedAt }.
const certCache = new Map();

const utf8 = (text) => new TextEncoder().encode(text);
function base64urlBytes(text) {
  const base64 = text.replaceAll('-', '+').replaceAll('_', '/');
  return Uint8Array.from(atob(base64 + '='.repeat((4 - base64.length % 4) % 4)), (char) => char.charCodeAt(0));
}
const base64urlJson = (text) => JSON.parse(new TextDecoder().decode(base64urlBytes(text)));

async function fetchCerts(team) {
  try {
    const response = await fetch(`${team}/cdn-cgi/access/certs`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return null;
    const { keys } = await response.json();
    return new Map((Array.isArray(keys) ? keys : []).filter((jwk) => jwk?.kid).map((jwk) => [jwk.kid, jwk]));
  } catch {
    return null;
  }
}

// Certs are kept for an hour and fetched again once on an unknown kid (Access rotates its keys
// every six weeks), at most once a minute, so junk tokens can't make every request a fetch.
async function accessKey(team, kid) {
  const now = Date.now();
  let entry = certCache.get(team);
  if (!entry || now - entry.fetchedAt > HOUR) {
    const jwks = await fetchCerts(team);
    if (!jwks) return null;
    entry = { jwks, keys: new Map(), fetchedAt: now, missFetchedAt: entry?.missFetchedAt ?? 0 };
    certCache.set(team, entry);
  } else if (!entry.jwks.has(kid) && now - entry.missFetchedAt > MINUTE) {
    entry.missFetchedAt = now;
    const jwks = await fetchCerts(team);
    if (jwks) Object.assign(entry, { jwks, keys: new Map(), fetchedAt: now });
  }
  const jwk = entry.jwks.get(kid);
  if (!jwk) return null;
  if (!entry.keys.has(kid)) {
    entry.keys.set(kid, await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']));
  }
  return entry.keys.get(kid);
}

export async function verifyAccessJwt(token, team, audience) {
  const parts = typeof token === 'string' ? token.split('.') : [];
  if (parts.length !== 3) return null;
  try {
    const header = base64urlJson(parts[0]);
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') return null;
    const key = await accessKey(team, header.kid);
    if (!key) return null;
    if (!(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, base64urlBytes(parts[2]), utf8(`${parts[0]}.${parts[1]}`)))) return null;
    const payload = base64urlJson(parts[1]);
    const now = Date.now() / 1000;
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!audiences.includes(audience)) return null;   // a token for another Access app on the team fails
    if (payload.iss !== team) return null;
    if (!(payload.exp > now - 60)) return null;
    if (payload.nbf !== undefined && payload.nbf > now + 60) return null;
    return payload;
  } catch {
    return null;
  }
}

// Who is signed in, or null. The email must also be in ADMIN_EMAILS: an Access policy that's
// wider than meant (an "Everyone" rule with one-time PINs) would pass every check above.
export async function accessIdentity(request, env, url) {
  const team = String(env.ACCESS_TEAM_DOMAIN ?? '').trim().replace(/\/+$/, '');
  const audience = String(env.ACCESS_AUD ?? '').trim();
  if (!team || !audience) return url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname) ? 'local' : null;
  const payload = await verifyAccessJwt(request.headers.get('Cf-Access-Jwt-Assertion'), team, audience);
  if (!payload) return null;
  const email = String(payload.email ?? '').trim().toLowerCase();
  const allowed = String(env.ADMIN_EMAILS ?? '').split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  return email && allowed.includes(email) ? email : null;
}

// ---- Responses ------------------------------------------------------------------------------

const ADMIN_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  // Not no-referrer: under that, browsers send "Origin: null" on the page's own form posts, and
  // the CSRF check below would refuse every one of them.
  'Referrer-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; media-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
};

const PRIVATE_MEDIA = {
  cacheControl: 'private, no-store',
  // The memo is a stranger's bytes on the admin's origin: even a file that got past the sniffer
  // can't run as a page here.
  headers: { 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': 'sandbox' }
};

const STYLE = `
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: #f6f4ef; color: #111; font: 18px/1.5 -apple-system, "Helvetica Neue", Arial, sans-serif; }
a { color: #b0102b; }
header { padding: 12px 16px; background: #000; color: #fff; border-bottom: 4px solid #ff2445; }
header a { color: #fff; }
header p { margin: 0; font-size: 14px; }
header strong { font-size: 18px; }
main { max-width: 860px; margin: 0 auto; padding: 16px 16px 64px; }
h1 { font-size: 28px; line-height: 1.2; margin: 8px 0 16px; }
h2 { font-size: 22px; margin: 32px 0 12px; }
h3 { font-size: 18px; margin: 0 0 8px; }
.stats { display: flex; flex-wrap: wrap; gap: 8px 20px; margin: 0 0 12px; padding: 0; list-style: none; font-size: 15px; }
.stats .alert { color: #b0102b; font-weight: 700; }
nav.tabs { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 20px; }
nav.tabs a { padding: 6px 10px; border: 2px solid #111; color: #111; text-decoration: none; font-size: 15px; font-weight: 700; }
nav.tabs a[aria-current] { background: #111; color: #fff; }
.card { margin: 0 0 20px; padding: 16px; background: #fff; border: 2px solid #111; overflow-wrap: anywhere; }
.meta { margin: 0 0 12px; font-size: 15px; }
.tag { display: inline-block; padding: 0 6px; background: #111; color: #fff; font-size: 13px; font-weight: 700; letter-spacing: .04em; }
.tag.soon { background: #ff2445; }
.tag.passed { background: #7a0016; }
dl { display: grid; grid-template-columns: minmax(0, 9em) minmax(0, 1fr); gap: 6px 16px; margin: 0; }
dt { font-weight: 700; color: #555; font-size: 15px; padding-top: 2px; }
dd { margin: 0; }
dd p { margin: 0 0 .7em; }
dd p:last-child { margin-bottom: 0; }
.actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-top: 16px; }
.actions form { margin: 0; }
button, .button { display: inline-block; padding: 10px 16px; border: 2px solid #111; background: #111; color: #fff; font: 700 16px/1.2 inherit; font-family: inherit; text-decoration: none; cursor: pointer; }
button.quiet, .button.quiet { background: #fff; color: #111; }
button.danger { background: #b0102b; border-color: #b0102b; }
form.panel { margin: 0 0 24px; padding: 16px; background: #fff; border: 2px solid #111; }
label { display: block; margin: 0 0 14px; font-weight: 700; }
label span { display: block; font-weight: 400; font-size: 15px; color: #555; }
input[type=text], input[type=url], input[type=email], textarea, select { display: block; width: 100%; margin-top: 4px; padding: 10px; border: 2px solid #111; border-radius: 0; background: #fff; font: inherit; }
input[type=file] { display: block; margin-top: 4px; max-width: 100%; font-size: 16px; }
label.check { display: flex; gap: 10px; align-items: center; font-weight: 400; }
textarea { min-height: 8em; resize: vertical; }
audio { display: block; width: 100%; margin: 8px 0; }
.done { padding: 10px 14px; background: #e6f4e6; border: 2px solid #1d6b1d; }
.problem { padding: 10px 14px; background: #fde8eb; border: 2px solid #b0102b; }
table { width: 100%; border-collapse: collapse; font-size: 15px; }
th, td { padding: 6px 8px; border-bottom: 1px solid #ccc; text-align: left; vertical-align: top; }
.table { overflow-x: auto; }
.link { font: 14px/1.4 ui-monospace, Menlo, monospace; word-break: break-all; user-select: all; background: #fff; padding: 8px; border: 1px dashed #111; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; background: #fff; padding: 12px; border: 1px solid #111; font-size: 15px; }
details { margin: 0 0 16px; }
summary { cursor: pointer; font-weight: 700; }
.pager { display: flex; justify-content: space-between; margin-top: 16px; }
@media (max-width: 560px) {
  dl { grid-template-columns: minmax(0, 1fr); gap: 0; }
  dt { margin-top: 10px; }
}
`;

function layout(title, identity, body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)} · Commissions</title>
<style>${STYLE}</style>
</head>
<body>
<header><p><strong><a href="/commission/admin">Commissions</a></strong> · Signed in as ${escapeHtml(identity === 'local' ? 'local (wrangler dev)' : identity)}</p></header>
<main>
${body}
</main>
</body>
</html>
`;
}

const html = (request, body, status = 200) =>
  new Response(request.method === 'HEAD' ? null : body, { status, headers: ADMIN_HEADERS });
const forbidden = (text = 'The admin isn’t set up yet, or you’re not signed in.') =>
  new Response(`<!doctype html><meta charset="utf-8"><title>Not allowed</title><p>${escapeHtml(text)}</p>`, { status: 403, headers: ADMIN_HEADERS });
const back = (location) => new Response(null, { status: 303, headers: { Location: location, 'Cache-Control': 'no-store' } });

function problemPage(request, identity, text, status, id) {
  return html(request, layout('That didn’t work', identity, `<p class="problem" role="alert">${escapeHtml(text)}</p>
<p><a href="${id ? `/commission/admin/${id}` : '/commission/admin'}">Go back</a></p>`), status);
}

// ---- Shared pieces --------------------------------------------------------------------------

const text = (value) => String(value ?? '').split(/\n{2,}/).filter(Boolean)
  .map((part) => `<p>${escapeHtml(part).replaceAll('\n', '<br>')}</p>`).join('');

function deadlineTag(request, today) {
  if (!request.deadline) return '';
  const days = daysBetween(today, request.deadline);
  if (days < 0) return ` · <span class="tag passed">DEADLINE ${escapeHtml(shortDate(request.deadline))} (passed)</span>`;
  const soon = days <= 7 ? ' soon' : '';
  return ` · <span class="tag${soon}">DEADLINE ${escapeHtml(shortDate(request.deadline))} (${days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'}`})</span>`;
}

const STATUS_WORDS = { requested: 'in line', writing: 'being written', delivered: 'delivered', cancelled: 'cancelled' };

// Every answer, in full, so Jonathan can write from the card. Links in answers stay plain text.
function card(request, { position = null, today, now, full = false }) {
  const where = position ? `#${position} in line` : STATUS_WORDS[request.status];
  const meta = [
    `<strong>${escapeHtml(where)}</strong>`,
    `received ${escapeHtml(shortDate(request.requested_at, now))}`,
    `<span class="tag">${request.kind === 'business' ? 'BUSINESS' : 'PERSONAL'}</span>`,
    request.may_publish ? 'OK to be Song A Day' : 'Private',
    request.wants_video ? '<span class="tag">VIDEO WANTED</span>' : '',
    request.status === 'writing' ? '<span class="tag">WRITING</span>' : '',
    request.paid_at ? '<span class="tag">PAID</span>' : '',
    request.archived_at ? 'archived' : ''
  ].filter(Boolean).join(' · ') + deadlineTag(request, today);
  const memo = request.memo_key
    ? `<p>Voice memo:</p><audio controls preload="none" src="/commission/admin/${request.id}/memo"></audio>` : '';
  const rows = [
    ['For', escapeHtml(request.recipient + (request.relationship ? `, ${request.relationship}` : ''))],
    ['Occasion', escapeHtml(request.occasion)],
    ['Names', text(request.names) + memo],
    ['The story', text(request.story)],
    ['Leave out', text(request.leave_out)],
    ['Deadline', request.deadline ? escapeHtml(shortDate(request.deadline, now)) : ''],
    ['From', `${escapeHtml(request.buyer_name)} · ${escapeHtml(request.buyer_email)}`],
    ['Least to pay', escapeHtml(dollars(request.floor_cents))],
    ['Song', request.title ? `“${escapeHtml(request.title)}”` : ''],
    ['My note', text(request.admin_note)]
  ].filter(([, value]) => value);
  const actions = full ? '' : `<div class="actions">
    ${request.status === 'requested' ? `<form method="post" action="/commission/admin/${request.id}"><input type="hidden" name="action" value="writing"><button type="submit" class="quiet">Start writing</button></form>` : ''}
    <a class="button" href="/commission/admin/${request.id}">Open &amp; deliver →</a>
  </div>`;
  return `<article class="card" id="r${request.id}">
  <p class="meta">${meta}</p>
  <dl>
${rows.map(([label, value]) => `    <dt>${label}</dt><dd>${value}</dd>`).join('\n')}
  </dl>
  ${actions}
</article>`;
}

const TABS = [
  ['line', 'In line'], ['delivered', 'Delivered'], ['paid', 'Paid'], ['plans', 'Monthly plans'],
  ['cancelled', 'Cancelled'], ['archived', 'Archived']
];

const LISTS = {
  line: { where: IN_LINE, order: 'id' },
  delivered: { where: "status = 'delivered' AND paid_at IS NULL AND archived_at IS NULL", order: 'delivered_at' },
  paid: { where: 'paid_at IS NOT NULL AND archived_at IS NULL', order: 'paid_at DESC' },
  cancelled: { where: "status = 'cancelled' AND archived_at IS NULL", order: 'cancelled_at DESC' },
  archived: { where: 'archived_at IS NOT NULL', order: 'archived_at DESC' }
};

async function stats(db, now) {
  const month = newYorkDate(now).slice(0, 7);
  const [line, delivered, paid, waiting, failed] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(status = 'writing'), 0) AS writing FROM requests WHERE ${IN_LINE}`).first(),
    db.prepare("SELECT COUNT(*) AS count FROM requests WHERE status = 'delivered' AND paid_at IS NULL AND archived_at IS NULL").first('count'),
    // A month in New York, near enough: payments are stored in UTC.
    db.prepare('SELECT COALESCE(SUM(amount_cents), 0) AS cents, COUNT(DISTINCT request_id) AS songs FROM payments WHERE substr(paid_at, 1, 7) = ?').bind(month).first(),
    db.prepare('SELECT COUNT(*) AS count FROM outbox WHERE sent_at IS NULL AND failed_at IS NULL').first('count'),
    db.prepare('SELECT COUNT(*) AS count FROM outbox WHERE failed_at IS NOT NULL').first('count')
  ]);
  return { line, delivered, paid, waiting, failed };
}

async function top(db, now, current) {
  const s = await stats(db, now);
  const counts = await Promise.all(TABS.map(([name]) => name === 'plans'
    ? db.prepare('SELECT COUNT(*) AS count FROM plans').first('count')
    : db.prepare(`SELECT COUNT(*) AS count FROM requests WHERE ${LISTS[name].where}`).first('count')));
  const emails = s.waiting + s.failed;
  return `<ul class="stats">
  <li>In line ${s.line.total} (${s.line.writing} being written)</li>
  <li>Delivered, not paid ${s.delivered}</li>
  <li>Paid this month ${escapeHtml(dollars(s.paid.cents))} across ${s.paid.songs} song${s.paid.songs === 1 ? '' : 's'}</li>
  <li${emails ? ' class="alert"' : ''}><a href="/commission/admin/emails">Emails waiting ${s.waiting}${s.failed ? `, failed ${s.failed}` : ''}</a></li>
</ul>
<nav class="tabs" aria-label="Lists">
${TABS.map(([name, label], index) => `  <a href="/commission/admin${name === 'line' ? '' : `?show=${name}`}"${current === name ? ' aria-current="page"' : ''}>${label} ${counts[index]}</a>`).join('\n')}
  <a href="/commission/admin/emails"${current === 'emails' ? ' aria-current="page"' : ''}>Emails</a>
</nav>`;
}

// ---- Pages ----------------------------------------------------------------------------------

async function queuePage(request, env, url, identity, now) {
  const db = env.COMMISSIONS_DB;
  const show = TABS.some(([name]) => name === url.searchParams.get('show')) ? url.searchParams.get('show') : 'line';
  const pageNumber = Math.max(1, Math.min(10_000, Number.parseInt(url.searchParams.get('page'), 10) || 1));
  const offset = (pageNumber - 1) * ADMIN_PAGE_SIZE;
  const today = newYorkDate(now);
  let list;
  let more;
  if (show === 'plans') {
    const { results } = await db.prepare(`SELECT p.*, r.title, r.recipient, r.buyer_name,
        (SELECT COUNT(*) FROM payments WHERE subscription_id = p.subscription_id) AS paid_count
      FROM plans p JOIN requests r ON r.id = p.request_id ORDER BY p.started_at DESC LIMIT ? OFFSET ?`)
      .bind(ADMIN_PAGE_SIZE + 1, offset).all();
    more = results.length > ADMIN_PAGE_SIZE;
    list = results.slice(0, ADMIN_PAGE_SIZE).map((plan) => `<article class="card">
  <p class="meta"><strong>${plan.paid_count} of ${plan.months} paid</strong> · ${escapeHtml(plan.status)}${plan.status === 'active' && !plan.schedule_id ? ' · <span class="tag soon">NO END SET</span>' : ''} · ${escapeHtml(dollars(plan.monthly_cents))} a month · started ${escapeHtml(shortDate(plan.started_at, now))}</p>
  <p><a href="/commission/admin/${plan.request_id}">#${plan.request_id} “${escapeHtml(plan.title ?? '')}” for ${escapeHtml(plan.recipient)}</a> · ${escapeHtml(plan.buyer_name)}</p>
</article>`).join('\n') || '<p>No monthly plans.</p>';
  } else {
    const { where, order } = LISTS[show];
    const { results } = await db.prepare(`SELECT *,
        (SELECT COALESCE(SUM(amount_cents), 0) FROM payments WHERE request_id = requests.id) AS paid_cents,
        (SELECT group_concat(DISTINCT method) FROM payments WHERE request_id = requests.id) AS methods,
        (SELECT COUNT(*) FROM payments WHERE request_id = requests.id AND kind = 'extra') AS extras
      FROM requests WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`).bind(ADMIN_PAGE_SIZE + 1, offset).all();
    more = results.length > ADMIN_PAGE_SIZE;
    list = results.slice(0, ADMIN_PAGE_SIZE).map((row, index) => {
      const extra = show === 'delivered'
        ? `<p class="meta">Delivered ${daysBetween(newYorkDate(row.delivered_at), today)} days ago · ${row.reminded_at ? 'reminder sent' : 'no reminder yet'}</p>`
        : show === 'paid'
          ? `<p class="meta">Paid ${escapeHtml(dollars(row.paid_cents))} by ${escapeHtml(row.methods ?? '')}${row.extras ? ` · ${row.extras} extra` : ''}</p>`
          : '';
      return extra + card(row, { position: show === 'line' ? offset + index + 1 : null, today, now });
    }).join('\n') || `<p>${show === 'line' ? 'Nobody’s in line.' : 'Nothing here.'}</p>`;
  }
  const pager = `<p class="pager">${pageNumber > 1 ? `<a href="?show=${show}&amp;page=${pageNumber - 1}">← Earlier</a>` : '<span></span>'}${more ? `<a href="?show=${show}&amp;page=${pageNumber + 1}">Later →</a>` : ''}</p>`;
  const label = TABS.find(([name]) => name === show)[1];
  return html(request, layout(label, identity, `${await top(db, now, show)}
<h1>${label}</h1>
${list}
${pager}`));
}

const DONE = {
  writing: 'Marked as being written.', deliver: 'Delivered.', undeliver: 'Delivery undone. It’s back in line, being written.',
  paid: 'Payment recorded.', cancel: 'Cancelled.', restore: 'Back in line, in its old place.', archive: 'Archived.',
  unarchive: 'Unarchived.', edit: 'Saved.', send: 'Sent, or queued to send.'
};

function timeline(request, now) {
  const events = [
    ['Received', request.requested_at], ['Writing', request.writing_at], ['Delivered', request.delivered_at],
    ['Paid', request.paid_at], ['Reminder sent', request.reminded_at],
    ['Cancelled' + (request.cancelled_by ? ` by ${request.cancelled_by}` : ''), request.cancelled_at],
    ['Archived', request.archived_at]
  ].filter(([, at]) => at);
  return `<ul>${events.map(([label, at]) => `<li>${escapeHtml(label)} ${escapeHtml(shortDate(at, now))}</li>`).join('')}</ul>`;
}

const hidden = (name, value) => `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`;
const button = (action, label, className = '', fields = '') => `<form method="post" action="?">${hidden('action', action)}${fields}<button type="submit"${className ? ` class="${className}"` : ''}>${label}</button></form>`;

async function detailPage(request, env, url, identity, now, id) {
  const db = env.COMMISSIONS_DB;
  const r = await loadRequest(db, id);
  if (!r) return problemPage(request, identity, 'There’s no request with that number.', 404);
  const today = newYorkDate(now);
  const position = ['requested', 'writing'].includes(r.status) ? await placeInLine(db, r.id) : null;
  const [{ results: payments }, { results: emails }, { results: plans }] = await Promise.all([
    db.prepare('SELECT * FROM payments WHERE request_id = ? ORDER BY id').bind(id).all(),
    db.prepare('SELECT id, kind, subject, created_at, sent_at, failed_at, attempts, last_error FROM outbox WHERE request_id = ? ORDER BY id DESC').bind(id).all(),
    db.prepare('SELECT * FROM plans WHERE request_id = ? ORDER BY started_at').bind(id).all()
  ]);
  const done = DONE[url.searchParams.get('done')];
  const allowed = (action) => !transitionProblem(r, action);
  const delivered = r.status === 'delivered';

  const deliver = allowed('deliver') ? `<h2 id="deliver">${delivered ? 'The song' : 'Deliver'}</h2>
${delivered ? `<p>Now playing for them: “${escapeHtml(r.title)}”</p>
<audio controls preload="none" src="/commission/admin/${r.id}/audio"></audio>
${allowed('undeliver') ? `<details><summary>Undo delivery</summary><p>For a song delivered to the wrong request: deletes the file and puts this one back in line, being written. No email goes out; if they already got the link, write to them yourself.</p>${button('undeliver', 'Undo delivery', 'danger')}</details>` : ''}` : ''}
<form class="panel" method="post" action="?" enctype="multipart/form-data">
  ${hidden('action', 'deliver')}${hidden('form_id', randomHex(16))}
  <label>Title<input type="text" name="title" maxlength="${LIMITS.title}" required value="${escapeHtml(r.title ?? '')}"></label>
  <label>Song file <span>MP3, M4A or WAV, up to ${SONG_MAX_BYTES / 1024 / 1024} MB${delivered ? '. Leave it empty to keep the current one.' : '.'}</span><input type="file" name="song" accept="audio/*"${delivered ? '' : ' required'}></label>
  <label>Lyrics<textarea name="lyrics" maxlength="${LIMITS.lyrics}" rows="10">${escapeHtml(r.lyrics ?? '')}</textarea></label>
  <label>Video link <span>Optional, https only (an unlisted YouTube link, say).</span><input type="url" name="video_url" maxlength="${LIMITS.video_url}" value="${escapeHtml(r.video_url ?? '')}"></label>
  <label class="check"><input type="checkbox" name="email_them" value="yes" checked> Email them</label>
  <button type="submit">${delivered ? 'Save changes' : 'Deliver'}</button>
</form>` : '';

  const markPaid = allowed('paid') ? `<h2>Mark paid</h2>
<form class="panel" method="post" action="?">
  ${hidden('action', 'paid')}${hidden('form_id', randomHex(16))}
  <label>Amount in dollars<input type="text" name="amount" inputmode="numeric" required></label>
  <label>How<select name="method"><option value="venmo">Venmo</option><option value="paypal">PayPal</option><option value="other">Other</option></select></label>
  <label>Note<input type="text" name="note" maxlength="${LIMITS.note}"></label>
  <label class="check"><input type="checkbox" name="email_them" value="yes" checked> Email them a thank-you</label>
  <button type="submit">Mark paid</button>
</form>` : '';

  const paymentRows = payments.map((payment) => `<tr><td>${escapeHtml(shortDate(payment.paid_at, now))}</td><td>${escapeHtml(payment.kind)}</td><td>${escapeHtml(dollars(payment.amount_cents))}</td><td>${escapeHtml(payment.method)}</td><td>${escapeHtml(payment.note)}</td></tr>`).join('');
  const planLines = plans.map((plan) => `<li>${payments.filter((payment) => payment.subscription_id === plan.subscription_id).length} of ${plan.months} monthly payments of ${escapeHtml(dollars(plan.monthly_cents))} · ${escapeHtml(plan.status)}</li>`).join('');

  const edit = `<h2>Edit</h2>
<form class="panel" method="post" action="?">
  ${hidden('action', 'edit')}
  <label>The least they can pay, in dollars<input type="text" name="floor" inputmode="numeric" required value="${r.floor_cents / 100}"></label>
  <label>OK to be that day’s Song A Day?<select name="may_publish"><option value="yes"${r.may_publish ? ' selected' : ''}>Yes</option><option value="no"${r.may_publish ? '' : ' selected'}>No, private</option></select></label>
  <label class="check"><input type="checkbox" name="wants_video" value="yes"${r.wants_video ? ' checked' : ''}> Video wanted</label>
  <label>My note <span>They never see this.</span><textarea name="admin_note" maxlength="${LIMITS.note}" rows="3">${escapeHtml(r.admin_note)}</textarea></label>
  <button type="submit" class="quiet">Save</button>
</form>`;

  const moves = [
    allowed('writing') ? button('writing', 'Start writing', 'quiet') : '',
    allowed('restore') ? button('restore', 'Put back in line', 'quiet', hidden('form_id', randomHex(16))) : '',
    allowed('archive') ? button('archive', 'Archive', 'quiet') : '',
    allowed('unarchive') ? button('unarchive', 'Unarchive', 'quiet') : ''
  ].filter(Boolean).join('\n');
  const cancel = allowed('cancel') ? `<details><summary>Cancel this request</summary>
<form class="panel" method="post" action="?">
  ${hidden('action', 'cancel')}
  <label>Message to them <span>Optional. It goes into the email.</span><textarea name="message" maxlength="${LIMITS.message}" rows="3"></textarea></label>
  <button type="submit" class="danger">Cancel it</button>
</form></details>` : '';

  const emailRows = emails.map((email) => `<tr><td>${escapeHtml(email.kind)}</td><td>${escapeHtml(email.subject)}</td><td>${emailStatus(email, now)}</td><td><a href="/commission/admin/emails/${email.id}">View</a></td><td><form method="post" action="/commission/admin/emails/${email.id}">${hidden('action', 'send')}<button type="submit" class="quiet">${email.sent_at || email.failed_at ? 'Resend' : 'Send now'}</button></form></td></tr>`).join('');

  return html(request, layout(`#${r.id}`, identity, `<p><a href="/commission/admin">← The line</a></p>
${done ? `<p class="done" role="status">${escapeHtml(done)}</p>` : ''}
<h1>#${r.id} for ${escapeHtml(r.recipient)}</h1>
${card(r, { position, today, now, full: true })}
${deliver}
${markPaid}
${payments.length || plans.length ? `<h2>Payments</h2>${planLines ? `<ul>${planLines}</ul>` : ''}${paymentRows ? `<div class="table"><table><thead><tr><th>Date</th><th>Kind</th><th>Amount</th><th>How</th><th>Note</th></tr></thead><tbody>${paymentRows}</tbody></table></div>` : ''}` : ''}
<h2>Timeline</h2>
${timeline(r, now)}
<p>Their page:</p>
<p class="link">${escapeHtml(pageUrl(env, r))}</p>
${moves ? `<div class="actions">${moves}</div>` : ''}
${cancel}
${edit}
<h2>Emails</h2>
${emailRows ? `<div class="table"><table><thead><tr><th>Kind</th><th>Subject</th><th>Status</th><th></th><th></th></tr></thead><tbody>${emailRows}</tbody></table></div>` : '<p>None yet.</p>'}`));
}

function emailStatus(email, now) {
  if (email.sent_at) return `sent ${escapeHtml(shortDate(email.sent_at, now))}`;
  if (email.failed_at) return `<strong>failed</strong> (${escapeHtml(email.last_error ?? '')})`;
  return `<strong>waiting</strong>${email.attempts ? ` (${email.attempts} tries, ${escapeHtml(email.last_error ?? '')})` : ''}`;
}

async function emailsPage(request, env, url, identity, now) {
  const db = env.COMMISSIONS_DB;
  const pageNumber = Math.max(1, Math.min(10_000, Number.parseInt(url.searchParams.get('page'), 10) || 1));
  const { results } = await db.prepare(`SELECT id, request_id, kind, to_email, subject, created_at, sent_at, failed_at, attempts, last_error
    FROM outbox ORDER BY (sent_at IS NOT NULL), id DESC LIMIT ? OFFSET ?`).bind(51, (pageNumber - 1) * 50).all();
  const rows = results.slice(0, 50).map((email) => `<tr><td>${escapeHtml(email.to_email)}</td><td>${escapeHtml(email.subject)}</td><td>${escapeHtml(email.kind)}</td><td>${email.request_id ? `<a href="/commission/admin/${email.request_id}">#${email.request_id}</a>` : ''}</td><td>${emailStatus(email, now)}</td><td><a href="/commission/admin/emails/${email.id}">View</a></td><td><form method="post" action="/commission/admin/emails/${email.id}">${hidden('action', 'send')}<button type="submit" class="quiet">${email.sent_at || email.failed_at ? 'Resend' : 'Send now'}</button></form></td></tr>`).join('');
  const sending = env.COMMISSION_EMAIL && env.COMMISSION_FROM_EMAIL ? '' : '<p class="problem">Email isn’t set up here, so every email waits. Open one to read it and follow its link.</p>';
  return html(request, layout('Emails', identity, `${await top(db, now, 'emails')}
<h1>Emails</h1>
${url.searchParams.has('done') ? `<p class="done" role="status">${DONE.send}</p>` : ''}
${sending}
${rows ? `<div class="table"><table><thead><tr><th>To</th><th>Subject</th><th>Kind</th><th>Request</th><th>Status</th><th></th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p>No emails yet.</p>'}
<p class="pager">${pageNumber > 1 ? `<a href="?page=${pageNumber - 1}">← Newer</a>` : '<span></span>'}${results.length > 50 ? `<a href="?page=${pageNumber + 1}">Older →</a>` : ''}</p>`));
}

async function emailPage(request, env, identity, now, id) {
  const email = await env.COMMISSIONS_DB.prepare('SELECT * FROM outbox WHERE id = ?').bind(id).first();
  if (!email) return problemPage(request, identity, 'There’s no email with that number.', 404);
  return html(request, layout(email.subject, identity, `<p><a href="/commission/admin/emails">← Emails</a></p>
<h1>${escapeHtml(email.subject)}</h1>
<p>To ${escapeHtml(email.to_email)} · ${escapeHtml(email.kind)} · ${emailStatus(email, now)}${email.request_id ? ` · <a href="/commission/admin/${email.request_id}">#${email.request_id}</a>` : ''}</p>
<pre>${escapeHtml(email.text)}</pre>
<form method="post" action="/commission/admin/emails/${email.id}">${hidden('action', 'send')}<button type="submit">${email.sent_at || email.failed_at ? 'Resend' : 'Send now'}</button></form>`));
}

// ---- Actions --------------------------------------------------------------------------------

const FORM_ID = /^[0-9a-f]{16,64}$/;

// Validates and stores a song upload. Returns { key, type } or { status, error }.
async function storeSong(env, request, file) {
  if (file.size > SONG_MAX_BYTES) return { status: 413, error: `That file is over ${SONG_MAX_BYTES / 1024 / 1024} MB. Send it as an MP3.` };
  const sniffed = sniffAudio(new Uint8Array(await file.slice(0, 12).arrayBuffer()));
  if (!sniffed) return { status: 400, error: 'That doesn’t look like an audio file (MP3, M4A or WAV).' };
  const key = `songs/${request.id}/${randomHex(8)}.${sniffed.ext}`;
  await env.COMMISSION_FILES.put(key, file, { httpMetadata: { contentType: sniffed.type } });
  return { key };
}

async function act(request, env, url, ctx, identity, now, id) {
  const db = env.COMMISSIONS_DB;
  const r = await loadRequest(db, id);
  if (!r) return problemPage(request, identity, 'There’s no request with that number.', 404);
  const { form, status, error } = await readForm(request, DELIVER_MAX_BYTES);
  if (!form) return problemPage(request, identity, status === 413 ? `That’s over ${SONG_MAX_BYTES / 1024 / 1024} MB. Send the song as an MP3.` : error, status, id);
  const action = String(form.get('action') ?? '');
  const problem = transitionProblem(r, action);
  if (problem) return problemPage(request, identity, problem, action in DONE ? 409 : 400, id);
  const at = now.toISOString();
  const formId = String(form.get('form_id') ?? '');
  const refuse = (text, code = 400) => problemPage(request, identity, text, code, id);
  const done = () => {
    later(ctx, flushOutbox(env, { requestId: r.id }));
    return back(`/commission/admin/${r.id}?done=${action}`);
  };

  switch (action) {
    case 'writing':
      await db.prepare("UPDATE requests SET status = 'writing', writing_at = ? WHERE id = ? AND status = 'requested'").bind(at, r.id).run();
      return done();

    case 'deliver': {
      if (!FORM_ID.test(formId)) return refuse('That form is missing its id. Reload the page and try again.');
      const title = cleanLine(form.get('title'));
      const lyrics = cleanText(form.get('lyrics'));
      const videoUrl = cleanLine(form.get('video_url'));
      if (!title) return refuse('Give the song a title.');
      if (title.length > LIMITS.title) return refuse(`Keep the title under ${LIMITS.title} characters.`);
      if (lyrics.length > LIMITS.lyrics) return refuse(`The lyrics can be up to ${LIMITS.lyrics.toLocaleString('en-US')} characters.`);
      if (videoUrl && (videoUrl.length > LIMITS.video_url || !/^https:\/\/[^\s<>"]+$/.test(videoUrl) || !URL.canParse(videoUrl))) return refuse('The video link must be an https address.');
      const file = form.get('song');
      const hasFile = file && typeof file === 'object' && file.size > 0;
      if (!hasFile && !r.audio_key) return refuse('Add the song file.');
      if (hasFile && !env.COMMISSION_FILES) return refuse('The song bucket isn’t set up (COMMISSION_FILES).', 503);
      let key = r.audio_key;
      if (hasFile) {
        const stored = await storeSong(env, r, file);
        if (!stored.key) return refuse(stored.error, stored.status);
        key = stored.key;
      }
      const first = r.status !== 'delivered';
      const updated = { ...r, status: 'delivered', title, lyrics, audio_key: key, video_url: videoUrl || null };
      const statements = [db.prepare(`UPDATE requests SET status = 'delivered', title = ?, lyrics = ?, audio_key = ?, video_url = ?,
          delivered_at = COALESCE(delivered_at, ?) WHERE id = ? AND status IN ('requested', 'writing', 'delivered')`)
        .bind(title, lyrics, key, videoUrl || null, at, r.id)];
      if (form.get('email_them') === 'yes') {
        // Keyed by the form, so a double click sends one email.
        statements.push(queueEmail(env, first ? 'delivered' : 'updated', updated, { now, onceKey: `deliver:${r.id}:${formId}` }));
      }
      await db.batch(statements);
      if (hasFile && r.audio_key && r.audio_key !== key) await env.COMMISSION_FILES.delete(r.audio_key);
      return done();
    }

    case 'undeliver': {
      const result = await db.prepare(`UPDATE requests SET status = 'writing', title = NULL, lyrics = NULL, audio_key = NULL,
          video_url = NULL, delivered_at = NULL, reminded_at = NULL, writing_at = COALESCE(writing_at, ?)
        WHERE id = ? AND status = 'delivered' AND paid_at IS NULL`).bind(at, r.id).run();
      if (result.meta.changes && r.audio_key && env.COMMISSION_FILES) await env.COMMISSION_FILES.delete(r.audio_key);
      return done();
    }

    case 'paid': {
      if (!FORM_ID.test(formId)) return refuse('That form is missing its id. Reload the page and try again.');
      const amount = parseMoney(form.get('amount'));
      if (!amount || amount > AMOUNT_MAX_CENTS) return refuse('Type the amount in dollars, like 250 or 250.50.');
      const method = ['venmo', 'paypal', 'other'].includes(form.get('method')) ? form.get('method') : 'other';
      const note = cleanLine(form.get('note')).slice(0, LIMITS.note);
      await db.batch(recordPayment(env, r, {
        kind: 'manual', method, ref: `manual:${formId}`, amount, note, email: form.get('email_them') === 'yes', now
      }));
      return done();
    }

    case 'cancel': {
      const message = cleanText(form.get('message')).slice(0, LIMITS.message);
      // The email goes in only if this batch's update did (cancelled_at is this moment).
      await db.batch([
        db.prepare(`UPDATE requests SET status = 'cancelled', cancelled_at = ?, cancelled_by = 'jonathan'
          WHERE id = ? AND status IN ('requested', 'writing', 'delivered') AND paid_at IS NULL`).bind(at, r.id),
        queueEmail(env, 'cancelled', r, { now, by: 'jonathan', message, when: 'EXISTS (SELECT 1 FROM requests WHERE id = ? AND cancelled_at = ?)', whenArgs: [r.id, at] })
      ]);
      return done();
    }

    case 'restore': {
      if (!FORM_ID.test(formId)) return refuse('That form is missing its id. Reload the page and try again.');
      // It keeps its id, so it's back in its old place, and everyone behind it moves down one.
      const position = await placeInLine(db, r.id);
      await db.batch([
        db.prepare(`UPDATE requests SET status = 'requested', cancelled_at = NULL, cancelled_by = NULL, archived_at = NULL
          WHERE id = ? AND status = 'cancelled' AND delivered_at IS NULL`).bind(r.id),
        queueEmail(env, 'received', r, { now, position, onceKey: `restored:${r.id}:${formId}`,
          when: "(SELECT status FROM requests WHERE id = ?) = 'requested'", whenArgs: [r.id] })
      ]);
      return done();
    }

    case 'archive':
      await db.prepare("UPDATE requests SET archived_at = ? WHERE id = ? AND status IN ('delivered', 'cancelled') AND archived_at IS NULL").bind(at, r.id).run();
      return done();

    case 'unarchive':
      await db.prepare('UPDATE requests SET archived_at = NULL WHERE id = ?').bind(r.id).run();
      return done();

    case 'edit': {
      const floor = parseDollars(form.get('floor'));
      if (!floor || floor > AMOUNT_MAX_CENTS) return refuse('Type the least they can pay in whole dollars.');
      const note = cleanText(form.get('admin_note')).slice(0, LIMITS.note);
      await db.prepare('UPDATE requests SET floor_cents = ?, may_publish = ?, wants_video = ?, admin_note = ? WHERE id = ?')
        .bind(floor, form.get('may_publish') === 'no' ? 0 : 1, form.get('wants_video') === 'yes' ? 1 : 0, note, r.id).run();
      return done();
    }
  }
  return refuse('That isn’t something I can do.');
}

async function sendEmail(request, env, url, ctx, identity, now, id) {
  const db = env.COMMISSIONS_DB;
  const email = await db.prepare('SELECT * FROM outbox WHERE id = ?').bind(id).first();
  if (!email) return problemPage(request, identity, 'There’s no email with that number.', 404);
  const { form, status, error } = await readForm(request, 16 * 1024);
  if (!form) return problemPage(request, identity, error, status);
  if (form.get('action') !== 'send') return problemPage(request, identity, 'That isn’t something I can do.', 400);
  let target = email.id;
  if (email.sent_at || email.failed_at) {
    // A resend is a new copy, so the record of the first one stays as it was.
    const copy = await db.prepare(`INSERT INTO outbox (request_id, kind, position, to_email, subject, text, html, unsubscribe_url, created_at)
      SELECT request_id, kind, position, to_email, subject, text, html, unsubscribe_url, ? FROM outbox WHERE id = ?`)
      .bind(now.toISOString(), email.id).run();
    target = copy.meta.last_row_id;
  }
  await flushOutbox(env, { ids: [target], now });
  return back(`/commission/admin/emails/${target}?done=send`);
}

// Everything under /commission/admin, any spelling. Only exact lowercase paths reach the
// admin, and only after the Access check, so a spelling Access doesn't cover can only lock
// Jonathan out, never let someone in.
export async function handleAdmin(request, env, url, ctx) {
  const identity = await accessIdentity(request, env, url);
  if (!identity) return forbidden();
  if (!env.COMMISSIONS_DB) return problemPage(request, identity, 'The commissions database isn’t set up (COMMISSIONS_DB).', 503);
  const now = new Date();
  const method = request.method;
  const path = url.pathname;
  const read = method === 'GET' || method === 'HEAD';
  // CSRF: Access's cookie could otherwise ride along on a POST from another site.
  if (method === 'POST' && request.headers.get('Origin') !== url.origin) return forbidden('That came from somewhere else.');

  if (path === '/commission/admin' || path === '/commission/admin/') {
    if (read) return queuePage(request, env, url, identity, now);
  } else if (path === '/commission/admin/emails') {
    if (read) return emailsPage(request, env, url, identity, now);
  } else {
    const email = /^\/commission\/admin\/emails\/([1-9]\d{0,9})$/.exec(path);
    const one = /^\/commission\/admin\/([1-9]\d{0,9})(?:\/(memo|audio))?$/.exec(path);
    if (email) {
      if (read) return emailPage(request, env, identity, now, Number(email[1]));
      if (method === 'POST') return sendEmail(request, env, url, ctx, identity, now, Number(email[1]));
    } else if (one?.[2]) {
      if (read) {
        const r = await loadRequest(env.COMMISSIONS_DB, Number(one[1]));
        const key = one[2] === 'memo' ? r?.memo_key : r?.audio_key;
        const media = key && env.COMMISSION_FILES && await serveMedia(request, env.COMMISSION_FILES, key, PRIVATE_MEDIA);
        return media || new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
      }
    } else if (one) {
      if (read) return detailPage(request, env, url, identity, now, Number(one[1]));
      if (method === 'POST') return act(request, env, url, ctx, identity, now, Number(one[1]));
    } else {
      return problemPage(request, identity, 'There’s nothing here.', 404);
    }
  }
  return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD, POST' } });
}
