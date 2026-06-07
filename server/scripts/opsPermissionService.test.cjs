const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ACTIONS,
  evaluatePermission,
  listAllowedActions,
  ROLE_ADMIN,
  ROLE_OPERATOR,
  ROLE_CLEANER
} = require('../services/permissionService');
const { resolveModulesForRole } = require('../services/ops/opsModuleRegistry');

test('admin has all cleaning actions', () => {
  const modules = resolveModulesForRole(ROLE_ADMIN);
  assert.equal(evaluatePermission({ role: ROLE_ADMIN, modules, action: ACTIONS.OPS_CLEANING_VIEW }).allowed, true);
  assert.equal(
    evaluatePermission({ role: ROLE_ADMIN, modules, action: ACTIONS.OPS_CLEANING_PAYMENT_WRITE }).allowed,
    true
  );
});

test('operator can view and mark cleaned but not write payment/settings', () => {
  const modules = resolveModulesForRole(ROLE_OPERATOR);
  assert.equal(evaluatePermission({ role: ROLE_OPERATOR, modules, action: ACTIONS.OPS_CLEANING_VIEW }).allowed, true);
  assert.equal(
    evaluatePermission({ role: ROLE_OPERATOR, modules, action: ACTIONS.OPS_CLEANING_MARK_CLEANED }).allowed,
    true
  );
  assert.equal(
    evaluatePermission({ role: ROLE_OPERATOR, modules, action: ACTIONS.OPS_CLEANING_PAYMENT_READ }).allowed,
    true
  );
  assert.equal(
    evaluatePermission({ role: ROLE_OPERATOR, modules, action: ACTIONS.OPS_CLEANING_PAYMENT_WRITE }).allowed,
    false
  );
  assert.equal(
    evaluatePermission({ role: ROLE_OPERATOR, modules, action: ACTIONS.OPS_CLEANING_SETTINGS_WRITE }).allowed,
    false
  );
  assert.equal(
    evaluatePermission({ role: ROLE_OPERATOR, modules, action: ACTIONS.OPS_CLEANING_DAY_INPUTS_WRITE }).allowed,
    true
  );
});

test('cleaner can only view cleaning and mark cleaned', () => {
  const modules = resolveModulesForRole(ROLE_CLEANER);
  const allowed = listAllowedActions({ role: ROLE_CLEANER, modules });
  assert.deepEqual(
    allowed.sort(),
    [ACTIONS.OPS_CLEANING_MARK_CLEANED, ACTIONS.OPS_CLEANING_VIEW].sort()
  );
  assert.equal(
    evaluatePermission({ role: ROLE_CLEANER, modules, action: ACTIONS.OPS_CLEANING_PAYMENT_READ }).allowed,
    false
  );
  assert.equal(
    evaluatePermission({ role: ROLE_CLEANER, modules, action: ACTIONS.OPS_CLEANING_DAY_INPUTS_WRITE }).allowed,
    false
  );
  assert.equal(
    evaluatePermission({ role: ROLE_CLEANER, modules, action: ACTIONS.OPS_RESERVATIONS_CLEANING_NOTES_WRITE })
      .allowed,
    false
  );
});

test('legacy tokens derive operator modules when modules omitted', () => {
  assert.equal(
    evaluatePermission({ role: ROLE_OPERATOR, action: ACTIONS.OPS_CLEANING_VIEW }).allowed,
    true
  );
});
