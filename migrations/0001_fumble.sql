-- songaday.studio/fumble: anonymous bag-fumble stories (D1 database songaday-fumble).
-- Nothing that identifies a visitor is stored: no IP address, account, email or exact time.
CREATE TABLE fumbles (
  id TEXT PRIMARY KEY,
  story TEXT NOT NULL,
  submitted_on TEXT NOT NULL,          -- a date (YYYY-MM-DD), never a time of day
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published')),
  number INTEGER UNIQUE,               -- "Fumble No. 12", given when Jonathan publishes it
  published_at TEXT,
  image_key TEXT,                      -- its painting in the songaday-fumble R2 bucket
  image_alt TEXT
);

CREATE INDEX fumbles_by_status ON fumbles (status, submitted_on);
