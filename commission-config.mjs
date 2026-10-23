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

// Paying over time: the total split into this many monthly payments.
export const PLAN_MONTHS = [3, 6, 12];
// "Pay what it was worth", after paying.
export const EXTRA_MIN_CENTS = 100;
// $50,000, a guard against typos.
export const AMOUNT_MAX_CENTS = 5_000_000;

// Requested, being written, or delivered and not paid yet, per email address.
export const MAX_OPEN_PER_EMAIL = 5;

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
export const OUTBOX_BATCH = 500;
export const OUTBOX_MAX_ATTEMPTS = 5;
// Sent emails are purged after this many days: their bodies hold names and links.
export const OUTBOX_KEEP_DAYS = 180;
export const ADMIN_PAGE_SIZE = 20;

// Every Stripe call and the webhook endpoint use this version, so payloads match the code.
export const STRIPE_VERSION = '2026-09-30.endive';
