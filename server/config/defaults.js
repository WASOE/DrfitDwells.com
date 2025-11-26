/**
 * Default configuration values for local development.
 * Environment variables override these settings when present.
 */

const defaultAdminUser = 'admin';
const defaultAdminPass = 'securepassword123';
const defaultAdminJwtSecret = 'securepassword123-secret';

module.exports = {
  adminUser: process.env.ADMIN_USER || defaultAdminUser,
  adminPass: process.env.ADMIN_PASS || defaultAdminPass,
  adminJwtSecret: process.env.ADMIN_JWT_SECRET || defaultAdminJwtSecret
};

