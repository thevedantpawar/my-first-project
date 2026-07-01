'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const config = require('../config');

let client = null;

function getClient() {
  if (!config.claude.apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. Add it to .env before the agent can handle messages.'
    );
  }
  if (!client) {
    client = new Anthropic({ apiKey: config.claude.apiKey });
  }
  return client;
}

module.exports = { getClient };
