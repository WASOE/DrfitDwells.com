import { describe, expect, it } from 'vitest';
import { effectiveDisplayNightlyFromStayTotal } from '../utils/lodgingPrice';

function resolveAFrameDisplayLodgingNightly({
  isExactStayPrice,
  isRatePlanPrice,
  serverLodgingTotal,
  displayNights,
  entityPricePerNight
}) {
  const ratePlanDisplayNightly =
    isRatePlanPrice && serverLodgingTotal != null && displayNights != null
      ? effectiveDisplayNightlyFromStayTotal(serverLodgingTotal, displayNights)
      : null;
  if (isExactStayPrice && !isRatePlanPrice && entityPricePerNight != null) {
    return Number(entityPricePerNight);
  }
  return ratePlanDisplayNightly;
}

describe('AFrameDetails RatePlan display nightly', () => {
  it('RatePlan shows total÷nights not Exact-total and not entity €60', () => {
    const n = resolveAFrameDisplayLodgingNightly({
      isExactStayPrice: true,
      isRatePlanPrice: true,
      serverLodgingTotal: 450,
      displayNights: 6,
      entityPricePerNight: 60
    });
    expect(n).toBe(75);
  });

  it('entity exact stay preserves entity nightly', () => {
    expect(
      resolveAFrameDisplayLodgingNightly({
        isExactStayPrice: true,
        isRatePlanPrice: false,
        serverLodgingTotal: 360,
        displayNights: 6,
        entityPricePerNight: 60
      })
    ).toBe(60);
  });
});
