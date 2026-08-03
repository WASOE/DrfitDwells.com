'use strict';

/**
 * Shared multi-unit recovery / capacity error taxonomy (S0 first; S1 expands later).
 * Binding: docs/architecture/multi-unit-cabin-type-capacity-and-paid-recovery-lock.md §13
 */

const {
  RECOVERY_ERROR_CATALOG,
  getRecoveryErrorCatalogEntry
} = require('./multiUnitPaidOrphanRecoveryErrors');

/** S1 capacity codes reserved; permanence must use this module when implemented. */
const CAPACITY_ERROR_CODES = Object.freeze({
  INVENTORY_EXHAUSTED: {
    summary: 'Inventory exhausted before payment',
    permanent: false,
    retryable: false
  },
  INVENTORY_EXHAUSTED_AFTER_PAYMENT: {
    summary: 'Inventory exhausted after payment',
    permanent: true,
    retryable: false
  },
  DUPLICATE_STAY_CONFLICT: {
    summary: 'Commercial stay exclusivity conflict',
    permanent: true,
    retryable: false
  }
});

function isPermanentRecoveryOrCapacityCode(code) {
  const recovery = getRecoveryErrorCatalogEntry(code);
  if (recovery) return recovery.permanent === true;
  const capacity = CAPACITY_ERROR_CODES[code];
  if (capacity) return capacity.permanent === true;
  return null;
}

module.exports = {
  RECOVERY_ERROR_CATALOG,
  CAPACITY_ERROR_CODES,
  getRecoveryErrorCatalogEntry,
  isPermanentRecoveryOrCapacityCode
};
