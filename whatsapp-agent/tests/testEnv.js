'use strict';

// Shared test bootstrap: isolates each test run from the real DB and the
// committed product catalog (order confirmation writes stock decrements
// back to disk, which must never touch the real data/products.json file).

const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.NODE_ENV = 'test';
process.env.DISABLE_SCHEDULER = 'true';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-agent-test-'));
process.env.DB_PATH = path.join(tmpDir, 'app.db');
process.env.PRODUCT_CATALOG_PATH = path.join(tmpDir, 'products.json');

fs.copyFileSync(
  path.join(__dirname, '..', 'data', 'products.json'),
  process.env.PRODUCT_CATALOG_PATH
);

module.exports = { tmpDir };
