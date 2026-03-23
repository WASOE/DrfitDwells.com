/**
 * Default configuration values for local development.
 * Environment variables override these settings when present.
 */

const defaultAdminUser = 'admin';
const defaultAdminPass = 'securepassword123';
const defaultAdminJwtSecret = 'securepassword123-secret';
const defaultOperatorUser = 'operator';
const defaultOperatorPass = 'operatorpassword123';

// Production admin/Mongo/CORS/Stripe checks run in server.js via validateProductionEnvOrExit().

module.exports = {
  adminUser: process.env.ADMIN_USER || defaultAdminUser,
  adminPass: process.env.ADMIN_PASS || defaultAdminPass,
  adminJwtSecret: process.env.ADMIN_JWT_SECRET || defaultAdminJwtSecret,
  operatorUser: process.env.ADMIN_OPERATOR_USER || defaultOperatorUser,
  operatorPass: process.env.ADMIN_OPERATOR_PASS || defaultOperatorPass
};
