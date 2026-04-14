const { DEFAULT_MONGO_URI } = require('./dbDefaults');

/**
 * Validate production configuration without exiting (for tests).
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ ok: boolean, errors: string[] }}
 */
function validateProductionEnv(env = process.env) {
  const errors = [];
  if (env.NODE_ENV !== 'production') {
    return { ok: true, errors: [] };
  }

  const mongoUri = (env.MONGODB_URI || env.MONGO_URI || '').trim();
  if (!mongoUri) {
    errors.push('MONGODB_URI (or MONGO_URI) must be set in production.');
  } else if (!/^mongodb(\+srv)?:\/\//i.test(mongoUri)) {
    errors.push('MONGODB_URI must start with mongodb:// or mongodb+srv://');
  }

  if (!env.ADMIN_USER || !String(env.ADMIN_USER).trim()) {
    errors.push('ADMIN_USER must be set in production.');
  }
  if (!env.ADMIN_PASS || !String(env.ADMIN_PASS).trim()) {
    errors.push('ADMIN_PASS must be set in production.');
  }
  if (!env.ADMIN_JWT_SECRET || String(env.ADMIN_JWT_SECRET).length < 16) {
    errors.push('ADMIN_JWT_SECRET must be set in production and at least 16 characters.');
  }

  const cors = (env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (cors.length === 0) {
    errors.push('CORS_ORIGINS must list at least one allowed origin in production (comma-separated).');
  } else {
    for (const origin of cors) {
      if (!/^https?:\/\/.+/i.test(origin)) {
        errors.push(`CORS_ORIGINS entry is not a valid http(s) origin: "${origin}"`);
        break;
      }
    }
  }

  if (env.STRIPE_SECRET_KEY && String(env.STRIPE_SECRET_KEY).trim()) {
    if (!env.STRIPE_WEBHOOK_SECRET || !String(env.STRIPE_WEBHOOK_SECRET).trim()) {
      errors.push('STRIPE_WEBHOOK_SECRET is required when STRIPE_SECRET_KEY is set (webhook signature verification).');
    }
  }

  if (env.EMAIL_DELIVERY_REQUIRED === '1' || env.EMAIL_DELIVERY_REQUIRED === 'true') {
    const smtpUrl = (env.SMTP_URL || '').trim();
    const smtpHost = (env.SMTP_HOST || '').trim();
    if (!smtpUrl && !smtpHost) {
      errors.push('SMTP_URL or SMTP_HOST is required when EMAIL_DELIVERY_REQUIRED=1.');
    } else if (smtpUrl && !/^(smtps?|smtp):\/\//i.test(smtpUrl) && !/^postmark\+smtp:\/\//i.test(smtpUrl)) {
      errors.push('SMTP_URL must look like a URL (e.g. smtp:// or smtps://).');
    }

    if (smtpHost) {
      const smtpPortRaw = String(env.SMTP_PORT || '').trim();
      if (smtpPortRaw) {
        const smtpPort = Number.parseInt(smtpPortRaw, 10);
        if (!Number.isFinite(smtpPort) || smtpPort <= 0 || smtpPort > 65535) {
          errors.push('SMTP_PORT must be a valid TCP port number (1-65535).');
        }
      }
    }
  }

  // Prevent silent use of bundled local default when production was intended to use Atlas, etc.
  if (mongoUri && mongoUri === DEFAULT_MONGO_URI && env.ALLOW_DEFAULT_LOCAL_MONGO_IN_PRODUCTION !== '1') {
    errors.push(
      'MONGODB_URI matches the dev default (localhost). Set a real connection string or set ALLOW_DEFAULT_LOCAL_MONGO_IN_PRODUCTION=1 if intentional.'
    );
  }

  return { ok: errors.length === 0, errors };
}

function validateProductionEnvOrExit(env = process.env) {
  const { ok, errors } = validateProductionEnv(env);
  if (ok) return;
  console.error('[FATAL] Production environment validation failed:');
  errors.forEach((e) => console.error(`  - ${e}`));
  process.exit(1);
}

module.exports = {
  validateProductionEnv,
  validateProductionEnvOrExit
};
