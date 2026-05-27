const ISSUANCE_SOURCE_PURCHASE = 'purchase';
const ISSUANCE_SOURCE_CANCELLATION_COMPENSATION = 'cancellation_compensation';
const ISSUANCE_SOURCE_GOODWILL_OPS = 'goodwill_ops';

const GIFT_VOUCHER_ISSUANCE_SOURCES = [
  ISSUANCE_SOURCE_PURCHASE,
  ISSUANCE_SOURCE_CANCELLATION_COMPENSATION,
  ISSUANCE_SOURCE_GOODWILL_OPS
];

function purchasedIssuanceClause() {
  return {
    $or: [
      { issuanceSource: ISSUANCE_SOURCE_PURCHASE },
      { issuanceSource: { $exists: false } }
    ]
  };
}

/**
 * Merge purchase-only issuance filter with caller constraints.
 * Preserves existing $or (e.g. search, attribution) by wrapping in $and.
 */
function purchasedGiftVoucherQuery(extra = {}) {
  const purchaseClause = purchasedIssuanceClause();
  const normalized = extra && typeof extra === 'object' ? { ...extra } : {};

  if (Object.keys(normalized).length === 0) {
    return purchaseClause;
  }

  if (Array.isArray(normalized.$and)) {
    return {
      ...normalized,
      $and: [...normalized.$and, purchaseClause]
    };
  }

  return {
    $and: [normalized, purchaseClause]
  };
}

module.exports = {
  ISSUANCE_SOURCE_PURCHASE,
  ISSUANCE_SOURCE_CANCELLATION_COMPENSATION,
  ISSUANCE_SOURCE_GOODWILL_OPS,
  GIFT_VOUCHER_ISSUANCE_SOURCES,
  purchasedGiftVoucherQuery
};
