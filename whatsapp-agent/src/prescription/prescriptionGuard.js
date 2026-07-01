'use strict';

/**
 * Deterministic pre-filter for prescription-medicine requests.
 *
 * This runs on every inbound message BEFORE the Claude call, and its
 * decision is final for that turn: if it matches, we send the fixed
 * response and route to the human queue, full stop — we never let the
 * model talk its way around this gate. Claude also gets its own
 * `flag_for_human_review` tool as a second line of defence for phrasing
 * this list doesn't catch, but this module is the primary safety net
 * because it can't be prompt-injected or reasoned away.
 */

const fs = require('fs');
const config = require('../config');
const logger = require('../logger');

const FIXED_PRESCRIPTION_RESPONSE =
  'Please share a photo of your prescription — our pharmacist will verify and confirm.';

let termsCache = null;

function loadTerms() {
  if (termsCache) return termsCache;
  try {
    const raw = fs.readFileSync(config.prescriptionTermsPath, 'utf8');
    termsCache = JSON.parse(raw);
  } catch (err) {
    // Fail closed: if we can't load the prescription term list, treat every
    // message as needing human review rather than silently skipping the check.
    logger.error({ err }, 'failed to load prescription terms; failing closed');
    termsCache = { exact_terms: [], suffix_patterns: [], regex_patterns: [], _loadFailed: true };
  }
  return termsCache;
}

function assess(text) {
  const terms = loadTerms();

  if (terms._loadFailed) {
    return { requiresPrescription: true, matchedTerm: null, matchType: 'terms_unavailable' };
  }

  const normalized = (text || '').toLowerCase();
  if (!normalized.trim()) {
    return { requiresPrescription: false };
  }

  for (const term of terms.exact_terms || []) {
    if (normalized.includes(term)) {
      return { requiresPrescription: true, matchedTerm: term, matchType: 'exact_term' };
    }
  }

  const words = normalized.split(/[^a-z0-9]+/).filter(Boolean);
  for (const word of words) {
    for (const suffix of terms.suffix_patterns || []) {
      if (word.length > suffix.length + 2 && word.endsWith(suffix)) {
        return { requiresPrescription: true, matchedTerm: word, matchType: 'suffix_pattern' };
      }
    }
  }

  for (const pattern of terms.regex_patterns || []) {
    const re = new RegExp(pattern, 'i');
    if (re.test(normalized)) {
      return { requiresPrescription: true, matchedTerm: pattern, matchType: 'regex_pattern' };
    }
  }

  return { requiresPrescription: false };
}

module.exports = { assess, FIXED_PRESCRIPTION_RESPONSE };
