import { describe, expect, it } from 'vitest';
import {
  createEmptyForm,
  buildCreatePayload,
  buildUpdatePayload,
  buildRevisionOnlyPayload,
  assertNoForbiddenKeys,
  safeErrorMessage,
  SAFE_ERROR_MESSAGES,
  describeActivationResult,
  planToForm,
  isDraftEditable,
  FORBIDDEN_PAYLOAD_KEYS,
  RatePlanFormError
} from './ratePlanFormUtils.js';

function validSeasonalForm(overrides = {}) {
  const form = createEmptyForm('seasonal_stay');
  form.code = 'winter-2027';
  form.internalName = 'Winter seasonal';
  form.version = '1';
  form.arrivalWindowStart = '2027-12-01';
  form.arrivalWindowEnd = '2027-12-31';
  form.minNights = '2';
  form.inclusionsText = 'Firewood\nSauna';
  form.accommodations[0] = {
    accommodationKey: 'Lux-Cabin',
    entityType: 'cabin',
    pricingMethod: 'nightly_per_unit',
    nightlyPerUnitAmount: '180.5',
    includedGuests: '',
    additionalGuestNightlyAmount: '',
    fixedPerUnitAmount: '999',
    adultPackageAmount: '1',
    childPackageAmount: '1',
    infantPackageAmount: '1'
  };
  return { ...form, ...overrides };
}

function validFixedForm(overrides = {}) {
  const form = createEmptyForm('fixed_package');
  form.code = 'xmas-retreat';
  form.internalName = 'Christmas retreat';
  form.packageArrivalDate = '2027-12-20';
  form.packageDepartureDate = '2027-12-24';
  form.accommodations[0] = {
    accommodationKey: 'lux-cabin',
    entityType: 'cabin',
    pricingMethod: 'fixed_per_participant',
    nightlyPerUnitAmount: '10',
    includedGuests: '',
    additionalGuestNightlyAmount: '',
    fixedPerUnitAmount: '',
    adultPackageAmount: '500',
    childPackageAmount: '250',
    infantPackageAmount: '0'
  };
  return { ...form, ...overrides };
}

