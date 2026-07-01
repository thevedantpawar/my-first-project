'use strict';

/**
 * Turn orchestration: prescription pre-filter -> Claude tool-use loop ->
 * send + log. This is the only place that decides what gets sent back to
 * a customer, and every path through it ends in a WhatsApp send plus a
 * conversation log row — there is no silent-failure exit.
 */

const config = require('../config');
const logger = require('../logger');
const { getOrCreateCustomer } = require('../db');
const conversationLogger = require('../conversation/conversationLogger');
const prescriptionGuard = require('../prescription/prescriptionGuard');
const humanReviewQueue = require('../review/humanReviewQueue');
const whatsappClient = require('../whatsapp/client');
const { getClient } = require('./client');
const { toolSchemas, executeTool } = require('./tools');
const { SYSTEM_PROMPT } = require('./systemPrompt');
const { CatalogUnavailableError } = require('../catalog/errors');

const FALLBACK_MESSAGE = 'Let me check with the team and get back to you.';
const MAX_TOOL_ITERATIONS = 6;

function buildMessages(history) {
  const merged = [];
  for (const turn of history) {
    const role = turn.direction === 'inbound' ? 'user' : 'assistant';
    const last = merged[merged.length - 1];
    if (last && last.role === role) {
      last.content += `\n${turn.body}`;
    } else {
      merged.push({ role, content: turn.body });
    }
  }
  // Anthropic requires the conversation to start with a user turn.
  while (merged.length && merged[0].role !== 'user') {
    merged.shift();
  }
  return merged;
}

async function runAgentLoop(ctx, initialMessages) {
  const client = getClient();
  let messages = initialMessages;

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const response = await client.messages.create({
      model: config.claude.model,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: toolSchemas,
      messages,
    });

    const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use');
    if (toolUseBlocks.length === 0) {
      const textBlock = response.content.find((b) => b.type === 'text');
      return { text: textBlock ? textBlock.text : FALLBACK_MESSAGE };
    }

    messages = [...messages, { role: 'assistant', content: response.content }];

    const toolResults = [];
    for (const block of toolUseBlocks) {
      // eslint-disable-next-line no-await-in-loop
      const result = await executeTool(block.name, block.input, ctx);
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
    }
    messages = [...messages, { role: 'user', content: toolResults }];
  }

  ctx.flaggedForReview = true;
  logger.warn({ customerId: ctx.customerId }, 'agent loop exceeded max tool iterations');
  return { text: FALLBACK_MESSAGE };
}

async function sendAndLog(customer, text, { intent, confidence }) {
  conversationLogger.logOutbound(customer.id, { body: text, intent, confidence });
  try {
    await whatsappClient.sendTextMessage(customer.phone_number, text);
  } catch (err) {
    logger.error({ err, customerId: customer.id }, 'failed to deliver WhatsApp message');
  }
}

async function handleIncomingMessage({ phoneNumber, name, text, waMessageId, rawPayload }) {
  const customer = getOrCreateCustomer(phoneNumber, name);
  const conversationId = conversationLogger.logInbound(customer.id, {
    waMessageId,
    body: text,
    rawPayload,
  });

  const prescriptionCheck = prescriptionGuard.assess(text);
  if (prescriptionCheck.requiresPrescription) {
    await sendAndLog(customer, prescriptionGuard.FIXED_PRESCRIPTION_RESPONSE, {
      intent: 'prescription_request',
      confidence: 'high',
    });
    humanReviewQueue.flag({
      customerId: customer.id,
      conversationId,
      category: 'prescription',
      reason: `matched "${prescriptionCheck.matchedTerm}" (${prescriptionCheck.matchType})`,
      phoneNumber,
    });
    return;
  }

  const ctx = { customerId: customer.id, phoneNumber, conversationId, flaggedForReview: false };

  try {
    const history = conversationLogger.getRecentHistory(customer.id);
    const messages = buildMessages(history);
    const result = await runAgentLoop(ctx, messages);
    await sendAndLog(customer, result.text, {
      intent: 'agent_reply',
      confidence: ctx.flaggedForReview ? 'low' : 'high',
    });
  } catch (err) {
    const isCatalogError = err instanceof CatalogUnavailableError;
    logger.error({ err, phoneNumber, isCatalogError }, 'agent turn failed');
    await sendAndLog(customer, FALLBACK_MESSAGE, { intent: 'error_fallback', confidence: 'low' });
    humanReviewQueue.flag({
      customerId: customer.id,
      conversationId,
      category: isCatalogError ? 'catalog_unavailable' : 'other',
      reason: err.message,
      phoneNumber,
    });
  }
}

module.exports = { handleIncomingMessage, FALLBACK_MESSAGE, buildMessages };
