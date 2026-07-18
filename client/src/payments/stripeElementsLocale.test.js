import { describe, expect, it } from 'vitest';
import { getStripeElementsLocale } from './stripeElementsLocale';

describe('getStripeElementsLocale', () => {
  it('maps site languages to Stripe locales', () => {
    expect(getStripeElementsLocale('bg')).toBe('bg');
    expect(getStripeElementsLocale('en')).toBe('en');
    expect(getStripeElementsLocale('nl')).toBe('en');
    expect(getStripeElementsLocale(undefined)).toBe('en');
  });
});
