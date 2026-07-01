'use strict';

/**
 * Notification adapters for the human review queue. The queue table in
 * SQLite is always the source of truth (see humanReviewQueue.js) — these
 * adapters are best-effort pushes on top of it so a human finds out sooner.
 *
 * Only "none" (no-op) is enabled by default. Flip HUMAN_REVIEW_NOTIFY_METHOD
 * once you've decided where your team actually wants these to land
 * (Slack channel, email, helpdesk, etc).
 */

const axios = require('axios');
const config = require('../config');
const logger = require('../logger');

async function notifySlack(entry) {
  if (!config.humanReview.slackWebhookUrl) {
    logger.warn('HUMAN_REVIEW_NOTIFY_METHOD=slack but SLACK_WEBHOOK_URL is not set; skipping');
    return;
  }
  try {
    await axios.post(config.humanReview.slackWebhookUrl, {
      text: `*[${entry.category}]* review needed for ${entry.phoneNumber}\n${entry.reason || ''}`,
    });
  } catch (err) {
    logger.error({ err }, 'failed to post human review notification to Slack');
  }
}

async function notifyEmail(entry) {
  // Stub: wire up SMTP/SendGrid/etc here once an email provider is chosen.
  logger.warn({ entry }, 'email notification requested but no email provider is configured yet');
}

async function notify(entry) {
  switch (config.humanReview.notifyMethod) {
    case 'slack':
      return notifySlack(entry);
    case 'email':
      return notifyEmail(entry);
    default:
      return; // 'none' — the DB queue row is enough for now
  }
}

module.exports = { notify };
