-- Separate store records in the existing private Studio database.
CREATE TABLE IF NOT EXISTS store_orders (
 id TEXT PRIMARY KEY,
 figure INTEGER NOT NULL,
 variant TEXT NOT NULL,
 price_cents INTEGER NOT NULL,
 shipping_cents INTEGER NOT NULL,
 recipient_json TEXT NOT NULL,
 shipping_method TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'quoted',
 expires_at INTEGER NOT NULL,
 session_id TEXT UNIQUE,
 checkout_url TEXT,
 stripe_customer TEXT,
 payment_intent TEXT,
 paid_total_cents INTEGER,
 gelato_id TEXT UNIQUE,
 error_code TEXT,
 tracking_json TEXT NOT NULL DEFAULT '[]',
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS store_orders_status ON store_orders(status, updated_at);
