'use strict';

const { db } = require('../db');

/** Every inbound and outbound message goes through here — no exceptions. */
function logInbound(customerId, { waMessageId, body, rawPayload }) {
  const info = db
    .prepare(
      `INSERT INTO conversations (customer_id, direction, message_type, wa_message_id, body, raw_payload)
       VALUES (?, 'inbound', 'text', ?, ?, ?)`
    )
    .run(customerId, waMessageId || null, body || null, rawPayload ? JSON.stringify(rawPayload) : null);
  return info.lastInsertRowid;
}

function logOutbound(customerId, { body, intent, confidence, rawPayload }) {
  const info = db
    .prepare(
      `INSERT INTO conversations (customer_id, direction, message_type, body, intent, confidence, raw_payload)
       VALUES (?, 'outbound', 'text', ?, ?, ?, ?)`
    )
    .run(
      customerId,
      body || null,
      intent || null,
      confidence || null,
      rawPayload ? JSON.stringify(rawPayload) : null
    );
  return info.lastInsertRowid;
}

function wasAlreadyProcessed(waMessageId) {
  if (!waMessageId) return false;
  const row = db
    .prepare(`SELECT id FROM conversations WHERE wa_message_id = ?`)
    .get(waMessageId);
  return !!row;
}

/** Recent turns for this customer, oldest first, to rebuild Claude context. */
function getRecentHistory(customerId, limit = 12) {
  const rows = db
    .prepare(
      `SELECT direction, body FROM conversations
       WHERE customer_id = ? AND message_type = 'text' AND body IS NOT NULL
       ORDER BY created_at DESC LIMIT ?`
    )
    .all(customerId, limit);
  return rows.reverse();
}

module.exports = { logInbound, logOutbound, wasAlreadyProcessed, getRecentHistory };
