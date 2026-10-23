-- songaday.studio/commission: song requests (D1 database songaday-commissions).
-- Buyer data lives only here and in the private R2 bucket songaday-commissions, never in the
-- repo or in logs. Times are ISO 8601 UTC; deadline is a New York date (YYYY-MM-DD).

CREATE TABLE requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,  -- order received: the line is ordered by this
  token TEXT NOT NULL UNIQUE,            -- 32 hex characters (128 random bits): the buyer's private page
  share_token TEXT NOT NULL UNIQUE,      -- the same, for the page they can pass on: the song and lyrics only
  status TEXT NOT NULL DEFAULT 'requested'      -- held: came in past the day's alarm, waiting to be let in
    CHECK (status IN ('held', 'requested', 'writing', 'delivered', 'cancelled')),
  kind TEXT NOT NULL CHECK (kind IN ('personal', 'business')),
  floor_cents INTEGER NOT NULL,          -- the least they can pay; set from kind, Jonathan can change it

  -- What the buyer told us, cleaned (cleanText) and length-limited.
  buyer_name TEXT NOT NULL,
  buyer_email TEXT NOT NULL,             -- trimmed and lowercased
  email_key TEXT NOT NULL,               -- the same without a +tag, for the per-address cap
  recipient TEXT NOT NULL,               -- who or what the song is for
  relationship TEXT NOT NULL DEFAULT '', -- what they are to the buyer
  occasion TEXT NOT NULL DEFAULT '',
  names TEXT NOT NULL DEFAULT '',        -- names to sing, and how to say them
  memo_key TEXT,                         -- voice memo in R2: memos/<32 hex>.<ext> (its type is in R2's metadata)
  story TEXT NOT NULL,
  leave_out TEXT NOT NULL DEFAULT '',
  deadline TEXT,                         -- YYYY-MM-DD, or null
  may_publish INTEGER NOT NULL CHECK (may_publish IN (0, 1)),  -- 1: it can be that day's Song A Day
  wants_video INTEGER NOT NULL DEFAULT 0 CHECK (wants_video IN (0, 1)),

  -- The delivered song.
  title TEXT,
  lyrics TEXT,
  audio_key TEXT,                        -- songs/<id>/<16 hex>.<ext> (its type is in R2's metadata)
  video_url TEXT,                        -- optional https link (unlisted YouTube and the like)

  quiet INTEGER NOT NULL DEFAULT 0,      -- 1: they turned place-in-line emails off
  admin_note TEXT NOT NULL DEFAULT '',   -- Jonathan's own note; the buyer never sees it

  requested_at TEXT NOT NULL,
  writing_at TEXT,
  delivered_at TEXT,
  paid_at TEXT,                          -- first payment of any kind: this unlocks the download
  reminded_at TEXT,                      -- the one "your song is waiting" nudge
  cancelled_at TEXT,
  cancelled_by TEXT CHECK (cancelled_by IN ('buyer', 'jonathan')),
  archived_at TEXT,                      -- off Jonathan's working lists; changes nothing for the buyer
  deleted_at TEXT                        -- Delete for good: the answers are blanked, the links changed
);

CREATE INDEX requests_by_status ON requests (status, id);
CREATE INDEX requests_by_email ON requests (email_key, status);
CREATE INDEX requests_by_time ON requests (requested_at);

-- Money in. One row per payment, so one-off payments, monthly payments, extras and payments
-- Jonathan marks by hand all add up the same way.
CREATE TABLE payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES requests (id),
  kind TEXT NOT NULL,                    -- 'once', 'installment', 'extra', 'manual' (no CHECK, so a later
                                         -- monthly song plan can add a kind without rebuilding the table)
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  method TEXT NOT NULL,                  -- 'stripe', 'venmo', 'paypal', 'other'
  ref TEXT NOT NULL UNIQUE,              -- Checkout Session id (once, extra), Invoice id (installment), or
                                         -- manual:<random id from the form>, so a double submit records once
  subscription_id TEXT,                  -- installments only: the plan this payment belongs to
  note TEXT NOT NULL DEFAULT '',
  paid_at TEXT NOT NULL
);

CREATE INDEX payments_by_request ON payments (request_id);
CREATE INDEX payments_by_subscription ON payments (subscription_id);

-- Paying over time: one row per Stripe subscription, which a subscription schedule ends.
CREATE TABLE plans (
  subscription_id TEXT PRIMARY KEY,      -- sub_...
  request_id INTEGER NOT NULL REFERENCES requests (id),
  months INTEGER NOT NULL,
  monthly_cents INTEGER NOT NULL,
  schedule_id TEXT,                      -- set once the schedule that ends it is in place
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'finished', 'stopped')),
  started_at TEXT NOT NULL,
  ended_at TEXT
);

CREATE INDEX plans_by_request ON plans (request_id);

-- Every email is written here first, then sent through the binding when there is one.
CREATE TABLE outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER REFERENCES requests (id),  -- null for Jonathan's daily summary
  kind TEXT NOT NULL,                    -- received, moved, delivered, updated, paid, plan-finished,
                                         -- extra-thanks, plan-stopped, reminder, cancelled, held, alarm, summary
  once_key TEXT UNIQUE,                  -- 'received:12', 'moved:12:2026-11-03', 'paid:cs_...' and so on;
                                         -- written with ON CONFLICT DO NOTHING, so a repeat is skipped
  position INTEGER,                      -- received and moved only: the place in line this email states
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  text TEXT NOT NULL,
  html TEXT NOT NULL,
  unsubscribe_url TEXT,                  -- set on place-in-line emails (List-Unsubscribe)
  created_at TEXT NOT NULL,
  claimed_at TEXT,                       -- a sender took it (stops two senders sending it twice)
  attempts INTEGER NOT NULL DEFAULT 0,   -- failed sends so far
  last_error TEXT,                       -- the Email Service error code only, never the message body
  failed_at TEXT,                        -- gave up: a permanent error, or OUTBOX_MAX_ATTEMPTS failures
  sent_at TEXT,
  message_id TEXT
);

CREATE INDEX outbox_unsent ON outbox (sent_at, id);
CREATE INDEX outbox_by_request ON outbox (request_id, id);
