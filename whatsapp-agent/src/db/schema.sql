-- Core schema for the WhatsApp pharmacy/skincare agent.
-- SQLite (via better-sqlite3). Applied idempotently on startup.

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone_number TEXT UNIQUE NOT NULL,
  name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Every inbound and outbound message is logged here, unconditionally.
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  message_type TEXT NOT NULL DEFAULT 'text',
  wa_message_id TEXT,
  body TEXT,
  intent TEXT,
  confidence TEXT CHECK (confidence IN ('high', 'low', NULL)),
  raw_payload TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_wa_message_id
  ON conversations(wa_message_id)
  WHERE wa_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_customer_id ON conversations(customer_id);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'cancelled')),
  items TEXT NOT NULL, -- JSON array of {sku, name, quantity, unit_price, line_total}
  total_amount REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id);

-- One row per line item purchased, used to drive refill reminders.
CREATE TABLE IF NOT EXISTS purchase_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  order_id INTEGER REFERENCES orders(id),
  sku TEXT NOT NULL,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  purchased_at TEXT NOT NULL DEFAULT (datetime('now')),
  duration_days INTEGER, -- typical days-of-use, from catalog at time of purchase; NULL = no reminder
  reminder_sent_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_purchase_history_customer_id ON purchase_history(customer_id);
CREATE INDEX IF NOT EXISTS idx_purchase_history_due ON purchase_history(duration_days, reminder_sent_at);

-- Anything the bot isn't confident about, plus every prescription-medicine
-- request, lands here for a human to pick up. Nothing gets auto-resolved.
CREATE TABLE IF NOT EXISTS human_review_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  conversation_id INTEGER REFERENCES conversations(id),
  category TEXT NOT NULL, -- prescription | low_confidence | catalog_unavailable | new_order | other
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_human_review_status ON human_review_queue(status);
