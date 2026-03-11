/**
 * Default configuration values for local development.
 * Environment variables override these settings when present.
 */

const defaultAdminUser = 'admin';
const defaultAdminPass = 'securepassword123';
const defaultAdminJwtSecret = 'securepassword123-secret';

if (process.env.NODE_ENV === 'production') {
  const missing = [];
  if (!process.env.ADMIN_USER) missing.push('ADMIN_USER');
  if (!process.env.ADMIN_PASS) missing.push('ADMIN_PASS');
  if (!process.env.ADMIN_JWT_SECRET) missing.push('ADMIN_JWT_SECRET');
  if (missing.length > 0) {
    console.error(`FATAL: Production requires ${missing.join(', ')} environment variables. Refusing to start with default credentials.`);
    process.exit(1);
  }
}

module.exports = {
  adminUser: process.env.ADMIN_USER || defaultAdminUser,
  adminPass: process.env.ADMIN_PASS || defaultAdminPass,
  adminJwtSecret: process.env.ADMIN_JWT_SECRET || defaultAdminJwtSecret
};
