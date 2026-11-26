-- Private verification records. Tokens are random, single-use and stored only as SHA-256.
CREATE TABLE patron_links (
 token_hash TEXT PRIMARY KEY,
 email TEXT NOT NULL,
 return_path TEXT NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE INDEX patron_links_expiry ON patron_links(expires_at);
CREATE TABLE patron_sessions (
 token_hash TEXT PRIMARY KEY,
 email TEXT NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE INDEX patron_sessions_expiry ON patron_sessions(expires_at);
-- Atomic limits work across Worker instances; keys contain hashes, never email/IP text.
CREATE TABLE patron_limits (
 key TEXT PRIMARY KEY,
 attempts INTEGER NOT NULL,
 expires_at INTEGER NOT NULL
);
ALTER TABLE store_orders ADD COLUMN discount_cents INTEGER NOT NULL DEFAULT 0 CHECK(discount_cents >= 0);
ALTER TABLE store_orders ADD COLUMN discount_percent INTEGER NOT NULL DEFAULT 0;
ALTER TABLE store_orders ADD COLUMN patron_email_hash TEXT;
