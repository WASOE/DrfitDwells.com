const CHECKOUT_SESSION_ERROR_CODES = {
  INVALID_CHECKOUT_ID: 'INVALID_CHECKOUT_ID',
  CHECKOUT_SESSION_NOT_FOUND: 'CHECKOUT_SESSION_NOT_FOUND',
  CHECKOUT_SESSION_EXPIRED: 'CHECKOUT_SESSION_EXPIRED',
  CHECKOUT_SESSION_SUPERSEDED: 'CHECKOUT_SESSION_SUPERSEDED',
  COMMERCIAL_BOUNDARY_CHANGED: 'COMMERCIAL_BOUNDARY_CHANGED',
  CHECKOUT_SESSION_NOT_USABLE: 'CHECKOUT_SESSION_NOT_USABLE'
};

class CheckoutSessionError extends Error {
  constructor(code, message, details = null) {
    super(message || code);
    this.name = 'CheckoutSessionError';
    this.code = code;
    this.details = details;
  }
}

function isCheckoutSessionError(err) {
  return err instanceof CheckoutSessionError;
}

module.exports = {
  CHECKOUT_SESSION_ERROR_CODES,
  CheckoutSessionError,
  isCheckoutSessionError
};
