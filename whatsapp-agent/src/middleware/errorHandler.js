'use strict';

const logger = require('../logger');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  logger.error({ err, path: req.path }, 'unhandled request error');
  res.status(500).json({ error: 'internal_error' });
}

module.exports = errorHandler;
