'use strict';

// Manually triggers one refill-reminder sweep (the same thing the daily
// cron job does). Useful for testing without waiting for REMINDER_CRON.

const { runDailyReminders } = require('../src/reminders/refillReminderService');

runDailyReminders()
  .then((result) => {
    console.log('Reminder sweep result:', result);
    process.exit(0);
  })
  .catch((err) => {
    console.error('Reminder sweep failed:', err);
    process.exit(1);
  });
