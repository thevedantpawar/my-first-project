'use strict';

const crypto = require('crypto');
const config = require('../config');
const logger = require('../logger');

let warnedOnce = false;

/** Verifies the X-Hub-Signature-256 header Meta sends on every webhook POST. */
function verifySignature(rawBody, signatureHeader) {
  if (!config.whatsapp.appSecret) {
    if (!warnedOnce) {
      logger.warn(
        'WHATSAPP_APP_SECRET is not set — webhook signature verification is disabled. Do not run production traffic like this.'
      );
      warnedOnce = true;
    }
    return true;
  }
  if (!signatureHeader || !rawBody) return false;

  const expected =
    'sha256=' + crypto.createHmac('sha256', config.whatsapp.appSecret).update(rawBody).digest('hex');
  const sigBuf = Buffer.from(signatureHeader);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expBuf);
}

module.exports = { verifySignature };
