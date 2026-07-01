'use strict';

require('./testEnv');
const assert = require('node:assert');
const { test } = require('node:test');
const prescriptionGuard = require('../src/prescription/prescriptionGuard');

test('flags a known prescription drug name', () => {
  const result = prescriptionGuard.assess('do you have azithromycin 500 available');
  assert.strictEqual(result.requiresPrescription, true);
  assert.strictEqual(result.matchType, 'exact_term');
});

test('flags an unlisted drug via generic class suffix pattern', () => {
  const result = prescriptionGuard.assess('need norfloxacin tablets please');
  assert.strictEqual(result.requiresPrescription, true);
  assert.strictEqual(result.matchType, 'suffix_pattern');
});

test('flags explicit mentions of "prescription"', () => {
  const result = prescriptionGuard.assess('I have a prescription for this, can you fulfill it');
  assert.strictEqual(result.requiresPrescription, true);
});

test('does not flag an OTC skincare query', () => {
  const result = prescriptionGuard.assess('do you have vitamin c serum in stock');
  assert.strictEqual(result.requiresPrescription, false);
});

test('does not flag an OTC medicine query', () => {
  const result = prescriptionGuard.assess('what is the price of paracetamol 500mg');
  assert.strictEqual(result.requiresPrescription, false);
});
