const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildOpsWorkspaceVisibilityFilter,
  smokeRecordMatchClause,
  abandonedCheckoutMatchClause
} = require('../services/giftVouchers/giftVoucherOpsVisibility');

test('operational default shows lifecycle statuses only', () => {
  const filter = buildOpsWorkspaceVisibilityFilter({});
  assert.deepEqual(filter.status, {
    $in: ['active', 'partially_redeemed', 'redeemed', 'expired']
  });
  assert.ok(Array.isArray(filter.$nor));
});

test('operational default excludes smoke records', () => {
  const filter = buildOpsWorkspaceVisibilityFilter({});
  const smokeClause = smokeRecordMatchClause();
  assert.ok(filter.$nor.some((clause) => JSON.stringify(clause) === JSON.stringify(smokeClause)));
});

test('operational default excludes abandoned checkout attempts', () => {
  const filter = buildOpsWorkspaceVisibilityFilter({});
  const abandonedClause = abandonedCheckoutMatchClause();
  assert.ok(filter.$nor.some((clause) => JSON.stringify(clause) === JSON.stringify(abandonedClause)));
});

test('explicit pending_payment includes abandoned checkout bucket', () => {
  const filter = buildOpsWorkspaceVisibilityFilter({ status: 'pending_payment' });
  assert.equal(filter.status, 'pending_payment');
  const abandonedClause = abandonedCheckoutMatchClause();
  assert.ok(
    !filter.$nor?.some((clause) => JSON.stringify(clause) === JSON.stringify(abandonedClause))
  );
});

test('includeSmoke reveals smoke records in operational view', () => {
  const filter = buildOpsWorkspaceVisibilityFilter({ includeSmoke: '1' });
  const smokeClause = smokeRecordMatchClause();
  assert.ok(!filter.$nor?.some((clause) => JSON.stringify(clause) === JSON.stringify(smokeClause)));
});

test('visibility=all without status hides non-operational statuses', () => {
  const filter = buildOpsWorkspaceVisibilityFilter({ visibility: 'all' });
  assert.deepEqual(filter.status, {
    $nin: ['pending_payment', 'voided', 'draft', 'refunded']
  });
});
