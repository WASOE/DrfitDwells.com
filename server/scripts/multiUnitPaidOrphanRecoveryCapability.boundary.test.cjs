/**
 * S0 multi-unit paid-orphan recovery — source-boundary + ALS behavior tests.
 *
 * Boundary section: static analysis of server/ (fs + regex, AST optional per
 * task scope) enforcing that `runInMultiUnitPaidOrphanRecoveryContext` (the
 * ALS runner) is importable ONLY by
 * `server/services/checkout/multiUnitPaidOrphanRecoveryService.js`, that the
 * recovery CLI never imports the capability module at all, that the recovery
 * service never re-exports the runner, and that no file dynamically requires
 * the capability module via a variable (bypassing static detection).
 *
 * ALS section: behavioral guarantees of AsyncLocalStorage-backed incident
 * scoping — store retention across await/setTimeout, isolation across
 * parallel incidents, and fail-closed scope mismatch/assert semantics.
 *
 * Run:
 *   node --test --test-concurrency=1 \
 *     server/scripts/multiUnitPaidOrphanRecoveryCapability.boundary.test.cjs
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SERVER_ROOT = path.resolve(__dirname, '..');

const CAPABILITY_ABS_PATH = path.join(
  SERVER_ROOT,
  'services',
  'checkout',
  'multiUnitPaidOrphanRecoveryCapability.js'
);
const RECOVERY_SERVICE_ABS_PATH = path.join(
  SERVER_ROOT,
  'services',
  'checkout',
  'multiUnitPaidOrphanRecoveryService.js'
);
const CLI_ABS_PATH = path.join(
  SERVER_ROOT,
  'scripts',
  'recoverMultiUnitPaidOrphanCheckout.js'
);

const RUNNER_NAME = 'runInMultiUnitPaidOrphanRecoveryContext';
const CAPABILITY_MODULE_TOKEN = 'multiUnitPaidOrphanRecoveryCapability';

const EXCLUDED_DIR_NAMES = new Set(['node_modules', '.scratch', 'coverage', '.git']);

/* ---------------------------------------------------------------------- *
 * Static-analysis helpers (exercised directly by self-tests below, then
 * applied to the real server/ tree).
 * ---------------------------------------------------------------------- */

function walkJsCjsFiles(rootDir) {
  const out = [];
  (function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (EXCLUDED_DIR_NAMES.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && /\.(js|cjs)$/.test(entry.name)) {
        out.push(full);
      }
    }
  })(rootDir);
  return out;
}

function isTestFile(absPath) {
  return (
    /\.test\.(js|cjs)$/.test(absPath) ||
    /\.acceptance\.proof\.cjs$/.test(absPath) ||
    /\.acceptance\.helpers\.cjs$/.test(absPath)
  );
}

/** Whether `source` references the ALS runner identifier at all (require/use). */
function referencesRunnerIdentifier(source) {
  return new RegExp(`\\b${RUNNER_NAME}\\b`).test(source);
}

/**
 * Detect `require(<identifier>)` where `<identifier>` was assigned (const/let/var)
 * a string literal containing the capability module token — i.e. a dynamic
 * require that a naive "grep for require('...multiUnitPaidOrphanRecoveryCapability')"
 * scan would miss.
 * Returns the list of matched variable names (empty when none found).
 */
