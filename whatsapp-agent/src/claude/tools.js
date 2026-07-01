'use strict';

const { db } = require('../db');
const catalogService = require('../catalog/catalogService');
const orderService = require('../orders/orderService');
const humanReviewQueue = require('../review/humanReviewQueue');

// Tool schemas passed to the Claude API (Anthropic tool-use format).
const toolSchemas = [
  {
    name: 'search_catalog',
    description:
      'Search the pharmacy/skincare product catalog by name, brand, category or keyword. ' +
      'Returns only products that actually exist, with real price and stock data. Always use ' +
      'this before answering any question about a product, price, or availability — never ' +
      'answer from memory.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Search text, e.g. "sunscreen" or "vitamin c serum"' } },
      required: ['query'],
    },
  },
  {
    name: 'get_product',
    description: 'Get full details for a single product by its exact SKU (from an earlier search_catalog result).',
    input_schema: {
      type: 'object',
      properties: { sku: { type: 'string' } },
      required: ['sku'],
    },
  },
  {
    name: 'get_purchase_history',
    description:
      "Get this customer's past purchases (product, quantity, date). Use this to answer " +
      "questions like 'what did I order last time' or to check refill context.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'start_order',
    description:
      'Create a DRAFT order for the given items. This does NOT charge or finalize anything — ' +
      'it validates stock/price against the live catalog and returns a structured summary for ' +
      'the customer to confirm. Only use SKUs that were returned by search_catalog/get_product ' +
      'earlier in this conversation. Never call this for a prescription medicine.',
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              sku: { type: 'string' },
              quantity: { type: 'integer', minimum: 1 },
            },
            required: ['sku', 'quantity'],
          },
        },
      },
      required: ['items'],
    },
  },
  {
    name: 'confirm_pending_order',
    description:
      "Confirm the customer's current draft order after they have explicitly agreed to the " +
      'order summary (e.g. said "yes", "confirm", "haan", "place the order"). Fails if there is ' +
      'no draft order for this customer.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'cancel_pending_order',
    description: 'Cancel/discard the current draft order if the customer changes their mind.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'flag_for_human_review',
    description:
      'Escalate this conversation to a human pharmacist/support agent. Use this whenever you ' +
      "are not confident about how to answer, the request is ambiguous, involves a medical " +
      "question you can't safely answer, a complaint, or anything outside stock/price/ordering/" +
      'refill reminders.',
    input_schema: {
      type: 'object',
      properties: { reason: { type: 'string', description: 'Brief reason for escalation' } },
      required: ['reason'],
    },
  },
];

/**
 * Executes a tool call against real backend state. CatalogUnavailableError
 * intentionally propagates up uncaught — the agent loop treats that as a
 * hard stop for the whole turn (see agent.js), not something to hand back
 * to the model to paper over.
 */
async function executeTool(name, input, ctx) {
  switch (name) {
    case 'search_catalog': {
      const results = catalogService.searchProducts(input.query);
      return { results };
    }
    case 'get_product': {
      const product = catalogService.getProductBySku(input.sku);
      return product ? { product } : { error: 'not_found' };
    }
    case 'get_purchase_history': {
      const purchases = db
        .prepare(
          `SELECT sku, product_name, quantity, purchased_at FROM purchase_history
           WHERE customer_id = ? ORDER BY purchased_at DESC LIMIT 10`
        )
        .all(ctx.customerId);
      return { purchases };
    }
    case 'start_order': {
      return orderService.createDraftOrder(ctx.customerId, input.items || []);
    }
    case 'confirm_pending_order': {
      return orderService.confirmOrder(ctx.customerId, { phoneNumber: ctx.phoneNumber });
    }
    case 'cancel_pending_order': {
      return orderService.cancelOrder(ctx.customerId);
    }
    case 'flag_for_human_review': {
      humanReviewQueue.flag({
        customerId: ctx.customerId,
        conversationId: ctx.conversationId,
        category: 'low_confidence',
        reason: input.reason,
        phoneNumber: ctx.phoneNumber,
      });
      ctx.flaggedForReview = true;
      return { ok: true };
    }
    default:
      throw new Error(`Unknown tool requested by model: ${name}`);
  }
}

module.exports = { toolSchemas, executeTool };
