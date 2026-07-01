'use strict';

require('./testEnv');
const assert = require('node:assert');
const { test } = require('node:test');
const { db, getOrCreateCustomer } = require('../src/db');
const { findDueReminders } = require('../src/reminders/refillReminderService');

function insertPurchase(customerId, purchasedAt) {
  db.prepare(
    `INSERT INTO purchase_history (customer_id, sku, product_name, quantity, purchased_at, duration_days)
     VALUES (?, 'SA-SNSCRN-50', 'SkinAlive Daily Matte Sunscreen SPF 50 PA+++', 1, ?, 30)`
  ).run(customerId, purchasedAt);
}

test('a 30-day sunscreen bought 31 days ago is due for a reminder', () => {
  const customer = getOrCreateCustomer('911111100010', 'Reminder Due');
  insertPurchase(customer.id, new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString());
  const due = findDueReminders();
  assert.ok(due.some((r) => r.customer_id === customer.id));
});

test('a sunscreen bought today is not yet due', () => {
  const customer = getOrCreateCustomer('911111100011', 'Reminder Not Due');
  insertPurchase(customer.id, new Date().toISOString());
  const due = findDueReminders();
  assert.ok(!due.some((r) => r.customer_id === customer.id));
});
