'use strict';

const cron = require('node-cron');
const config = require('../config');
const logger = require('../logger');
const { runDailyReminders } = require('./refillReminderService');

function start() {
  if (config.reminder.disabled) {
    logger.info('refill reminder scheduler disabled (DISABLE_SCHEDULER=true)');
    return null;
  }
  if (!cron.validate(config.reminder.cron)) {
    logger.error({ cron: config.reminder.cron }, 'invalid REMINDER_CRON expression; scheduler not started');
    return null;
  }
  const task = cron.schedule(config.reminder.cron, () => {
    runDailyReminders().catch((err) => logger.error({ err }, 'refill reminder sweep crashed'));
  });
  logger.info({ cron: config.reminder.cron }, 'refill reminder scheduler started');
  return task;
}

module.exports = { start };
