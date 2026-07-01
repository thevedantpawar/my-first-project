'use strict';

require('./testEnv');
const assert = require('node:assert');
const { test } = require('node:test');
const { db, getOrCreateCustomer } = require('../src/db');
const orderService = require('../src/orders/orderService');

test('createDraftOrder rejects an unknown sku without creating an order', () => {
  const customer = getOrCreateCustomer('911111100001', 'Test User 1');
  const before = db.prepare('SELECT COUNT(*) AS n FROM orders WHERE customer_id = ?').get(customer.id).n;
  const result = orderService.createDraftOrder(customer.id, [{ sku: 'NOPE', quantity: 1 }]);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.errors[0].reason, 'not_found');
  const after = db.prepare('SELECT COUNT(*) AS n FROM orders WHERE customer_id = ?').get(customer.id).n;
  assert.strictEqual(after, before);
});

test('createDraftOrder computes price/total from the catalog, not client input', () => {
  const customer = getOrCreateCustomer('911111100002', 'Test User 2');
  const result = orderService.createDraftOrder(customer.id, [{ sku: 'SA-SNSCRN-50', quantity: 2 }]);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.order.items[0].unit_price, 549);
  assert.strictEqual(result.order.total_amount, 1098);
  assert.match(result.order.summary_text, /Total: ₹1098/);
});

test('confirmOrder records purchase history and hands off to the human queue', () => {
  const customer = getOrCreateCustomer('911111100003', 'Test User 3');
  orderService.createDraftOrder(customer.id, [{ sku: 'SA-SNSCRN-50', quantity: 1 }]);
  const result = orderService.confirmOrder(customer.id, { phoneNumber: '911111100003' });
  assert.strictEqual(result.ok, true);

  const history = db
    .prepare('SELECT * FROM purchase_history WHERE customer_id = ?')
    .all(customer.id);
  assert.strictEqual(history.length, 1);
  assert.strictEqual(history[0].sku, 'SA-SNSCRN-50');

  const review = db
    .prepare("SELECT * FROM human_review_queue WHERE customer_id = ? AND category = 'new_order'")
    .all(customer.id);
  assert.strictEqual(review.length, 1);
});

test('confirmOrder fails cleanly when there is no draft order', () => {
  const customer = getOrCreateCustomer('911111100004', 'Test User 4');
  const result = orderService.confirmOrder(customer.id);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'no_draft_order');
});

test('cancelOrder discards the draft without touching purchase history', () => {
  const customer = getOrCreateCustomer('911111100005', 'Test User 5');
  orderService.createDraftOrder(customer.id, [{ sku: 'SA-SERUM-NIACIN', quantity: 1 }]);
  const result = orderService.cancelOrder(customer.id);
  assert.strictEqual(result.ok, true);
  const history = db
    .prepare('SELECT * FROM purchase_history WHERE customer_id = ?')
    .all(customer.id);
  assert.strictEqual(history.length, 0);
});
