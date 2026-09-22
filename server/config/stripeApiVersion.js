'use strict';

/**
 * Deterministic Stripe API version for all production Stripe client constructors (SP2).
 * Must match the pinned version shipped with the installed `stripe` package.
 */
const STRIPE_API_VERSION = '2026-08-26.dahlia';

module.exports = {
  STRIPE_API_VERSION
};
