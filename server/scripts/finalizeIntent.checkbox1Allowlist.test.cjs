/**
 * Hotfix: exact checkbox1TextSnapshot allowlist (legacy + approved EN/BG).
 *
 * Run:
 *   node --test server/scripts/finalizeIntent.checkbox1Allowlist.test.cjs
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  LEGAL_ACCEPTANCE_TERMS_VERSION,
  LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION,
  LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT,
  LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT_EN_APPROVED,
  LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT_BG_APPROVED,
  LEGAL_ACCEPTANCE_CHECKBOX_1_ALLOWED_SNAPSHOTS,
  isApprovedCheckbox1TextSnapshot,
  LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT
} = require('../config/legalAcceptance');
const {
  buildValidatedFinalizeIntent
} = require('../services/checkout/finalizeIntentService');
const { CHECKOUT_SESSION_ERROR_CODES } = require('../services/checkout/checkoutSessionErrors');

const EN_BOOKING = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../client/src/i18n/locales/en/booking.json'), 'utf8')
);
const BG_BOOKING = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../client/src/i18n/locales/bg/booking.json'), 'utf8')
);

function composeDeployedConsent(confirm) {
  return (
    confirm.bookingConsentBefore +
    confirm.termsLink +
    confirm.bookingConsentMiddle +
    confirm.cancellationPolicyLink +
    confirm.bookingConsentAfter
  );
}

const DEPLOYED_EN = composeDeployedConsent(EN_BOOKING.confirm);
const DEPLOYED_BG = composeDeployedConsent(BG_BOOKING.confirm);

const requestMeta = { ip: null, userAgent: null, acceptLanguage: null };

function baseBody(checkbox1) {
  return {
    guestInfo: {
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.test',
      phone: '+359888000111'
    },
    legalAcceptance: {
      acceptedTermsAndCancellation: true,
      acceptedActivityRisk: true,
      termsVersion: LEGAL_ACCEPTANCE_TERMS_VERSION,
      activityRiskVersion: LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION,
      checkbox1TextSnapshot: checkbox1,
      checkbox2TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT,
      locale: 'en'
    },
    experienceKeys: []
  };
}

function accept(checkbox1) {
  return buildValidatedFinalizeIntent({
    body: baseBody(checkbox1),
    requestMeta,
    capturedAt: new Date('2026-09-21T12:00:00.000Z'),
    quoteSnapshot: { experienceKeys: [] }
  });
}

function reject(checkbox1, mutate = (b) => b) {
  const body = mutate(baseBody(checkbox1));
  try {
    buildValidatedFinalizeIntent({
      body,
      requestMeta,
      capturedAt: new Date('2026-09-21T12:00:00.000Z'),
      quoteSnapshot: { experienceKeys: [] }
    });
    assert.fail('expected FINALIZE_INTENT_INVALID');
  } catch (err) {
    assert.equal(err.code, CHECKOUT_SESSION_ERROR_CODES.FINALIZE_INTENT_INVALID);
    return err;
  }
}

test('allowlist constants match deployed EN/BG ConfirmBooking compositions exactly', () => {
  assert.equal(DEPLOYED_EN, LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT_EN_APPROVED);
  assert.equal(DEPLOYED_BG, LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT_BG_APPROVED);
  assert.equal(LEGAL_ACCEPTANCE_CHECKBOX_1_ALLOWED_SNAPSHOTS.length, 3);
  assert.equal(LEGAL_ACCEPTANCE_CHECKBOX_1_ALLOWED_SNAPSHOTS[0], LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT);
});

test('approved English snapshot accepted and stored exactly', () => {
  const intent = accept(LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT_EN_APPROVED);
  assert.equal(
    intent.legalAcceptance.checkbox1TextSnapshot,
    LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT_EN_APPROVED
  );
  assert.notEqual(
    intent.legalAcceptance.checkbox1TextSnapshot,
    LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT
  );
});

test('approved Bulgarian snapshot accepted and stored exactly (not canonicalized to EN)', () => {
  const intent = accept(LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT_BG_APPROVED);
  assert.equal(
    intent.legalAcceptance.checkbox1TextSnapshot,
    LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT_BG_APPROVED
  );
  assert.notEqual(
    intent.legalAcceptance.checkbox1TextSnapshot,
    LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT_EN_APPROVED
  );
});

test('legacy snapshot accepted and stored exactly', () => {
  const intent = accept(LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT);
  assert.equal(intent.legalAcceptance.checkbox1TextSnapshot, LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT);
});

test('deployed EN/BG locale compositions accepted (cross-contract)', () => {
  assert.equal(accept(DEPLOYED_EN).legalAcceptance.checkbox1TextSnapshot, DEPLOYED_EN);
  assert.equal(accept(DEPLOYED_BG).legalAcceptance.checkbox1TextSnapshot, DEPLOYED_BG);
});

test('unknown English wording rejected', () => {
  const err = reject('I agree to the terms.');
  assert.equal(err.details?.field, 'legalAcceptance.checkbox1TextSnapshot');
});

test('modified Bulgarian wording rejected', () => {
  reject(LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT_BG_APPROVED + '!');
  reject(LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT_BG_APPROVED.replace('вие', 'Вие'));
});

test('leading/trailing-space variants rejected (no trim acceptance)', () => {
  reject(` ${LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT_EN_APPROVED}`);
  reject(`${LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT_EN_APPROVED} `);
  reject(`\n${LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT}`);
  reject(`${LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT}\t`);
});

test('empty/null/object/array rejected', () => {
  assert.equal(isApprovedCheckbox1TextSnapshot(''), false);
  assert.equal(isApprovedCheckbox1TextSnapshot(null), false);
  assert.equal(isApprovedCheckbox1TextSnapshot(undefined), false);
  assert.equal(isApprovedCheckbox1TextSnapshot({}), false);
  assert.equal(isApprovedCheckbox1TextSnapshot([]), false);
  reject('');
  reject(null);
  reject({});
  reject([]);
});

test('malicious token/URI/HTML/stack text rejected', () => {
  reject('sk_live_fake_secret_token');
  reject('mongodb://user:pass@host/db');
  reject('<script>alert(1)</script>');
  reject('Error: boom\n    at Object.<anonymous> (/app/server.js:1:1)');
  reject('Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.fake');
});

test('checkbox2 mismatch still rejected', () => {
  const err = reject(LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT_EN_APPROVED, (b) => {
    b.legalAcceptance.checkbox2TextSnapshot = 'wrong checkbox 2';
    return b;
  });
  assert.equal(err.details?.field, 'legalAcceptance.checkbox2TextSnapshot');
});

test('legal version mismatch still rejected', () => {
  const err = reject(LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT_EN_APPROVED, (b) => {
    b.legalAcceptance.termsVersion = '1999-01-01-v0';
    return b;
  });
  assert.equal(err.details?.field, 'legalAcceptance.termsVersion');
});

test('false agreement flags still rejected', () => {
  reject(LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT_EN_APPROVED, (b) => {
    b.legalAcceptance.acceptedTermsAndCancellation = false;
    return b;
  });
  reject(LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT_EN_APPROVED, (b) => {
    b.legalAcceptance.acceptedActivityRisk = false;
    return b;
  });
});

test('experience-key mismatch still rejected', () => {
  try {
    buildValidatedFinalizeIntent({
      body: { ...baseBody(LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT_EN_APPROVED), experienceKeys: ['sauna'] },
      requestMeta,
      capturedAt: new Date(),
      quoteSnapshot: { experienceKeys: [] }
    });
    assert.fail('expected rejection');
  } catch (err) {
    assert.equal(err.code, CHECKOUT_SESSION_ERROR_CODES.FINALIZE_INTENT_INVALID);
    assert.equal(err.details?.field, 'experienceKeys');
  }
});

test('isApprovedCheckbox1TextSnapshot is exact-only (no case-insensitive / substring)', () => {
  assert.equal(isApprovedCheckbox1TextSnapshot(LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT_EN_APPROVED.toUpperCase()), false);
  assert.equal(
    isApprovedCheckbox1TextSnapshot(LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT_EN_APPROVED.slice(0, 20)),
    false
  );
  assert.equal(
    isApprovedCheckbox1TextSnapshot(`xx${LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT_EN_APPROVED}yy`),
    false
  );
});

test('validation-only path never requires Stripe', () => {
  // buildValidatedFinalizeIntent is pure — no stripe arg, no network.
  const intent = accept(DEPLOYED_EN);
  assert.ok(intent.legalAcceptance);
  const intentBg = accept(DEPLOYED_BG);
  assert.ok(intentBg.legalAcceptance);
  const intentLegacy = accept(LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT);
  assert.ok(intentLegacy.legalAcceptance);
});
