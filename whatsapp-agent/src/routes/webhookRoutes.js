'use strict';

const express = require('express');
const config = require('../config');
const logger = require('../logger');
const { verifySignature } = require('../whatsapp/verifySignature');
const { handleIncomingMessage } = require('../claude/agent');
const conversationLogger = require('../conversation/conversationLogger');
const humanReviewQueue = require('../review/humanReviewQueue');
const whatsappClient = require('../whatsapp/client');
const { getOrCreateCustomer } = require('../db');

const router = express.Router();

const PRESCRIPTION_UPLOAD_ACK =
  "Thanks, we've received your prescription photo. Our pharmacist will verify it and confirm shortly.";

// Meta's one-time webhook verification handshake.
router.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === config.whatsapp.verifyToken) {
    logger.info('webhook verification handshake succeeded');
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

router.post('/webhook', async (req, res) => {
  // Ack immediately so Meta doesn't retry-storm us; everything else happens async.
  res.sendStatus(200);

  const signature = req.get('X-Hub-Signature-256');
  if (!verifySignature(req.rawBody, signature)) {
    logger.warn('rejected webhook payload with invalid/missing signature');
    return;
  }

  try {
    const entries = req.body.entry || [];
    for (const entry of entries) {
      for (const change of entry.changes || []) {
        // eslint-disable-next-line no-await-in-loop
        await processChange(change.value || {});
      }
    }
  } catch (err) {
    logger.error({ err }, 'error processing webhook payload');
  }
});

async function processChange(value) {
  const messages = value.messages || [];
  const contacts = value.contacts || [];

  for (const message of messages) {
    const waMessageId = message.id;
    if (conversationLogger.wasAlreadyProcessed(waMessageId)) {
      continue; // Meta retried a delivery we already handled
    }

    const phoneNumber = message.from;
    const contact = contacts.find((c) => c.wa_id === phoneNumber);
    const name = contact && contact.profile ? contact.profile.name : undefined;

    if (message.type === 'image' || message.type === 'document') {
      // Most likely a prescription photo — always route to a human, never
      // attempt to interpret the image ourselves.
      const customer = getOrCreateCustomer(phoneNumber, name);
      const conversationId = conversationLogger.logInbound(customer.id, {
        waMessageId,
        body: `[${message.type} received]`,
        rawPayload: message,
      });
      conversationLogger.logOutbound(customer.id, {
        body: PRESCRIPTION_UPLOAD_ACK,
        intent: 'prescription_upload_ack',
        confidence: 'high',
      });
      humanReviewQueue.flag({
        customerId: customer.id,
        conversationId,
        category: 'prescription',
        reason: `customer sent a ${message.type}, likely a prescription`,
        phoneNumber,
      });
      // eslint-disable-next-line no-await-in-loop
      await whatsappClient
        .sendTextMessage(phoneNumber, PRESCRIPTION_UPLOAD_ACK)
        .catch((err) => logger.error({ err }, 'failed to send prescription upload ack'));
      continue;
    }

    const text = extractText(message);
    if (text === null) {
      const customer = getOrCreateCustomer(phoneNumber, name);
      conversationLogger.logInbound(customer.id, {
        waMessageId,
        body: `[unsupported message type: ${message.type}]`,
        rawPayload: message,
      });
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    await handleIncomingMessage({ phoneNumber, name, text, waMessageId, rawPayload: message });
  }
}

function extractText(message) {
  if (message.type === 'text') return message.text.body;
  if (message.type === 'interactive') {
    const interactive = message.interactive || {};
    if (interactive.button_reply) return interactive.button_reply.title;
    if (interactive.list_reply) return interactive.list_reply.title;
  }
  if (message.type === 'button') return message.button && message.button.text;
  return null;
}

module.exports = router;
