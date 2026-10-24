// The parts of songaday.studio/commission that the routes, the admin, Stripe and the emails all
// use: cleaning text, sniffing audio, the request states, the line, and money formatting.
// It imports nothing from the other commission files but the config, so they can all import it.
import { cleanStory } from './fumble.mjs';
import { WRITES_PER_DAY } from './commission-config.mjs';

export const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
// A request is in line while it waits or while Jonathan writes it. A held one isn't yet.
export const IN_LINE = "status IN ('requested', 'writing')";
// Not finished with: held, in line, or delivered and not paid yet.
export const OPEN = "(status IN ('held', 'requested', 'writing') OR (status = 'delivered' AND paid_at IS NULL))";

// An address as the per-address cap counts it: pat+1@ and pat+2@ are one inbox.
export function emailKey(address) {
  const at = address.lastIndexOf('@');
  return at < 0 ? address : address.slice(0, at).split('+')[0] + address.slice(at);
}

// What the rate limit counts by: the visitor's IP, or for IPv6 its /64, since one connection
// gets a whole /64 and can rotate through it.
export function visitorKey(ip) {
  const address = String(ip ?? '').trim().toLowerCase();
  if (!address) return 'unknown';
  if (!address.includes(':')) return address;
  const mapped = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address);
  if (mapped) return mapped[1];
  const [head, tail] = address.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = tail === undefined ? left : [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
  return groups.slice(0, 4).map((group) => group.replace(/^0+(?=.)/, '')).join(':') + '::/64';
}

