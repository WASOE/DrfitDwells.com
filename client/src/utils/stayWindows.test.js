import { describe, expect, it } from 'vitest';
import {
  isRetreatStayDateEnabled,
  isRetreatStaySelectingCheckout,
  isSameDayStayRange,
  isValidCheckInStart,
  isValidCheckoutForCheckIn,
  normalizeRetreatStayRangeSelection,
  toBlockedNightSet
} from './stayWindows';

describe('stayWindows', () => {
  const minStay = '2026-06-01';
  const minNights = 2;

  it('disables orphan free nights at check-in stage', () => {
    const blocked = toBlockedNightSet(['2026-06-02', '2026-06-04']);

    expect(isValidCheckInStart('2026-06-03', blocked, minNights)).toBe(false);
    expect(
      isRetreatStayDateEnabled('2026-06-03', {
        minStayDate: minStay,
        blockedSet: blocked,
        minNights,
        selectingCheckout: false
      })
    ).toBe(false);
  });

  it('enables checkout on the day after a free run even when that night is blocked', () => {
    const blocked = toBlockedNightSet(['2026-06-04']);
    const checkIn = '2026-06-01';

    expect(isValidCheckoutForCheckIn('2026-06-04', checkIn, blocked, minNights)).toBe(true);
    expect(
      isRetreatStayDateEnabled('2026-06-04', {
        minStayDate: minStay,
        blockedSet: blocked,
        minNights,
        rangeFrom: checkIn,
        selectingCheckout: true
      })
    ).toBe(true);
  });

  it('disables check-in starts when the free run is shorter than minNights', () => {
    const blocked = toBlockedNightSet(['2026-06-02']);

    expect(isValidCheckInStart('2026-06-01', blocked, minNights)).toBe(false);
    expect(
      isRetreatStayDateEnabled('2026-06-01', {
        minStayDate: minStay,
        blockedSet: blocked,
        minNights,
        selectingCheckout: false
      })
    ).toBe(false);
  });

  it('keeps an open calendar selectable for check-in starts', () => {
    const blocked = toBlockedNightSet([]);

    expect(isValidCheckInStart('2026-06-10', blocked, minNights)).toBe(true);
    expect(isValidCheckInStart('2026-12-20', blocked, minNights)).toBe(true);
    expect(
      isRetreatStayDateEnabled('2026-06-10', {
        minStayDate: minStay,
        blockedSet: blocked,
        minNights,
        selectingCheckout: false
      })
    ).toBe(true);
  });

  it('treats same-day from/to as checkout stage, not a completed range', () => {
    const from = new Date(2026, 6, 20);
    const to = new Date(2026, 6, 20);

    expect(isSameDayStayRange(from, to)).toBe(true);
    expect(isRetreatStaySelectingCheckout(from, to)).toBe(true);
    expect(isRetreatStaySelectingCheckout(from, undefined)).toBe(true);
    expect(normalizeRetreatStayRangeSelection({ from, to })).toEqual({ from });
  });

  it('enables only valid checkouts during checkout stage', () => {
    const blocked = toBlockedNightSet(['2026-06-04', '2026-06-08']);
    const checkIn = '2026-06-01';

    expect(
      isRetreatStayDateEnabled('2026-06-03', {
        minStayDate: minStay,
        blockedSet: blocked,
        minNights,
        rangeFrom: checkIn,
        selectingCheckout: true
      })
    ).toBe(true);
    expect(
      isRetreatStayDateEnabled('2026-06-04', {
        minStayDate: minStay,
        blockedSet: blocked,
        minNights,
        rangeFrom: checkIn,
        selectingCheckout: true
      })
    ).toBe(true);
    expect(
      isRetreatStayDateEnabled('2026-06-06', {
        minStayDate: minStay,
        blockedSet: blocked,
        minNights,
        rangeFrom: checkIn,
        selectingCheckout: true
      })
    ).toBe(false);
  });

  it('allows reset via current check-in and earlier valid check-in dates during checkout stage', () => {
    const blocked = toBlockedNightSet(['2026-06-04']);
    const checkIn = '2026-06-10';

    expect(
      isRetreatStayDateEnabled(checkIn, {
        minStayDate: minStay,
        blockedSet: blocked,
        minNights,
        rangeFrom: checkIn,
        selectingCheckout: true
      })
    ).toBe(true);
    expect(
      isRetreatStayDateEnabled('2026-06-08', {
        minStayDate: minStay,
        blockedSet: blocked,
        minNights,
        rangeFrom: checkIn,
        selectingCheckout: true
      })
    ).toBe(true);
    expect(
      isRetreatStayDateEnabled('2026-06-03', {
        minStayDate: minStay,
        blockedSet: blocked,
        minNights,
        rangeFrom: checkIn,
        selectingCheckout: true
      })
    ).toBe(false);
  });
});
