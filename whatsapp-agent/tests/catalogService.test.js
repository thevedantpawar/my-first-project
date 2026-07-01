'use strict';

require('./testEnv');
const assert = require('node:assert');
const { test } = require('node:test');
const config = require('../src/config');
const catalogService = require('../src/catalog/catalogService');
const { CatalogUnavailableError } = require('../src/catalog/errors');

test('searchProducts finds sunscreen products by keyword', () => {
  const results = catalogService.searchProducts('sunscreen');
  assert.ok(results.length > 0);
  for (const r of results) {
    assert.strictEqual(r.subcategory, 'sunscreen');
  }
});

test('searchProducts returns nothing for gibberish query', () => {
  const results = catalogService.searchProducts('xyznonexistentproduct123');
  assert.strictEqual(results.length, 0);
});

test('getProductBySku returns null for unknown sku (never invents a product)', () => {
  assert.strictEqual(catalogService.getProductBySku('DOES-NOT-EXIST'), null);
});

test('checkAvailability flags an out-of-stock product', () => {
  const result = catalogService.checkAvailability('SA-CLNSR-CREAM', 1);
  assert.strictEqual(result.available, false);
  assert.strictEqual(result.reason, 'out_of_stock');
});

test('checkAvailability flags insufficient stock', () => {
  const result = catalogService.checkAvailability('SA-SNSCRN-GEL', 999999);
  assert.strictEqual(result.available, false);
  assert.strictEqual(result.reason, 'insufficient_stock');
});

test('throws CatalogUnavailableError instead of guessing when the catalog file is missing', () => {
  const original = config.productCatalogPath;
  config.productCatalogPath = '/nonexistent/products.json';
  try {
    assert.throws(() => catalogService.searchProducts('sunscreen'), CatalogUnavailableError);
  } finally {
    config.productCatalogPath = original;
  }
});
