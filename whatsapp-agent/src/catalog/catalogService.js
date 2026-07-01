'use strict';

/**
 * Product catalog service.
 *
 * Today this is backed by a local JSON file (data/products.json), per the
 * "local JSON catalog" decision. To swap to Shopify later: replace
 * `readCatalogFile` below with an Admin API fetch (normalize the response
 * into the same product shape used here) and keep the rest of this module's
 * exports unchanged — every caller already treats these functions as
 * potentially async.
 *
 * Hard rule enforced here: if the catalog can't be loaded or parsed, we
 * throw CatalogUnavailableError instead of returning stale/partial/empty
 * data that could be mistaken for "no such product". Callers must not
 * invent an answer when this throws.
 */

const fs = require('fs');
const config = require('../config');
const logger = require('../logger');
const { CatalogUnavailableError } = require('./errors');

let cache = null; // { products, mtimeMs }

function readCatalogFile(catalogPath = config.productCatalogPath) {
  let stat;
  try {
    stat = fs.statSync(catalogPath);
  } catch (err) {
    throw new CatalogUnavailableError(`Catalog file not found at ${catalogPath}`, err);
  }

  if (cache && cache.mtimeMs === stat.mtimeMs && cache.path === catalogPath) {
    return cache.products;
  }

  let raw;
  try {
    raw = fs.readFileSync(catalogPath, 'utf8');
  } catch (err) {
    throw new CatalogUnavailableError(`Could not read catalog file at ${catalogPath}`, err);
  }

  let products;
  try {
    products = JSON.parse(raw);
  } catch (err) {
    throw new CatalogUnavailableError(`Catalog file at ${catalogPath} is not valid JSON`, err);
  }

  if (!Array.isArray(products)) {
    throw new CatalogUnavailableError(`Catalog file at ${catalogPath} did not contain an array`);
  }

  cache = { products, mtimeMs: stat.mtimeMs, path: catalogPath };
  return products;
}

function normalize(str) {
  return (str || '').toString().toLowerCase();
}

function toSummary(product) {
  return {
    sku: product.sku,
    name: product.name,
    brand: product.brand,
    category: product.category,
    subcategory: product.subcategory,
    price: product.price,
    currency: product.currency || 'INR',
    pack_size: product.pack_size,
    in_stock: product.stock_qty > 0,
    stock_qty: product.stock_qty,
    requires_prescription: !!product.requires_prescription,
    description: product.description,
  };
}

/**
 * Fuzzy search across name/brand/category/subcategory/tags/description.
 * Returns only products that actually exist in the catalog — never a
 * synthesized/guessed result.
 */
function searchProducts(query, { limit = 5 } = {}) {
  const products = readCatalogFile();
  const q = normalize(query);
  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];

  const scored = products
    .map((product) => {
      const haystacks = [
        normalize(product.name),
        normalize(product.brand),
        normalize(product.category),
        normalize(product.subcategory),
        normalize(product.description),
        (product.tags || []).map(normalize).join(' '),
      ].join(' | ');

      let score = 0;
      if (haystacks.includes(q)) score += 10;
      for (const token of tokens) {
        if (haystacks.includes(token)) score += 2;
      }
      return { product, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored.map((entry) => toSummary(entry.product));
}

function getProductBySku(sku) {
  const products = readCatalogFile();
  const product = products.find((p) => p.sku === sku);
  return product ? toSummary(product) : null;
}

/** Internal use only (order service needs the raw record, not the summary). */
function getRawProductBySku(sku) {
  const products = readCatalogFile();
  return products.find((p) => p.sku === sku) || null;
}

function checkAvailability(sku, quantity) {
  const product = getRawProductBySku(sku);
  if (!product) {
    return { available: false, reason: 'not_found' };
  }
  if (product.stock_qty <= 0) {
    return { available: false, reason: 'out_of_stock', stock_qty: 0 };
  }
  if (quantity > product.stock_qty) {
    return { available: false, reason: 'insufficient_stock', stock_qty: product.stock_qty };
  }
  return { available: true, stock_qty: product.stock_qty };
}

/** Best-effort stock decrement after a confirmed order (JSON-backed demo only). */
function decrementStock(sku, quantity) {
  const products = readCatalogFile();
  const product = products.find((p) => p.sku === sku);
  if (!product) return;
  product.stock_qty = Math.max(0, product.stock_qty - quantity);
  try {
    fs.writeFileSync(config.productCatalogPath, JSON.stringify(products, null, 2));
    cache = null; // force reload next read
  } catch (err) {
    // Non-fatal: the order is already recorded in the DB either way. Log and move on.
    logger.error({ err, sku }, 'failed to persist stock decrement to catalog file');
  }
}

module.exports = {
  searchProducts,
  getProductBySku,
  getRawProductBySku,
  checkAvailability,
  decrementStock,
};
