'use strict';

const { createDomainError } = require('../ops/domain/errors');

function isRebookEnabled(value = process.env.REBOOK_ENABLED) {
  return value === 'true';
}

function assertRebookEnabled() {
  if (!isRebookEnabled()) {
    throw createDomainError(
      'conflict',
      'REBOOK is temporarily disabled',
      { code: 'REBOOK_DISABLED' },
      503
    );
  }
}

module.exports = { isRebookEnabled, assertRebookEnabled };
