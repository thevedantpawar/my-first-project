'use strict';

const path = require('path');
require('dotenv').config();

function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return value === 'true' || value === '1';
}

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  logLevel: process.env.LOG_LEVEL || 'info',

  whatsapp: {
    token: process.env.WHATSAPP_TOKEN || '',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '',
    apiVersion: process.env.WHATSAPP_API_VERSION || 'v21.0',
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || '',
    appSecret: process.env.WHATSAPP_APP_SECRET || '',
    reminderTemplateName: process.env.WHATSAPP_REMINDER_TEMPLATE_NAME || 'refill_reminder',
    reminderTemplateLang: process.env.WHATSAPP_REMINDER_TEMPLATE_LANG || 'en',
  },

  claude: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    model: process.env.CLAUDE_MODEL || 'claude-sonnet-5',
  },

  dbPath: path.resolve(process.cwd(), process.env.DB_PATH || './data/app.db'),
  productCatalogPath: path.resolve(
    process.cwd(),
    process.env.PRODUCT_CATALOG_PATH || './data/products.json'
  ),
  prescriptionTermsPath: path.resolve(
    process.cwd(),
    process.env.PRESCRIPTION_TERMS_PATH || './data/prescription_terms.json'
  ),

  reminder: {
    cron: process.env.REMINDER_CRON || '0 9 * * *',
    windowDays: parseInt(process.env.REMINDER_WINDOW_DAYS || '3', 10),
    disabled: bool(process.env.DISABLE_SCHEDULER, false),
  },

  humanReview: {
    notifyMethod: process.env.HUMAN_REVIEW_NOTIFY_METHOD || 'none',
    slackWebhookUrl: process.env.SLACK_WEBHOOK_URL || '',
  },
};

module.exports = config;
