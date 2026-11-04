/**
 * CI staging must use a loopback database and Stripe's loopback mock.
 * Production credentials and live Stripe keys are refused before listen.
 */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost']);
const DATABASE_NAME = 'drift-dwells-ci-staging';

function assertReleaseCiStagingEnv(env = process.env) {
  if (env.RELEASE_CI_STAGING !== '1') return { ok: true, enforced: false };

  const errors = [];
  const mongoUri = String(env.MONGODB_URI || env.MONGO_URI || '').trim();
  let mongo;
  try {
    mongo = new URL(mongoUri);
  } catch {
    mongo = null;
  }
  if (!mongo || mongo.protocol !== 'mongodb:') {
    errors.push('CI staging MongoDB URI must be mongodb:// on the runner loopback. mongodb+srv and Atlas are refused.');
  } else {
    if (!LOOPBACK_HOSTS.has(mongo.hostname)) {
      errors.push(`CI staging MongoDB host ${mongo.hostname} is not loopback.`);
    }
    if (mongo.username || mongo.password) {
      errors.push('CI staging MongoDB URI must not contain credentials.');
    }
    const databaseName = mongo.pathname.replace(/^\//, '').split('/')[0];
    if (databaseName !== DATABASE_NAME) {
      errors.push(`CI staging database must be ${DATABASE_NAME}.`);
    }
    if (/mongodb\.net|driftdwells\.com/i.test(mongoUri)) {
      errors.push('CI staging MongoDB URI points at a production host.');
    }
  }

  const stripeKey = String(env.STRIPE_SECRET_KEY || '').trim();
  if (stripeKey.startsWith('sk_live_') || stripeKey.startsWith('rk_live_')) {
    errors.push('CI staging refuses a live Stripe key.');
  } else if (!stripeKey.startsWith('sk_test_')) {
    errors.push('CI staging requires a Stripe test-mode key prefix. Live keys are refused.');
  }

  let stripeApi;
  try {
    stripeApi = new URL(String(env.STRIPE_API_BASE || ''));
  } catch {
    stripeApi = null;
  }
  if (!stripeApi || stripeApi.protocol !== 'http:' || !LOOPBACK_HOSTS.has(stripeApi.hostname)) {
    errors.push('CI staging Stripe API must be the loopback stripe-mock. api.stripe.com is refused.');
  }

  if (String(env.SMTP_URL || '').trim() || String(env.SMTP_HOST || '').trim()) {
    errors.push('CI staging refuses SMTP configuration.');
  }
  if (env.EMAIL_DELIVERY_REQUIRED === '1' || env.EMAIL_DELIVERY_REQUIRED === 'true') {
    errors.push('CI staging refuses EMAIL_DELIVERY_REQUIRED.');
  }
  for (const name of [
    'OPS_ICAL_SYNC_SCHEDULER_ENABLED',
    'BOOKING_CONFIRMATION_DELIVERY_WORKER_ENABLED',
    'MESSAGE_DISPATCHER_ENABLED',
    'MESSAGE_ORCHESTRATOR_ENABLED'
  ]) {
    const value = String(env[name] || '').trim().toLowerCase();
    if (value === '1' || value === 'true') {
      errors.push(`CI staging refuses ${name}.`);
    }
  }

  if (errors.length) {
    const error = new Error(errors.join(' '));
    error.code = 'CI_STAGING_ISOLATION';
    throw error;
  }
  return { ok: true, enforced: true, databaseName: DATABASE_NAME };
}

module.exports = {
  DATABASE_NAME,
  assertReleaseCiStagingEnv
};
