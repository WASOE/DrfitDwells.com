const Stripe = require('stripe');
const { STRIPE_API_VERSION } = require('./stripeApiVersion');
const { assertReleaseCiStagingEnv } = require('./assertReleaseCiStaging');

function createStripeClient(env = process.env) {
  const key = String(env.STRIPE_SECRET_KEY || '').trim();
  if (!key) return null;
  if (env.RELEASE_CI_STAGING === '1') {
    assertReleaseCiStagingEnv(env);
  } else if (key.startsWith('sk_live_') && String(env.STRIPE_API_BASE || '').trim()) {
    const host = new URL(env.STRIPE_API_BASE).hostname;
    if (host === '127.0.0.1' || host === 'localhost') {
      throw new Error('Refusing to send a live Stripe key to a loopback API.');
    }
  }
  const options = { apiVersion: STRIPE_API_VERSION };
  const base = String(env.STRIPE_API_BASE || '').trim();
  if (base) {
    const url = new URL(base);
    options.host = url.hostname;
    options.port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
    options.protocol = url.protocol === 'https:' ? 'https' : 'http';
  }
  return new Stripe(key, options);
}

module.exports = { createStripeClient };