function findDynamicRequireOfCapability(source) {
  const assignedVars = new Set();
  const assignRe = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(['"`])((?:(?!\2)[^\\]|\\.)*)\2/g;
  let m;
  while ((m = assignRe.exec(source))) {
    const [, varName, , value] = m;
    if (value.includes(CAPABILITY_MODULE_TOKEN)) {
      assignedVars.add(varName);
    }
  }
  if (assignedVars.size === 0) return [];

  const hits = [];
  const requireRe = /require\(\s*([A-Za-z_$][\w$]*)\s*\)/g;
  while ((m = requireRe.exec(source))) {
    if (assignedVars.has(m[1])) hits.push(m[1]);
  }
  return hits;
}

/** Whether a file's `require(...)` calls reference the capability module path directly. */
function requiresCapabilityModuleLiterally(source) {
  const re = /require\(\s*(['"`])((?:(?!\1)[^\\]|\\.)*)\1\s*\)/g;
  let m;
  while ((m = re.exec(source))) {
    if (m[2].includes(CAPABILITY_MODULE_TOKEN)) return true;
  }
  return false;
}

/** Whether `source` (a whole file) mentions the capability module token anywhere. */
function mentionsCapabilityModuleToken(source) {
  return source.includes(CAPABILITY_MODULE_TOKEN);
}

/**
 * Extract the outermost `module.exports = { ... }` object body (non-greedy,
 * good enough for this codebase's flat export style — AST optional per scope).
 */
function extractModuleExportsBlock(source) {
  const m = source.match(/module\.exports\s*=\s*\{([\s\S]*?)\n\};?/);
  return m ? m[1] : null;
}

/** Whether an exports object body re-exports the runner (shorthand or aliased). */
function exportsBlockReexportsRunner(exportsBlock) {
  if (!exportsBlock) return false;
  const shorthandRe = new RegExp(`(^|[\\s,{])${RUNNER_NAME}\\s*(,|$)`, 'm');
  const aliasRe = new RegExp(`:\\s*${RUNNER_NAME}\\b`);
  return shorthandRe.test(exportsBlock) || aliasRe.test(exportsBlock);
}

/* ---------------------------------------------------------------------- *
 * Self-tests of the detectors themselves (fixtures are in-memory strings —
 * no synthetic files written to disk).
 * ---------------------------------------------------------------------- */

test('detector self-test: referencesRunnerIdentifier matches destructured require', () => {
  const src = `const { runInMultiUnitPaidOrphanRecoveryContext } = require('./multiUnitPaidOrphanRecoveryCapability');`;
  assert.equal(referencesRunnerIdentifier(src), true);
  assert.equal(referencesRunnerIdentifier('const x = 1;'), false);
});

test('detector self-test: findDynamicRequireOfCapability flags variable-indirected require', () => {
  const hostileFixture = `
    'use strict';
    const capModulePath = './multiUnitPaidOrphanRecoveryCapability';
    const { runInMultiUnitPaidOrphanRecoveryContext } = require(capModulePath);
  `;
  const hits = findDynamicRequireOfCapability(hostileFixture);
  assert.ok(hits.length > 0, 'expected dynamic require indirection to be detected');
  assert.ok(hits.includes('capModulePath'));

  const benignFixture = `
    'use strict';
    const { assertMultiUnitPaidOrphanRecoveryContext } = require('./multiUnitPaidOrphanRecoveryCapability');
  `;
  assert.deepEqual(findDynamicRequireOfCapability(benignFixture), []);
});

test('detector self-test: exportsBlockReexportsRunner catches shorthand and aliased export', () => {
  const shorthandExports = `
  foo,
  runInMultiUnitPaidOrphanRecoveryContext,
  bar
`;
  assert.equal(exportsBlockReexportsRunner(shorthandExports), true);

  const aliasedExports = `
  foo,
  startRecoveryContext: runInMultiUnitPaidOrphanRecoveryContext,
  bar
`;
  assert.equal(exportsBlockReexportsRunner(aliasedExports), true);

  const cleanExports = `
  assertMultiUnitPaidOrphanRecoveryContext,
  getMultiUnitPaidOrphanRecoveryContext
`;
  assert.equal(exportsBlockReexportsRunner(cleanExports), false);
});

test('detector self-test: isTestFile excludes *.test.cjs / *.test.js from runner-import rule', () => {
  assert.equal(isTestFile('/x/y/multiUnitPaidOrphanRecovery.test.cjs'), true);
  assert.equal(isTestFile('/x/y/multiUnitPaidOrphanRecoveryCapability.boundary.test.cjs'), true);
  assert.equal(isTestFile('/x/y/multiUnitPaidOrphanRecoveryService.js'), false);
});

test('detector self-test: requiresCapabilityModuleLiterally matches direct and multiline require', () => {
  const direct = `const cap = require('./multiUnitPaidOrphanRecoveryCapability');`;
  assert.equal(requiresCapabilityModuleLiterally(direct), true);

  const multiline = `const cap = require(\n  './services/checkout/multiUnitPaidOrphanRecoveryCapability'\n);`;
  assert.equal(requiresCapabilityModuleLiterally(multiline), true);

  const unrelated = `const x = require('./otherModule');`;
  assert.equal(requiresCapabilityModuleLiterally(unrelated), false);
});

test('detector self-test: referencesRunnerIdentifier matches aliased re-export usage', () => {
  const aliased = `
    const { runInMultiUnitPaidOrphanRecoveryContext: runRecovery } = require('./multiUnitPaidOrphanRecoveryCapability');
    module.exports = { runRecovery };
  `;
  assert.equal(referencesRunnerIdentifier(aliased), true);
  assert.equal(requiresCapabilityModuleLiterally(aliased), true);
});

test('detector self-test: findDynamicRequireOfCapability + runner reference covers variable-path hostile import', () => {
  const fixture = `
    const mod = './checkout/multiUnitPaidOrphanRecoveryCapability';
    const { runInMultiUnitPaidOrphanRecoveryContext } = require(mod);
module.exports = {
  runInMultiUnitPaidOrphanRecoveryContext
};
`;
  assert.ok(findDynamicRequireOfCapability(fixture).includes('mod'));
  assert.equal(referencesRunnerIdentifier(fixture), true);
  assert.equal(exportsBlockReexportsRunner(extractModuleExportsBlock(fixture)), true);
});

test('boundary: no first-party server .mjs files exist outside node_modules', () => {
  const firstPartyMjs = [];
  (function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (EXCLUDED_DIR_NAMES.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.mjs')) firstPartyMjs.push(full);
    }
  })(SERVER_ROOT);
  assert.deepEqual(firstPartyMjs, [], 'first-party server ESM .mjs files are not expected in S0 CJS tree');
});

test('boundary: CLI must not import the capability module (fixture + live file)', () => {
  const hostileCliFixture = `
    const { assertMultiUnitPaidOrphanRecoveryContext } = require('../services/checkout/multiUnitPaidOrphanRecoveryCapability');
  `;
  assert.equal(requiresCapabilityModuleLiterally(hostileCliFixture), true);
  assert.equal(mentionsCapabilityModuleToken(hostileCliFixture), true);

  const cliSource = fs.readFileSync(CLI_ABS_PATH, 'utf8');
  assert.equal(requiresCapabilityModuleLiterally(cliSource), false);
  assert.equal(referencesRunnerIdentifier(cliSource), false);
});

test('boundary: recovery service must not re-export the ALS runner (fixture + live file)', () => {
  const hostileExport = `
module.exports = {
  recoverAllowlistedMultiUnitPaidOrphanCheckout,
  runInMultiUnitPaidOrphanRecoveryContext
};
`;
  assert.equal(exportsBlockReexportsRunner(extractModuleExportsBlock(hostileExport)), true);

  const serviceSource = fs.readFileSync(RECOVERY_SERVICE_ABS_PATH, 'utf8');
  assert.equal(exportsBlockReexportsRunner(extractModuleExportsBlock(serviceSource)), false);
});

/* ---------------------------------------------------------------------- *
 * Real server/ tree boundary assertions.
 * ---------------------------------------------------------------------- */

test('boundary: only multiUnitPaidOrphanRecoveryService.js (or test files) may import the ALS runner', () => {
  const files = walkJsCjsFiles(SERVER_ROOT).filter((f) => f !== CAPABILITY_ABS_PATH);
  const violations = [];

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    if (!referencesRunnerIdentifier(source)) continue;
    if (isTestFile(file)) continue; // ALS unit tests are explicitly allowed to import the runner.
    if (file === RECOVERY_SERVICE_ABS_PATH) continue;
    violations.push(path.relative(SERVER_ROOT, file));
  }

  assert.deepEqual(
    violations,
    [],
    `Only multiUnitPaidOrphanRecoveryService.js (and *.test.cjs/*.test.js files) may reference ` +
      `${RUNNER_NAME}. Unauthorized importers found:\n${violations.join('\n')}`
  );
});

test('boundary: multiUnitPaidOrphanRecoveryService.js does in fact import the runner (sanity check)', () => {
  const source = fs.readFileSync(RECOVERY_SERVICE_ABS_PATH, 'utf8');
  assert.equal(
    referencesRunnerIdentifier(source),
    true,
    'expected the allowlisted recovery service to import the runner it is permitted to use'
  );
});

test('boundary: recoverMultiUnitPaidOrphanCheckout.js CLI must not import the capability module at all', () => {
  const source = fs.readFileSync(CLI_ABS_PATH, 'utf8');
  assert.equal(
    requiresCapabilityModuleLiterally(source),
    false,
    'CLI must never require() the capability module directly'
  );
  assert.equal(
    mentionsCapabilityModuleToken(source),
    false,
    `CLI source must not mention "${CAPABILITY_MODULE_TOKEN}" anywhere (no literal, no dynamic, no comment-only bypass hint)`
  );
  assert.equal(
    referencesRunnerIdentifier(source),
    false,
    'CLI must not reference the ALS runner identifier'
  );
});

test('boundary: multiUnitPaidOrphanRecoveryService.js must not re-export the runner', () => {
  const source = fs.readFileSync(RECOVERY_SERVICE_ABS_PATH, 'utf8');
  const block = extractModuleExportsBlock(source);
  assert.ok(block, 'expected to find a module.exports = { ... } block');
  assert.equal(
    exportsBlockReexportsRunner(block),
    false,
    'recovery service must not re-export runInMultiUnitPaidOrphanRecoveryContext under any name'
  );
});

test('boundary: no file in server/ dynamically requires the capability module via a variable', () => {
  const files = walkJsCjsFiles(SERVER_ROOT);
  const violations = [];

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    const hits = findDynamicRequireOfCapability(source);
    if (hits.length > 0) {
      violations.push(`${path.relative(SERVER_ROOT, file)} (vars: ${hits.join(', ')})`);
    }
  }

  assert.deepEqual(
    violations,
    [],
    `Dynamic require() of the capability module via a variable is forbidden:\n${violations.join('\n')}`
  );
});

/* ---------------------------------------------------------------------- *
 * ALS (AsyncLocalStorage) behavioral tests.
 * This file is a *.test.cjs file, so it is explicitly exempt from the
 * runner-import boundary rule enforced above.
 * ---------------------------------------------------------------------- */

const {
  runInMultiUnitPaidOrphanRecoveryContext,
  getMultiUnitPaidOrphanRecoveryContext,
  isMultiUnitPaidOrphanRecoveryContext,
  assertMultiUnitPaidOrphanRecoveryContext
} = require('../services/checkout/multiUnitPaidOrphanRecoveryCapability');

function fakeObjectId(seed) {
  // Synthetic 24-hex ObjectId-shaped string. Not a real production id.
  const hex = crypto.createHash('md5').update(String(seed)).digest('hex').slice(0, 24);
  return hex;
}

function fakeDigest(seed) {
  return crypto.createHash('sha256').update(String(seed)).digest('hex');
}

function buildFakeScope(overrides = {}) {
  return {
    recoveryMode: 'initial',
    recoveryExecutionId: 'exec-test-0001',
    checkoutId: 'chk_test_orphan_001',
    paymentIntentId: 'pi_test_orphan_001',
    checkoutSessionId: fakeObjectId('checkoutSession-A'),
    paymentId: fakeObjectId('payment-A'),
    finalizationJobId: fakeObjectId('job-A'),
    manualReviewItemId: fakeObjectId('review-A'),
    cabinTypeId: fakeObjectId('cabinType-A'),
    expectedTargetUnitId: fakeObjectId('unit-A'),
    evidenceDigest: fakeDigest('evidence-A'),
    ...overrides
  };
}

function buildFakeScopeB(overrides = {}) {
  return buildFakeScope({
    recoveryExecutionId: 'exec-test-0002',
    checkoutId: 'chk_test_orphan_002',
    paymentIntentId: 'pi_test_orphan_002',
    checkoutSessionId: fakeObjectId('checkoutSession-B'),
    paymentId: fakeObjectId('payment-B'),
    finalizationJobId: fakeObjectId('job-B'),
    manualReviewItemId: fakeObjectId('review-B'),
    cabinTypeId: fakeObjectId('cabinType-B'),
    expectedTargetUnitId: fakeObjectId('unit-B'),
    evidenceDigest: fakeDigest('evidence-B'),
    ...overrides
  });
}

test('ALS: store is retained across an await inside the runner callback', async () => {
  const scope = buildFakeScope();
  let sawStoreBeforeAwait = null;
  let sawStoreAfterAwait = null;

  await runInMultiUnitPaidOrphanRecoveryContext(scope, async () => {
    sawStoreBeforeAwait = getMultiUnitPaidOrphanRecoveryContext();
    await new Promise((resolve) => setImmediate(resolve));
    sawStoreAfterAwait = getMultiUnitPaidOrphanRecoveryContext();
  });

  assert.ok(sawStoreBeforeAwait, 'store should be present before await');
  assert.ok(sawStoreAfterAwait, 'store should be retained after await');
  assert.equal(sawStoreBeforeAwait.recoveryExecutionId, scope.recoveryExecutionId);
  assert.equal(sawStoreAfterAwait.recoveryExecutionId, scope.recoveryExecutionId);
});

test('ALS: outer caller has no store before entering and after the runner completes', async () => {
  assert.equal(getMultiUnitPaidOrphanRecoveryContext(), null);

  const scope = buildFakeScope();
  await runInMultiUnitPaidOrphanRecoveryContext(scope, async () => {
    assert.ok(getMultiUnitPaidOrphanRecoveryContext());
  });

  assert.equal(
    getMultiUnitPaidOrphanRecoveryContext(),
    null,
    'store must not leak to the outer caller after the runner resolves'
  );
});

test('ALS: a setTimeout scheduled inside the runner retains the store (real Node AsyncLocalStorage semantics)', async () => {
  const scope = buildFakeScope();
  let sawStoreInTimeout = null;

  await new Promise((resolveOuter) => {
    runInMultiUnitPaidOrphanRecoveryContext(scope, () => {
      setTimeout(() => {
        sawStoreInTimeout = getMultiUnitPaidOrphanRecoveryContext();
        resolveOuter();
      }, 0);
    });
  });

  // Documents real Node.js semantics: AsyncLocalStorage propagates its store
  // through timers created while the store is active, even though the timer
  // callback fires after the synchronous run() call has already returned.
  assert.ok(sawStoreInTimeout, 'setTimeout callback created inside the context should retain the store');
  assert.equal(sawStoreInTimeout.recoveryExecutionId, scope.recoveryExecutionId);
});

test('ALS: incident A cannot authorize incident B — mismatched scope throws RECOVERY_SCOPE_MISMATCH', async () => {
  const scopeA = buildFakeScope();
  const scopeB = buildFakeScopeB();
  const op = { operation: 'recovery_job_lease' };

  await runInMultiUnitPaidOrphanRecoveryContext(scopeA, async () => {
    assert.throws(
      () => assertMultiUnitPaidOrphanRecoveryContext(scopeB, op),
      (err) => err && err.code === 'RECOVERY_SCOPE_MISMATCH'
    );
    // Same-incident complete operation scope must authorize.
    assert.doesNotThrow(() => assertMultiUnitPaidOrphanRecoveryContext(scopeA, op));
    // Partial scope must fail closed even for the matching incident.
    assert.throws(
      () =>
        assertMultiUnitPaidOrphanRecoveryContext(
          { checkoutId: scopeA.checkoutId },
          { operation: 'commercial_stay_bypass' }
        ),
      (err) => err && err.code === 'RECOVERY_SCOPE_MISMATCH'
    );
  });
});

test('ALS: parallel recoveries (Promise.all) have fully independent stores', async () => {
  const scopeA = buildFakeScope();
  const scopeB = buildFakeScopeB();
  const observed = {};

  await Promise.all([
    runInMultiUnitPaidOrphanRecoveryContext(scopeA, async () => {
      await new Promise((r) => setTimeout(r, 5));
      observed.a = getMultiUnitPaidOrphanRecoveryContext();
      // Cross-check: incident A's context must never satisfy incident B's scope.
      assert.throws(
        () =>
          assertMultiUnitPaidOrphanRecoveryContext(scopeB, {
            operation: 'recovery_job_lease'
          }),
        (err) => err && err.code === 'RECOVERY_SCOPE_MISMATCH'
      );
    }),
    runInMultiUnitPaidOrphanRecoveryContext(scopeB, async () => {
      await new Promise((r) => setTimeout(r, 1));
      observed.b = getMultiUnitPaidOrphanRecoveryContext();
      assert.throws(
        () =>
          assertMultiUnitPaidOrphanRecoveryContext(scopeA, {
            operation: 'recovery_job_lease'
          }),
        (err) => err && err.code === 'RECOVERY_SCOPE_MISMATCH'
      );
    })
  ]);

  assert.equal(observed.a.recoveryExecutionId, scopeA.recoveryExecutionId);
  assert.equal(observed.b.recoveryExecutionId, scopeB.recoveryExecutionId);
  assert.notEqual(observed.a.recoveryExecutionId, observed.b.recoveryExecutionId);
});

test('ALS: assertMultiUnitPaidOrphanRecoveryContext without expectedScope throws', async () => {
  const scope = buildFakeScope();
  const op = { operation: 'recovery_job_lease' };

  // Outside any context: required-context error, not a scope-mismatch error.
  assert.throws(
    () => assertMultiUnitPaidOrphanRecoveryContext(undefined, op),
    (err) => err && err.code === 'MULTI_UNIT_PAID_ORPHAN_RECOVERY_CONTEXT_REQUIRED'
  );

  await runInMultiUnitPaidOrphanRecoveryContext(scope, async () => {
    assert.throws(
      () => assertMultiUnitPaidOrphanRecoveryContext(undefined, op),
      (err) => err && err.code === 'RECOVERY_SCOPE_MISMATCH'
    );
    assert.throws(
      () => assertMultiUnitPaidOrphanRecoveryContext(null, op),
      (err) => err && err.code === 'RECOVERY_SCOPE_MISMATCH'
    );
    assert.throws(
      () => assertMultiUnitPaidOrphanRecoveryContext(scope, { operation: 'not_a_real_operation' }),
      (err) => err && err.code === 'RECOVERY_SCOPE_MISMATCH'
    );
    assert.throws(
      () => assertMultiUnitPaidOrphanRecoveryContext(scope),
      (err) => err && err.code === 'RECOVERY_SCOPE_MISMATCH'
    );
  });
});

test('ALS: isMultiUnitPaidOrphanRecoveryContext() presence-only check is true inside, false outside', async () => {
  const scope = buildFakeScope();

  assert.equal(isMultiUnitPaidOrphanRecoveryContext(), false);

  await runInMultiUnitPaidOrphanRecoveryContext(scope, async () => {
    // Presence-only (no expectedScope arg): documents that this MUST NOT be
    // used to authorize privileged mutations — it only proves *a* recovery
    // context exists, not that it matches any particular incident. All
    // privileged mutations in this codebase go through
    // assertMultiUnitPaidOrphanRecoveryContext(expectedScope) instead, never
    // through this presence-only helper.
    assert.equal(isMultiUnitPaidOrphanRecoveryContext(), true);
  });

  assert.equal(isMultiUnitPaidOrphanRecoveryContext(), false);
});
