'use strict';

const { db } = require('../db');
const logger = require('../logger');
const { notify } = require('./notify');

/**
 * Flags a conversation for human review. This is the single place the rest
 * of the app calls into whenever it's not confident about an answer —
 * prescription requests, catalog/API failures, ambiguous requests Claude
 * itself flags, and new confirmed orders that need manual fulfillment.
 */
function flag({ customerId, conversationId, category, reason, phoneNumber }) {
  const info = db
    .prepare(
      `INSERT INTO human_review_queue (customer_id, conversation_id, category, reason)
       VALUES (?, ?, ?, ?)`
    )
    .run(customerId, conversationId || null, category, reason || null);

  logger.warn({ customerId, category, reason }, 'flagged conversation for human review');

  notify({ category, reason, phoneNumber }).catch((err) =>
    logger.error({ err }, 'human review notify() rejected')
  );

  return info.lastInsertRowid;
}

function listOpen({ category } = {}) {
  if (category) {
    return db
      .prepare(
        `SELECT * FROM human_review_queue WHERE status = 'open' AND category = ? ORDER BY created_at ASC`
      )
      .all(category);
  }
  return db
    .prepare(`SELECT * FROM human_review_queue WHERE status = 'open' ORDER BY created_at ASC`)
    .all();
}

function resolve(id) {
  db.prepare(
    `UPDATE human_review_queue SET status = 'resolved', resolved_at = datetime('now') WHERE id = ?`
  ).run(id);
}

module.exports = { flag, listOpen, resolve };
