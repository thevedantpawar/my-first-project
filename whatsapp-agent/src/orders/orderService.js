'use strict';

const { db } = require('../db');
const catalogService = require('../catalog/catalogService');
const humanReviewQueue = require('../review/humanReviewQueue');
const logger = require('../logger');

function formatINR(amount) {
  return `₹${amount.toFixed(2).replace(/\.00$/, '')}`;
}

function formatSummary(items, totalAmount) {
  const lines = items.map(
    (item) =>
      `- ${item.name} (${item.sku}) x${item.quantity} — ${formatINR(item.unit_price)} each = ${formatINR(
        item.line_total
      )}`
  );
  lines.push(`Total: ${formatINR(totalAmount)}`);
  return lines.join('\n');
}

/**
 * Validates requested items against the live catalog and, only if every
 * item exists and has enough stock, creates a draft order. Prices and
 * names always come from the catalog lookup done here — never from
 * whatever the model said earlier in the conversation.
 */
function createDraftOrder(customerId, requestedItems) {
  const errors = [];
  const resolvedItems = [];

  for (const req of requestedItems) {
    const quantity = Number(req.quantity) || 0;
    if (quantity <= 0) {
      errors.push({ sku: req.sku, reason: 'invalid_quantity' });
      continue;
    }

    const product = catalogService.getRawProductBySku(req.sku);
    if (!product) {
      errors.push({ sku: req.sku, reason: 'not_found' });
      continue;
    }
    if (product.requires_prescription) {
      // Should never happen (prescription items aren't in the sellable
      // catalog / are caught upstream by prescriptionGuard), but never
      // let an order slip through for one regardless.
      errors.push({ sku: req.sku, reason: 'requires_prescription' });
      continue;
    }

    const availability = catalogService.checkAvailability(req.sku, quantity);
    if (!availability.available) {
      errors.push({ sku: req.sku, reason: availability.reason, stock_qty: availability.stock_qty });
      continue;
    }

    resolvedItems.push({
      sku: product.sku,
      name: product.name,
      quantity,
      unit_price: product.price,
      line_total: Math.round(product.price * quantity * 100) / 100,
      duration_days: product.duration_days || null,
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const totalAmount = resolvedItems.reduce((sum, item) => sum + item.line_total, 0);

  const info = db
    .prepare(
      `INSERT INTO orders (customer_id, status, items, total_amount) VALUES (?, 'draft', ?, ?)`
    )
    .run(customerId, JSON.stringify(resolvedItems), totalAmount);

  return {
    ok: true,
    order: {
      id: info.lastInsertRowid,
      items: resolvedItems,
      total_amount: totalAmount,
      summary_text: formatSummary(resolvedItems, totalAmount),
    },
  };
}

function getLatestDraftOrder(customerId) {
  const row = db
    .prepare(
      `SELECT * FROM orders WHERE customer_id = ? AND status = 'draft' ORDER BY created_at DESC LIMIT 1`
    )
    .get(customerId);
  if (!row) return null;
  return { ...row, items: JSON.parse(row.items) };
}

/**
 * Confirms the customer's current draft order. Actual payment/fulfillment
 * is intentionally NOT automated here (checkout flow wasn't decided yet) —
 * confirming records the order, updates purchase history (for refill
 * reminders), decrements catalog stock, and hands the order to a human via
 * the review queue for payment/dispatch. Swap this last step for a real
 * fulfillment integration (Shopify draft order, payment link, etc.) later.
 */
function confirmOrder(customerId, { phoneNumber } = {}) {
  const draft = getLatestDraftOrder(customerId);
  if (!draft) {
    return { ok: false, reason: 'no_draft_order' };
  }

  const now = new Date().toISOString();
  db.prepare(`UPDATE orders SET status = 'confirmed', updated_at = ? WHERE id = ?`).run(
    now,
    draft.id
  );

  const insertPurchase = db.prepare(
    `INSERT INTO purchase_history (customer_id, order_id, sku, product_name, quantity, duration_days)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  for (const item of draft.items) {
    insertPurchase.run(customerId, draft.id, item.sku, item.name, item.quantity, item.duration_days);
    catalogService.decrementStock(item.sku, item.quantity);
  }

  humanReviewQueue.flag({
    customerId,
    category: 'new_order',
    reason: `Order #${draft.id} confirmed by customer — needs payment/fulfillment: ${draft.summary_text || formatSummary(draft.items, draft.total_amount)}`,
    phoneNumber,
  });

  logger.info({ orderId: draft.id, customerId }, 'order confirmed');

  return {
    ok: true,
    order: {
      id: draft.id,
      items: draft.items,
      total_amount: draft.total_amount,
      summary_text: formatSummary(draft.items, draft.total_amount),
    },
  };
}

function cancelOrder(customerId) {
  const draft = getLatestDraftOrder(customerId);
  if (!draft) {
    return { ok: false, reason: 'no_draft_order' };
  }
  db.prepare(`UPDATE orders SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?`).run(
    draft.id
  );
  return { ok: true };
}

module.exports = { createDraftOrder, getLatestDraftOrder, confirmOrder, cancelOrder, formatSummary };