describe('ratePlanFormUtils', () => {
  it('builds seasonal draft create payload without actor or lifecycle fields', () => {
    const payload = buildCreatePayload(validSeasonalForm());
    assertNoForbiddenKeys(payload);
    expect(payload).toEqual({
      code: 'winter-2027',
      internalName: 'Winter seasonal',
      version: 1,
      type: 'seasonal_stay',
      currency: 'EUR',
      arrivalWindowStart: '2027-12-01',
      arrivalWindowEnd: '2027-12-31',
      bookingWindowStart: null,
      bookingWindowEnd: null,
      minNights: 2,
      packageArrivalDate: null,
      packageDepartureDate: null,
      inventoryMode: 'shared',
      requiresFullPayment: true,
      cancellationPolicyCode: 'normal-stay-standard',
      cancellationPolicyVersion: 1,
      inclusions: ['Firewood', 'Sauna'],
      accommodations: [
        {
          accommodationKey: 'lux-cabin',
          entityType: 'cabin',
          pricingMethod: 'nightly_per_unit',
          nightlyPerUnitAmount: 180.5,
          includedGuests: null,
          additionalGuestNightlyAmount: null,
          fixedPerUnitAmount: null,
          adultPackageAmount: null,
          childPackageAmount: null,
          infantPackageAmount: null
        }
      ]
    });
    for (const key of FORBIDDEN_PAYLOAD_KEYS) {
      expect(Object.prototype.hasOwnProperty.call(payload, key)).toBe(false);
    }
  });

  it('builds fixed-package draft create payload with package dates only', () => {
    const payload = buildCreatePayload(validFixedForm());
    expect(payload.type).toBe('fixed_package');
    expect(payload.arrivalWindowStart).toBeNull();
    expect(payload.arrivalWindowEnd).toBeNull();
    expect(payload.packageArrivalDate).toBe('2027-12-20');
    expect(payload.packageDepartureDate).toBe('2027-12-24');
    expect(payload.inventoryMode).toBe('exclusive');
    expect(payload.accommodations[0].adultPackageAmount).toBe(500);
    expect(payload.accommodations[0].infantPackageAmount).toBe(0);
    expect(payload.accommodations[0].nightlyPerUnitAmount).toBeNull();
    assertNoForbiddenKeys(payload);
  });

  it('requires exact native revision for update/activate/retire payloads', () => {
    const form = validSeasonalForm({ code: 'a', internalName: 'A' });
    form.arrivalWindowStart = '2027-01-01';
    form.arrivalWindowEnd = '2027-01-10';
    form.accommodations[0].accommodationKey = 'lux-cabin';
    form.accommodations[0].nightlyPerUnitAmount = '100';

    const update = buildUpdatePayload(form, 3);
    expect(update.expectedRevision).toBe(3);
    expect(update.revision).toBeUndefined();
    assertNoForbiddenKeys(update);

    expect(() => buildUpdatePayload(form, '3')).toThrow(/exact revision/);
    expect(() => buildUpdatePayload(form, 1.5)).toThrow(/exact revision/);
    expect(() => buildRevisionOnlyPayload('1')).toThrow(/exact revision/);
    expect(buildRevisionOnlyPayload(0)).toEqual({ expectedRevision: 0 });
  });

  it('marks only drafts editable', () => {
    expect(isDraftEditable({ status: 'draft' })).toBe(true);
    expect(isDraftEditable({ status: 'active' })).toBe(false);
    expect(isDraftEditable({ status: 'retired' })).toBe(false);
  });

  it('maps known error codes to fixed client-owned text', () => {
    expect(
      safeErrorMessage({ response: { data: { code: 'STALE_REVISION', message: 'secret' } } })
    ).toBe(SAFE_ERROR_MESSAGES.STALE_REVISION);
    expect(
      safeErrorMessage({ response: { data: { code: 'SEASONAL_OVERLAP', message: 'secret' } } })
    ).toBe(SAFE_ERROR_MESSAGES.SEASONAL_OVERLAP);
    expect(
      safeErrorMessage({ response: { data: { code: 'ACTIVATION_BUSY', message: 'secret' } } })
    ).toBe(SAFE_ERROR_MESSAGES.ACTIVATION_BUSY);
    expect(
      safeErrorMessage({
        response: { data: { code: 'ACTIVATION_LOCK_UNCERTAIN', message: 'secret' } }
      })
    ).toBe(SAFE_ERROR_MESSAGES.ACTIVATION_LOCK_UNCERTAIN);
    expect(
      safeErrorMessage({ response: { data: { code: 'VALIDATION_FAILED', message: 'secret' } } })
    ).toBe(SAFE_ERROR_MESSAGES.VALIDATION);
    expect(
      safeErrorMessage({ response: { data: { code: 'NOT_FOUND', message: 'secret' } } })
    ).toBe(SAFE_ERROR_MESSAGES.NOT_FOUND);
    expect(safeErrorMessage({ response: { status: 401, data: { message: 'secret' } } })).toBe(
      SAFE_ERROR_MESSAGES.AUTH
    );
    expect(safeErrorMessage({ code: 'ERR_NETWORK', message: 'Network Error' })).toBe(
      SAFE_ERROR_MESSAGES.NETWORK
    );
  });

  it('never surfaces secret-bearing API messages even with a known code', () => {
    const poison =
      '<script>alert(1)</script> ownerToken=SECRET mongodb://user:pass@host password=hunter2';
    for (const code of [
      'STALE_REVISION',
      'SEASONAL_OVERLAP',
      'ACTIVATION_BUSY',
      'ACTIVATION_LOCK_UNCERTAIN',
      'VALIDATION_FAILED',
      'NOT_FOUND'
    ]) {
      const text = safeErrorMessage({
        response: { data: { code, message: poison, details: poison } }
      });
      expect(text).not.toMatch(/ownerToken|mongodb|password|hunter2|script|SECRET/i);
      expect(text).not.toContain(poison);
    }
  });

  it('shows only generic text for unknown or malformed errors', () => {
    expect(safeErrorMessage(null)).toBe(SAFE_ERROR_MESSAGES.UNKNOWN);
    expect(safeErrorMessage({})).toBe(SAFE_ERROR_MESSAGES.UNKNOWN);
    expect(
      safeErrorMessage({ response: { data: { code: 'WEIRD_CODE', message: 'leak me' } } })
    ).toBe(SAFE_ERROR_MESSAGES.UNKNOWN);
    expect(
      safeErrorMessage({ response: { data: { message: 'mongodb://x' } } })
    ).toBe(SAFE_ERROR_MESSAGES.UNKNOWN);
    expect(safeErrorMessage({ message: 'stack at Object.foo' })).toBe(SAFE_ERROR_MESSAGES.UNKNOWN);
  });

  it('rejects seasonal blank/incomplete/invalid amounts', () => {
    const blank = validSeasonalForm();
    blank.accommodations[0].nightlyPerUnitAmount = '';
    expect(() => buildCreatePayload(blank)).toThrow(/nightly amount is required/i);

    const whitespace = validSeasonalForm();
    whitespace.accommodations[0].nightlyPerUnitAmount = '   ';
    expect(() => buildCreatePayload(whitespace)).toThrow(/nightly amount is required/i);

    const neg = validSeasonalForm();
    neg.accommodations[0].nightlyPerUnitAmount = '-1';
    expect(() => buildCreatePayload(neg)).toThrow(/cannot be negative/i);

    const nan = validSeasonalForm();
    nan.accommodations[0].nightlyPerUnitAmount = 'nope';
    expect(() => buildCreatePayload(nan)).toThrow(/finite number/i);

    const extra = validSeasonalForm();
    extra.accommodations[0].pricingMethod = 'nightly_base_plus_extra_guest';
    extra.accommodations[0].nightlyPerUnitAmount = '100';
    extra.accommodations[0].includedGuests = '';
    extra.accommodations[0].additionalGuestNightlyAmount = '20';
    expect(() => buildCreatePayload(extra)).toThrow(/included guests is required/i);
  });

  it('rejects fixed-package blank/incomplete/invalid amounts', () => {
    const blank = validFixedForm();
    blank.accommodations[0].adultPackageAmount = '';
    expect(() => buildCreatePayload(blank)).toThrow(/adult package amount is required/i);

    const child = validFixedForm();
    child.accommodations[0].childPackageAmount = 'Infinity';
    expect(() => buildCreatePayload(child)).toThrow(/finite number/i);

    const unit = validFixedForm();
    unit.accommodations[0].pricingMethod = 'fixed_per_unit';
    unit.accommodations[0].fixedPerUnitAmount = '';
    unit.accommodations[0].adultPackageAmount = '1';
    expect(() => buildCreatePayload(unit)).toThrow(/fixed unit amount is required/i);
  });

  it('never converts blank amounts to zero or null in a submitted payload', () => {
    const form = validSeasonalForm();
    form.accommodations[0].nightlyPerUnitAmount = '';
    expect(() => buildCreatePayload(form)).toThrow(RatePlanFormError);
    try {
      buildCreatePayload(form);
    } catch (e) {
      expect(e.isRatePlanValidation).toBe(true);
    }
  });

  it('preserves legitimate zero where RP1 permits zero', () => {
    const seasonal = validSeasonalForm();
    seasonal.accommodations[0].nightlyPerUnitAmount = '0';
    expect(buildCreatePayload(seasonal).accommodations[0].nightlyPerUnitAmount).toBe(0);

    const base = validSeasonalForm();
    base.accommodations[0].pricingMethod = 'nightly_base_plus_extra_guest';
    base.accommodations[0].nightlyPerUnitAmount = '100';
    base.accommodations[0].includedGuests = '0';
    base.accommodations[0].additionalGuestNightlyAmount = '0';
    const basePayload = buildCreatePayload(base);
    expect(basePayload.accommodations[0].includedGuests).toBe(0);
    expect(basePayload.accommodations[0].additionalGuestNightlyAmount).toBe(0);

    const fixed = validFixedForm();
    fixed.accommodations[0].infantPackageAmount = '0';
    expect(buildCreatePayload(fixed).accommodations[0].infantPackageAmount).toBe(0);
  });

  it('rejects duplicate normalized accommodation keys (RP1 key-only identity)', () => {
    const form = validSeasonalForm();
    form.accommodations = [
      {
        accommodationKey: 'Lux-Cabin',
        entityType: 'cabin',
        pricingMethod: 'nightly_per_unit',
        nightlyPerUnitAmount: '100',
        includedGuests: '',
        additionalGuestNightlyAmount: '',
        fixedPerUnitAmount: '',
        adultPackageAmount: '',
        childPackageAmount: '',
        infantPackageAmount: ''
      },
      {
        accommodationKey: ' lux-cabin ',
        entityType: 'cabin',
        pricingMethod: 'nightly_per_unit',
        nightlyPerUnitAmount: '120',
        includedGuests: '',
        additionalGuestNightlyAmount: '',
        fixedPerUnitAmount: '',
        adultPackageAmount: '',
        childPackageAmount: '',
        infantPackageAmount: ''
      }
    ];
    expect(() => buildCreatePayload(form)).toThrow(/Duplicate accommodation "lux-cabin"/i);
    expect(() => buildCreatePayload(form)).toThrow(/rows 1 and 2/i);
  });

  it('rejects same key with different entity types (RP1 does not separate by entityType)', () => {
    const form = validSeasonalForm();
    form.accommodations = [
      {
        accommodationKey: 'lux-cabin',
        entityType: 'cabin',
        pricingMethod: 'nightly_per_unit',
        nightlyPerUnitAmount: '100',
        includedGuests: '',
        additionalGuestNightlyAmount: '',
        fixedPerUnitAmount: '',
        adultPackageAmount: '',
        childPackageAmount: '',
        infantPackageAmount: ''
      },
      {
        accommodationKey: 'lux-cabin',
        entityType: 'cabinType',
        pricingMethod: 'nightly_per_unit',
        nightlyPerUnitAmount: '90',
        includedGuests: '',
        additionalGuestNightlyAmount: '',
        fixedPerUnitAmount: '',
        adultPackageAmount: '',
        childPackageAmount: '',
        infantPackageAmount: ''
      }
    ];
    expect(() => buildCreatePayload(form)).toThrow(/Duplicate accommodation "lux-cabin"/i);
  });

  it('allows distinct accommodation keys', () => {
    const form = validSeasonalForm();
    form.accommodations = [
      {
        accommodationKey: 'lux-cabin',
        entityType: 'cabin',
        pricingMethod: 'nightly_per_unit',
        nightlyPerUnitAmount: '100',
        includedGuests: '',
        additionalGuestNightlyAmount: '',
        fixedPerUnitAmount: '',
        adultPackageAmount: '',
        childPackageAmount: '',
        infantPackageAmount: ''
      },
      {
        accommodationKey: 'a-frame',
        entityType: 'cabin',
        pricingMethod: 'nightly_per_unit',
        nightlyPerUnitAmount: '90',
        includedGuests: '',
        additionalGuestNightlyAmount: '',
        fixedPerUnitAmount: '',
        adultPackageAmount: '',
        childPackageAmount: '',
        infantPackageAmount: ''
      }
    ];
    const payload = buildCreatePayload(form);
    expect(payload.accommodations).toHaveLength(2);
  });

  it('treats committed activation with cleanup warning as success + warning', () => {
    const desc = describeActivationResult({
      activationCommitted: true,
      lockReleased: false,
      operationalWarnings: [{ code: 'ACTIVATION_LOCK_RELEASE_FAILED' }]
    });
    expect(desc.committed).toBe(true);
    expect(desc.lockReleased).toBe(false);
    expect(desc.hasCleanupWarning).toBe(true);
    expect(desc.successMessage).toMatch(/activated/i);
    expect(desc.successMessage).toMatch(/do not retry/i);
  });

  it('round-trips plan to form without inventing revision fields in create payload', () => {
    const form = planToForm({
      id: '1',
      revision: 4,
      code: 'x',
      internalName: 'X',
      version: 2,
      status: 'draft',
      type: 'seasonal_stay',
      currency: 'EUR',
      arrivalWindowStart: '2027-01-01',
      arrivalWindowEnd: '2027-01-31',
      minNights: 3,
      inventoryMode: 'shared',
      requiresFullPayment: false,
      cancellationPolicyCode: 'normal-stay-standard',
      cancellationPolicyVersion: 1,
      inclusions: ['A'],
      accommodations: [
        {
          accommodationKey: 'lux-cabin',
          entityType: 'cabin',
          pricingMethod: 'nightly_per_unit',
          nightlyPerUnitAmount: 90
        }
      ],
      createdBy: 'ops'
    });
    expect(form.minNights).toBe('3');
    expect(form.requiresFullPayment).toBe(false);
    const create = buildCreatePayload(form);
    expect(create.createdBy).toBeUndefined();
    expect(create.revision).toBeUndefined();
  });

  it('surfaces client validation errors via safeErrorMessage without API text', () => {
    expect(safeErrorMessage(new RatePlanFormError('Accommodation 1: nightly amount is required'))).toBe(
      'Accommodation 1: nightly amount is required'
    );
  });
});
