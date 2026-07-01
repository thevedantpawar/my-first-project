'use strict';

class CatalogUnavailableError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'CatalogUnavailableError';
    this.cause = cause;
  }
}

module.exports = { CatalogUnavailableError };
