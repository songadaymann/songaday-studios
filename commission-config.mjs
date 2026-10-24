// songaday.studio/commission: the numbers. build.mjs puts them into the page's copy and the
// Worker checks payments and uploads against the same values, so the two can't disagree.
// Amounts are in cents.

// Pay what you want. "$1,000 or more" is the last suggestion plus the Other field.
export const PRICES = {
  personal: { floor: 20000, suggested: [30000, 50000, 100000] },
  business: { floor: 150000, suggested: [150000] }
};

// A music video is an extra on any song. Not priced yet: the form only asks whether they'd like
// one, and Jonathan follows up. Once set, the page shows it and it's added to the floor of
// requests that want a video.
export const VIDEO_PRICE_CENTS = null;

// About how many songs Jonathan writes in a day. The page uses it to say how long the line is,
// and a buyer whose place in line is after their deadline is told so when they ask.
export const WRITES_PER_DAY = 10;

// Paying over time: the total split into this many monthly payments.
export const PLAN_MONTHS = [3, 6, 12];
// "Pay what it was worth", after paying.
export const EXTRA_MIN_CENTS = 100;
// $50,000, a guard against typos.
export const AMOUNT_MAX_CENTS = 5_000_000;

// Requested, being written, or delivered and not paid yet, per email address.
export const MAX_OPEN_PER_EMAIL = 5;
// More requests than this in 24 hours is a flood, not a busy day (the busiest months on record
// had about 25 in the month). Past it, new requests are held, not refused: they wait out of
// line until Jonathan lets them in, and he gets an email.
export const INTAKE_ALARM_PER_DAY = 30;

export const MEMO_MAX_BYTES = 10 * 1024 * 1024;
export const SONG_MAX_BYTES = 30 * 1024 * 1024;
// The request form: the memo plus room for the text.
export const FORM_MAX_BYTES = MEMO_MAX_BYTES + 256 * 1024;
// The deliver form: the song plus room for the lyrics.
export const DELIVER_MAX_BYTES = SONG_MAX_BYTES + 256 * 1024;

// Characters.
export const LIMITS = {
  name: 100, email: 254, recipient: 200, relationship: 200, occasion: 200,
  names: 1000, storyMin: 20, story: 10000, leave_out: 2000, title: 200, lyrics: 20000,
  note: 2000, message: 2000, video_url: 500
};

// The one "your song is waiting" nudge, this many days after delivery.
export const REMINDER_DAYS = 7;
// Emails one run sends at most. Each costs up to three D1 queries, and D1 allows about 1,000
// per Worker invocation on Workers Paid; D1_QUERY_BUDGET leaves room for the rest of the run.
export const OUTBOX_BATCH = 200;
export const D1_QUERY_BUDGET = 900;
export const OUTBOX_MAX_ATTEMPTS = 5;
// Emails are purged after this many days, sent or not: their bodies hold names and links.
export const OUTBOX_KEEP_DAYS = 180;
// A voice memo is deleted this many days after its song is delivered or its request cancelled.
export const MEMO_KEEP_DAYS = 30;
// A request cancelled this long ago, with no payment, is deleted, its emails and files too.
export const CANCELLED_KEEP_DAYS = 90;
export const ADMIN_PAGE_SIZE = 20;

// Every Stripe call and the webhook endpoint use this version, so payloads match the code.
export const STRIPE_VERSION = '2026-09-30.endive';
