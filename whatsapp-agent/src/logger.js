'use strict';

const pino = require('pino');
const config = require('./config');

const logger = pino(
  process.env.NODE_ENV === 'test'
    ? { level: 'silent' }
    : {
        level: config.logLevel,
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:standard' },
        },
      }
);

module.exports = logger;
