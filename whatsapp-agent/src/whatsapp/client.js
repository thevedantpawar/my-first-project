'use strict';

const axios = require('axios');
const config = require('../config');
const logger = require('../logger');

class WhatsAppSendError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'WhatsAppSendError';
    this.cause = cause;
  }
}

function assertConfigured() {
  if (!config.whatsapp.token || !config.whatsapp.phoneNumberId) {
    throw new WhatsAppSendError(
      'WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID are not set. Add them to .env before sending messages.'
    );
  }
}

function apiUrl() {
  return `https://graph.facebook.com/${config.whatsapp.apiVersion}/${config.whatsapp.phoneNumberId}/messages`;
}

async function post(payload) {
  assertConfigured();
  try {
    const response = await axios.post(apiUrl(), payload, {
      headers: {
        Authorization: `Bearer ${config.whatsapp.token}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });
    return response.data;
  } catch (err) {
    const details = err.response ? err.response.data : err.message;
    logger.error({ details }, 'WhatsApp API call failed');
    throw new WhatsAppSendError('Failed to send WhatsApp message', err);
  }
}

/** Free-form text message (only deliverable within the 24h customer service window). */
async function sendTextMessage(to, body) {
  return post({
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body },
  });
}

/**
 * Pre-approved template message, required for proactive/business-initiated
 * messages outside the 24h window (e.g. refill reminders). `components`
 * follows the Meta template component format for variable substitution.
 */
async function sendTemplateMessage(to, templateName, languageCode, components = []) {
  return post({
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
      components,
    },
  });
}

module.exports = { sendTextMessage, sendTemplateMessage, WhatsAppSendError };
