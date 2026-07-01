'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../config');
const logger = require('../logger');

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

logger.info({ dbPath: config.dbPath }, 'database ready');

function getOrCreateCustomer(phoneNumber, name) {
  const existing = db.prepare('SELECT * FROM customers WHERE phone_number = ?').get(phoneNumber);
  if (existing) return existing;
  const info = db
    .prepare('INSERT INTO customers (phone_number, name) VALUES (?, ?)')
    .run(phoneNumber, name || null);
  return db.prepare('SELECT * FROM customers WHERE id = ?').get(info.lastInsertRowid);
}

module.exports = { db, getOrCreateCustomer };
