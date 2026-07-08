import { describe, expect, it } from 'vitest';
import { isPaidTrafficLandingPath } from './paidTrafficRoutes';

describe('paidTrafficRoutes', () => {
  it('isPaidTrafficLandingPath matches localized and default routes', () => {
    expect(isPaidTrafficLandingPath('/off-grid-stays-bulgaria')).toBe(true);
    expect(isPaidTrafficLandingPath('/bg/off-grid-stays-bulgaria')).toBe(true);
    expect(isPaidTrafficLandingPath('/valley')).toBe(false);
    expect(isPaidTrafficLandingPath('/')).toBe(false);
  });
});
