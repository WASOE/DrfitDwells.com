'use strict';

const OPERATIONAL_STATUSES = ['active', 'partially_redeemed', 'redeemed', 'expired'];
const HIDDEN_STATUSES = ['pending_payment', 'voided', 'draft', 'refunded'];
const ABANDONED_CHECKOUT_STATUSES = ['pending_payment'];

const SMOKE_PURCHASE_REQUEST_PREFIX = /^gvr_smoke_/i;
const SMOKE_BUYER_EMAIL_PREFIX = /^smoke-payments\+/i;
const SMOKE_BUYER_NAME_PREFIX = /^SMOKE PAYMENTS/i;

function isTruthy(value) {
  if (value === true || value === 1) return true;
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function normalizeVisibility(query = {}) {
  const raw = String(query.visibility || 'operational').trim().toLowerCase();
  if (raw === 'all') return 'all';
  return 'operational';
}

function smokeRecordMatchClause() {
  return {
    $or: [
      { purchaseRequestId: { $regex: SMOKE_PURCHASE_REQUEST_PREFIX } },
      { buyerEmail: { $regex: SMOKE_BUYER_EMAIL_PREFIX } },
      { buyerName: { $regex: SMOKE_BUYER_NAME_PREFIX } }
    ]
  };
}

function abandonedCheckoutMatchClause() {
  return {
    $or: [
      { status: { $in: ABANDONED_CHECKOUT_STATUSES } },
      {
        status: 'voided',
        activatedAt: null,
        $or: [{ code: null }, { code: { $exists: false } }, { code: '' }]
      }
    ]
  };
}

function mergeAndClauses(...clauses) {
  const normalized = clauses.filter((clause) => clause && Object.keys(clause).length > 0);
  if (normalized.length === 0) return {};
  if (normalized.length === 1) return normalized[0];
  return { $and: normalized };
}

function appendNorClause(filter, norClause) {
  if (!norClause) return filter;
  if (!filter.$nor) {
    return { ...filter, $nor: [norClause] };
  }
  return {
    ...filter,
    $nor: [...filter.$nor, norClause]
  };
}

/**
 * Default OPS workspace visibility for purchased gift vouchers.
 * Operational lifecycle rows only; hides smoke, abandoned checkout noise, and non-operational statuses.
 */
function buildOpsWorkspaceVisibilityFilter(query = {}) {
  const visibility = normalizeVisibility(query);
  const includeSmoke = isTruthy(query.includeSmoke);
  const includeAbandoned = isTruthy(query.includeAbandoned);
  const explicitStatus = query.status ? String(query.status) : '';

  let filter = {};

  if (explicitStatus) {
    filter.status = explicitStatus;
  } else if (visibility === 'operational') {
    filter.status = { $in: OPERATIONAL_STATUSES };
  } else {
    filter.status = { $nin: HIDDEN_STATUSES };
  }

  if (!includeSmoke) {
    filter = appendNorClause(filter, smokeRecordMatchClause());
  }

  if (!includeAbandoned && !explicitStatus) {
    filter = appendNorClause(filter, abandonedCheckoutMatchClause());
  }

  if (!includeAbandoned && explicitStatus === 'voided') {
    filter = appendNorClause(filter, {
      status: 'voided',
      activatedAt: null,
      $or: [{ code: null }, { code: { $exists: false } }, { code: '' }]
    });
  }

  return filter;
}

function describeAppliedWorkspaceVisibility(query = {}) {
  const visibility = normalizeVisibility(query);
  const explicitStatus = query.status ? String(query.status) : '';
  return {
    visibility,
    status: explicitStatus || (visibility === 'operational' ? OPERATIONAL_STATUSES.join(',') : 'all_except_hidden'),
    includeSmoke: isTruthy(query.includeSmoke),
    includeAbandoned: isTruthy(query.includeAbandoned),
    hiddenByDefault: {
      statuses: HIDDEN_STATUSES,
      smoke: !isTruthy(query.includeSmoke),
      abandonedCheckout: !isTruthy(query.includeAbandoned) && !explicitStatus
    }
  };
}

module.exports = {
  OPERATIONAL_STATUSES,
  HIDDEN_STATUSES,
  ABANDONED_CHECKOUT_STATUSES,
  normalizeVisibility,
  smokeRecordMatchClause,
  abandonedCheckoutMatchClause,
  buildOpsWorkspaceVisibilityFilter,
  describeAppliedWorkspaceVisibility
};
