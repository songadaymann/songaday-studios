-- The Donate button wording test (donate-test.mjs): daily totals only. One row per New York day,
-- wording, site, button and event, counted up; no request, address or cookie is kept.
CREATE TABLE donate_counts (
 day TEXT NOT NULL,
 words TEXT NOT NULL,
 site TEXT NOT NULL,
 place TEXT NOT NULL,
 event TEXT NOT NULL CHECK (event IN ('view', 'click')),
 count INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY (day, words, site, place, event)
);
