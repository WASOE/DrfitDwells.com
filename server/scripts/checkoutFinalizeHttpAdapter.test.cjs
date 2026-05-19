/**
 * C3-E1 checkout finalize HTTP adapter helpers.
 *
 * Run: node --test server/scripts/checkoutFinalizeHttpAdapter.test.cjs
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const {
  buildTrustedBookingPayloadForFinalize,
  isFinalizeReplayError,
  getFinalizeReplayFromError,
  mapFinalizeOrchestrationResultToHttp,
  mapCheckoutSessionErrorToHttpStatus,
  CheckoutSessionError
} = require('../services/checkout/checkoutFinalizeHttpAdapter');
const { CHECKOUT_SESSION_ERROR_CODES } = require('../services/checkout/checkoutSessionErrors');
const checkoutSessionRouteAdapter = require('../routes/checkoutSessionRouteAdapter');

const cabinId = new mongoose.Types.ObjectId();
const cabinTypeId = new mongoose.Types.ObjectId();
const unitId = new mongoose.Types.ObjectId();
const checkInDate = new Date('2026-08-01T00:00:00.000Z');
const checkOutDate = new Date('2026-08-05T00:00:00.000Z');
const guestInfo = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  phone: '+359800000099'
};

test('buildTrustedBookingPayloadForFinalize returns expected cabin payload', () => {
  const input = {
    cabinId,
    checkInDate,
    checkOutDate,
    guestInfo
  };

  const payload = buildTrustedBookingPayloadForFinalize(input);

  assert.equal(String(payload.cabinId), String(cabinId));
  assert.equal(payload.cabinTypeId, null);
  assert.equal(payload.unitId, null);
  assert.equal(payload.checkIn.getTime(), checkInDate.getTime());
  assert.equal(payload.checkOut.getTime(), checkOutDate.getTime());
  assert.equal(payload.guestInfo.email, guestInfo.email);
  assert.equal('checkoutId' in payload, false);
});

test('buildTrustedBookingPayloadForFinalize returns expected cabinType payload with unitId preserved', () => {
  const input = {
    cabinTypeId,
    unitId,
    checkInDate,
    checkOutDate,
    guestInfo
  };

  const payload = buildTrustedBookingPayloadForFinalize(input);

  assert.equal(String(payload.cabinTypeId), String(cabinTypeId));
  assert.equal(String(payload.unitId), String(unitId));
  assert.equal(payload.cabinId, null);
});

test('payload does not include checkoutId', () => {
  const input = {
    checkoutId: 'chk_should_not_appear',
    cabinId,
    checkInDate,
    checkOutDate,
    guestInfo
  };

  const payload = buildTrustedBookingPayloadForFinalize(input);
  assert.equal('checkoutId' in payload, false);
});

test('payload does not include paymentIntentId / clientSecret / client_secret', () => {
  const input = {
    cabinId,
    checkInDate,
    checkOutDate,
    guestInfo,
    paymentIntentId: 'pi_secret_test',
    clientSecret: 'setsec_test',
    client_secret: 'setsec_snake'
  };

  const payload = buildTrustedBookingPayloadForFinalize(input);
  assert.equal('paymentIntentId' in payload, false);
  assert.equal('clientSecret' in payload, false);
  assert.equal('client_secret' in payload, false);
});

test('input object is not mutated', () => {
  const input = {
    cabinId,
    checkInDate,
    checkOutDate,
    guestInfo: { ...guestInfo }
  };
  const before = JSON.stringify(input);

  buildTrustedBookingPayloadForFinalize(input);

  assert.equal(JSON.stringify(input), before);
});

test('isFinalizeReplayError true for CHECKOUT_SESSION_NOT_USABLE with details.idempotentReplay', () => {
  const replay = {
    ok: true,
    idempotentReplay: true,
    bookingId: new mongoose.Types.ObjectId().toString(),
    checkoutId: 'chk_replay_01'
  };
  const err = new CheckoutSessionError(
    CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_NOT_USABLE,
    'already finalized',
    { idempotentReplay: true, replay }
  );

  assert.equal(isFinalizeReplayError(err), true);
});

test('getFinalizeReplayFromError returns replay', () => {
  const replay = {
    ok: true,
    idempotentReplay: true,
    bookingId: 'booking_replay_1',
    checkoutId: 'chk_replay_02'
  };
  const err = new CheckoutSessionError(
    CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_NOT_USABLE,
    'already finalized',
    { idempotentReplay: true, replay }
  );

  assert.deepEqual(getFinalizeReplayFromError(err), replay);
});

test('normal CheckoutSessionError is not replay', () => {
  const err = new CheckoutSessionError(
    CHECKOUT_SESSION_ERROR_CODES.FINALIZE_IN_PROGRESS,
    'in progress'
  );
  assert.equal(isFinalizeReplayError(err), false);
  assert.equal(getFinalizeReplayFromError(err), null);
});

test('mapFinalizeOrchestrationResultToHttp returns 200 for replay', () => {
  const mapped = mapFinalizeOrchestrationResultToHttp({
    ok: true,
    idempotentReplay: true,
    bookingId: 'b1',
    checkoutId: 'chk_1'
  });
  assert.equal(mapped.statusCode, 200);
  assert.equal(mapped.idempotentReplay, true);
  assert.equal(mapped.bookingId, 'b1');
});

test('mapFinalizeOrchestrationResultToHttp returns 201 for normal success', () => {
  const mapped = mapFinalizeOrchestrationResultToHttp({
    ok: true,
    idempotentReplay: false,
    bookingId: 'b2',
    checkoutId: 'chk_2'
  });
  assert.equal(mapped.statusCode, 201);
  assert.equal(mapped.idempotentReplay, false);
  assert.equal(mapped.bookingId, 'b2');
});

test('HTTP mapping FINALIZE_IN_PROGRESS is 409', () => {
  assert.equal(
    mapCheckoutSessionErrorToHttpStatus(CHECKOUT_SESSION_ERROR_CODES.FINALIZE_IN_PROGRESS),
    409
  );
  const err = new CheckoutSessionError(
    CHECKOUT_SESSION_ERROR_CODES.FINALIZE_IN_PROGRESS,
    'in progress'
  );
  const mapped = checkoutSessionRouteAdapter.mapCheckoutSessionErrorToHttp(err);
  assert.equal(mapped.status, 409);
  assert.equal(mapped.body.code, CHECKOUT_SESSION_ERROR_CODES.FINALIZE_IN_PROGRESS);
});

test('HTTP mapping DUPLICATE_STAY_CONFLICT is 409', () => {
  assert.equal(
    mapCheckoutSessionErrorToHttpStatus(CHECKOUT_SESSION_ERROR_CODES.DUPLICATE_STAY_CONFLICT),
    409
  );
  const err = new CheckoutSessionError(
    CHECKOUT_SESSION_ERROR_CODES.DUPLICATE_STAY_CONFLICT,
    'duplicate stay'
  );
  const mapped = checkoutSessionRouteAdapter.mapCheckoutSessionErrorToHttp(err);
  assert.equal(mapped.status, 409);
});

test('HTTP mapping COMMERCIAL_STAY_FINGERPRINT_REQUIRED is 400', () => {
  assert.equal(
    mapCheckoutSessionErrorToHttpStatus(
      CHECKOUT_SESSION_ERROR_CODES.COMMERCIAL_STAY_FINGERPRINT_REQUIRED
    ),
    400
  );
  const err = new CheckoutSessionError(
    CHECKOUT_SESSION_ERROR_CODES.COMMERCIAL_STAY_FINGERPRINT_REQUIRED,
    'fingerprint required'
  );
  const mapped = checkoutSessionRouteAdapter.mapCheckoutSessionErrorToHttp(err);
  assert.equal(mapped.status, 400);
});

test('HTTP mapping COMMERCIAL_STAY_FINGERPRINT_MISMATCH is 409', () => {
  assert.equal(
    mapCheckoutSessionErrorToHttpStatus(
      CHECKOUT_SESSION_ERROR_CODES.COMMERCIAL_STAY_FINGERPRINT_MISMATCH
    ),
    409
  );
  const err = new CheckoutSessionError(
    CHECKOUT_SESSION_ERROR_CODES.COMMERCIAL_STAY_FINGERPRINT_MISMATCH,
    'fingerprint mismatch'
  );
  const mapped = checkoutSessionRouteAdapter.mapCheckoutSessionErrorToHttp(err);
  assert.equal(mapped.status, 409);
});