export const randomHex = (bytes) =>
  [...crypto.getRandomValues(new Uint8Array(bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
// 128 random bits. Hex, not base64url: the Worker lowercases paths elsewhere, and hex survives that.
export const newToken = () => randomHex(16);
export const TOKEN = /^[0-9a-f]{32}$/;

// Work that can finish after the response (emails). Tests pass no ctx, so they wait for it.
export function later(ctx, promise) {
  const settled = promise.catch((error) => console.log('commission later', error?.name ?? 'error'));
  return ctx?.waitUntil ? ctx.waitUntil(settled) : settled;
}

export const siteOrigin = (env) => (env.SITE_ORIGIN || 'https://songaday.studio').replace(/\/+$/, '');
export const pagePath = (request) => `/commission/s/${request.token}`;
export const pageUrl = (env, request) => siteOrigin(env) + pagePath(request);
// The page a buyer can pass on: the song and its lyrics, nothing they told me, no money, no buttons.
export const sharePath = (request) => `/commission/share/${request.share_token}`;
export const shareUrl = (env, request) => siteOrigin(env) + sharePath(request);

// YYYY-MM-DD in New York, where Jonathan is.
const NEW_YORK = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
export const newYorkDate = (date) => NEW_YORK.format(new Date(date));

// "Oct 23" or "Oct 23, 2027" for a YYYY-MM-DD date or an ISO time, in New York.
export function shortDate(value, now = new Date()) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00Z`) : new Date(value);
  const timeZone = /^\d{4}-\d{2}-\d{2}$/.test(value) ? 'UTC' : 'America/New_York';
  const sameYear = date.getUTCFullYear() === new Date(now).getUTCFullYear();
  return date.toLocaleDateString('en-US', { timeZone, month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

// Whole days from one YYYY-MM-DD date to another.
export const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

// "$200", "$1,500", "$83.34".
export function dollars(cents) {
  const whole = cents % 100 === 0;
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
}

// Whole dollars typed into a form ("300", "$1,000", "500.00") as cents, or null.
export function parseDollars(value) {
  const match = /^\$?\s*(\d{1,3}(?:,\d{3})+|\d{1,9})(?:\.0{1,2})?$/.exec(String(value ?? '').trim());
  return match ? Number(match[1].replaceAll(',', '')) * 100 : null;
}

// Dollars and cents typed into a form ("250", "$1,000", "250.50") as cents, or null.
export function parseMoney(value) {
  const match = /^\$?\s*(\d{1,3}(?:,\d{3})+|\d{1,9})(?:\.(\d{1,2}))?$/.exec(String(value ?? '').trim());
  return match ? Number(match[1].replaceAll(',', '')) * 100 + Number((match[2] ?? '0').padEnd(2, '0')) : null;
}

// Fumble's rules: NFC, control and bidi characters dropped, paragraphs at most one blank line apart.
export const cleanText = cleanStory;
// One line: the same, with every run of whitespace a single space.
export const cleanLine = (value) => cleanStory(value).replace(/\s+/g, ' ');

// What an uploaded file really is, from its first bytes (the browser's MIME type is ignored),
// or null when it isn't audio we take.
const MP4_AUDIO_BRANDS = new Set(['M4A ', 'M4B ', 'mp41', 'mp42', 'isom', 'iso2', '3gp4', '3gp5', '3g2a']);
export function sniffAudio(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const ascii = (start, end) => String.fromCharCode(...b.subarray(start, end));
  if (b.length < 12) return null;
  if (ascii(0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return { ext: 'mp3', type: 'audio/mpeg' };
  // HEIC photos and AVIF images start with ftyp too (heic, mif1, avif), so the brand matters.
  if (ascii(4, 8) === 'ftyp' && MP4_AUDIO_BRANDS.has(ascii(8, 12))) return { ext: 'm4a', type: 'audio/mp4' };
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return { ext: 'wav', type: 'audio/wav' };
  if (ascii(0, 4) === 'OggS') return { ext: 'ogg', type: 'audio/ogg' };
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { ext: 'webm', type: 'audio/webm' };
  return null;
}

// Every move a request can make, and who can make it (section 3 of the design). Every route
// asks transitionProblem first, so the tests can check each allowed and refused move here.
export const TRANSITIONS = {
  'let-in': { from: ['held'] },                              // Jonathan: Let in (a request held past the day's alarm)
  writing: { from: ['requested'] },                          // Jonathan: Start writing
  deliver: { from: ['requested', 'writing', 'delivered'] },  // Jonathan: Deliver, or Redeliver once delivered
  undeliver: { from: ['delivered'], unpaid: true },          // Jonathan: Undo delivery
  'buyer-cancel': { from: ['held', 'requested'] },           // the buyer, from their page
  cancel: { from: ['held', 'requested', 'writing', 'delivered'], unpaid: true },  // Jonathan
  restore: { from: ['cancelled'], neverDelivered: true },    // Jonathan: Put back in line
  archive: { from: ['delivered', 'cancelled'], archived: false },
  unarchive: { archived: true },
  paid: { from: ['delivered'] },                             // Jonathan: Mark paid
  edit: {},
  delete: {}                                                 // Jonathan: Delete for good
};

const WHERE_IT_IS = {
  held: 'That request is held, waiting to be let in.',
  requested: 'That request is still in line.',
  writing: 'That song is being written.',
  delivered: 'That request is already delivered.',
  cancelled: 'That request is cancelled.'
};

// Why a request can't make this move, or null when it can.
export function transitionProblem(request, action) {
  const rule = TRANSITIONS[action];
  if (!rule) return 'That isn’t something I can do.';
  if (request.deleted_at) return 'That request was deleted.';
  if (action === 'buyer-cancel' && request.status === 'writing') return 'I’ve already started writing your song. Email me instead.';
  if (rule.from && !rule.from.includes(request.status)) return WHERE_IT_IS[request.status];
  if (rule.unpaid && request.paid_at) return 'That song is paid for. Refunds happen in Stripe.';
  if (rule.neverDelivered && request.delivered_at) return 'That song was delivered before it was cancelled, so it can’t go back in line.';
  if (rule.archived === false && request.archived_at) return 'That request is already archived.';
  if (rule.archived === true && !request.archived_at) return 'That request isn’t archived.';
  return null;
}

// "How many requests that came in before yours aren't done yet, plus one."
export async function placeInLine(db, id) {
  const before = await db.prepare(`SELECT COUNT(*) AS count FROM requests WHERE ${IN_LINE} AND id < ?`).bind(id).first('count');
  return before + 1;
}

// About how many days until the song at this place in line is written.
export const daysAway = (position) => Math.ceil(position / WRITES_PER_DAY);

// How far past its deadline a song at this place would land, at WRITES_PER_DAY: 0 when it
// should make it, or there's no deadline.
export function lateBy(request, position, today) {
  if (!request?.deadline || !position) return 0;
  return Math.max(0, daysAway(position) - daysBetween(today, request.deadline));
}

// "a day" or "about 4 days".
export const aboutDays = (days) => days <= 1 ? 'about a day' : `about ${days} days`;

// The requests in line with a deadline that's close (within a week) or at risk (their place is
// after it), soonest first: { id, recipient, deadline, position, days, risk }.
export async function deadlineWatch(db, today) {
  const { results } = await db.prepare(`SELECT id, recipient, deadline, position FROM (
      SELECT id, recipient, deadline, ROW_NUMBER() OVER (ORDER BY id) AS position FROM requests WHERE ${IN_LINE})
    WHERE deadline IS NOT NULL AND deadline >= ? ORDER BY deadline, id`).bind(today).all();
  return results.map((row) => ({ ...row, days: daysBetween(today, row.deadline), risk: lateBy(row, row.position, today) > 0 }))
    .filter((row) => row.days <= 7 || row.risk);
}

export async function lineLength(db) {
  const row = await db.prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(status = 'writing'), 0) AS writing
    FROM requests WHERE ${IN_LINE}`).first();
  return { total: row.total, writing: row.writing };
}

export const loadRequest = (db, id) => db.prepare('SELECT * FROM requests WHERE id = ?').bind(id).first();
export const loadByToken = (db, token) => db.prepare('SELECT * FROM requests WHERE token = ?').bind(token).first();
export const loadByShareToken = (db, token) => db.prepare('SELECT * FROM requests WHERE share_token = ?').bind(token).first();

// A POST body as form data, refusing anything without a length (a chunked body could slip past
// the size check) or over the limit. Returns { form } or { status, error }.
export async function readForm(request, max) {
  const length = request.headers.get('Content-Length');
  if (length === null || !/^\d+$/.test(length)) return { status: 411, error: 'That didn’t come through. Try again.' };
  if (Number(length) > max) return { status: 413, error: 'That’s too big to send.' };
  try {
    return { form: await request.formData() };
  } catch {
    return { status: 400, error: 'That didn’t come through. Try again.' };
  }
}
