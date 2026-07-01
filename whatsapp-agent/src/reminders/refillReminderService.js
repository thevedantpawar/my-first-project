'use strict';

/**
 * Refill reminders: for each purchased item that has a known typical
 * duration_days (e.g. a sunscreen expected to last ~30 days), nudge the
 * customer to reorder once they're due, within a configurable window.
 * A reminder is only ever sent once per purchase (reminder_sent_at).
 */

const { db } = require('../db');
const config = require('../config');
const logger = require('../logger');
const conversationLogger = require('../conversation/conversationLogger');
const whatsappClient = require('../whatsapp/client');

const LOOKBACK_FLOOR_DAYS = 30; // don't bother nudging purchases overdue by more than this

function findDueReminders() {
  return db
    .prepare(
      `SELECT ph.id AS purchase_id, ph.customer_id, ph.sku, ph.product_name, ph.quantity,
              ph.purchased_at, ph.duration_days, c.phone_number, c.name
       FROM purchase_history ph
       JOIN customers c ON c.id = ph.customer_id
       WHERE ph.duration_days IS NOT NULL
         AND ph.reminder_sent_at IS NULL
         AND julianday(date(ph.purchased_at, '+' || ph.duration_days || ' days')) - julianday('now')
             BETWEEN -? AND ?`
    )
    .all(LOOKBACK_FLOOR_DAYS, config.reminder.windowDays);
}

function markReminderSent(purchaseId) {
  db.prepare(`UPDATE purchase_history SET reminder_sent_at = datetime('now') WHERE id = ?`).run(
    purchaseId
  );
}

function buildReminderText(row) {
  const customerName = row.name || 'there';
  return `Hi ${customerName}! Your ${row.product_name} usually lasts about ${row.duration_days} days — it's about time for a refill. Reply here if you'd like to reorder.`;
}

async function sendReminder(row) {
  const bodyText = buildReminderText(row);
  const components = [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: row.name || 'there' },
        { type: 'text', text: row.product_name },
      ],
    },
  ];

  try {
    await whatsappClient.sendTemplateMessage(
      row.phone_number,
      config.whatsapp.reminderTemplateName,
      config.whatsapp.reminderTemplateLang,
      components
    );
    conversationLogger.logOutbound(row.customer_id, {
      body: bodyText,
      intent: 'refill_reminder',
      confidence: 'high',
    });
    markReminderSent(row.purchase_id);
    return true;
  } catch (err) {
    logger.error(
      { err, customerId: row.customer_id, sku: row.sku },
      'failed to send refill reminder; will retry next run'
    );
    return false;
  }
}

async function runDailyReminders() {
  const due = findDueReminders();
  logger.info({ count: due.length }, 'running refill reminder sweep');
  let sent = 0;
  for (const row of due) {
    // eslint-disable-next-line no-await-in-loop
    if (await sendReminder(row)) sent += 1;
  }
  logger.info({ sent, total: due.length }, 'refill reminder sweep complete');
  return { sent, total: due.length };
}

module.exports = { findDueReminders, runDailyReminders, buildReminderText };
