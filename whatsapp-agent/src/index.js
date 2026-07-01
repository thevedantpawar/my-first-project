'use strict';

const express = require('express');
const config = require('./config');
const logger = require('./logger');
require('./db'); // initializes schema on boot

const webhookRoutes = require('./routes/webhookRoutes');
const healthRoutes = require('./routes/healthRoutes');
const errorHandler = require('./middleware/errorHandler');
const scheduler = require('./reminders/scheduler');

const app = express();

// Capture the raw body so we can verify Meta's X-Hub-Signature-256 header.
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);

app.use(healthRoutes);
app.use(webhookRoutes);

app.use(errorHandler);

process.on('unhandledRejection', (err) => {
  logger.error({ err }, 'unhandled promise rejection');
});
process.on('uncaughtException', (err) => {
  logger.error({ err }, 'uncaught exception');
});

app.listen(config.port, () => {
  logger.info({ port: config.port }, 'whatsapp pharmacy agent listening');
  scheduler.start();
});

module.exports = app;
