'use strict';

// Seeds one demo customer with a purchase old enough to be due for a
// refill reminder, so you can manually test `npm run reminders:run`.

const { db, getOrCreateCustomer } = require('../src/db');
const catalogService = require('../src/catalog/catalogService');

const customer = getOrCreateCustomer('919999999999', 'Demo Customer');
const product = catalogService.getRawProductBySku('SA-SNSCRN-50');

const purchasedAt = new Date(Date.now() - (product.duration_days + 1) * 24 * 60 * 60 * 1000).toISOString();

db.prepare(
  `INSERT INTO purchase_history (customer_id, sku, product_name, quantity, purchased_at, duration_days)
   VALUES (?, ?, ?, 1, ?, ?)`
).run(customer.id, product.sku, product.name, purchasedAt, product.duration_days);

console.log(
  `Seeded demo customer ${customer.phone_number} with a due refill for "${product.name}" (purchased ${product.duration_days + 1} days ago).`
);
console.log('Run `npm run reminders:run` to trigger the reminder sweep.');
