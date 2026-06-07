const OpsUser = require('../../models/OpsUser');
const { hashPassword, verifyPassword } = require('./opsPasswordService');
const { normalizeModulesForRole } = require('./opsModuleRegistry');

function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

async function findOpsUserByEmail(email, { includePassword = false } = {}) {
  const query = OpsUser.findOne({ email: normalizeEmail(email) });
  if (includePassword) {
    query.select('+passwordHash');
  }
  return query.lean({ virtuals: false });
}

async function verifyOpsUserCredentials(email, password) {
  const user = await OpsUser.findOne({ email: normalizeEmail(email) }).select('+passwordHash');
  if (!user) {
    return { ok: false, reason: 'not_found' };
  }
  if (!user.isActive) {
    return { ok: false, reason: 'inactive' };
  }
  if (!verifyPassword(password, user.passwordHash)) {
    return { ok: false, reason: 'invalid_password' };
  }
  return {
    ok: true,
    user: {
      id: String(user._id),
      email: user.email,
      name: user.name,
      role: user.role,
      modules: normalizeModulesForRole(user.role, user.modules),
      tokenVersion: user.tokenVersion
    }
  };
}

async function createOpsUser({ email, name, password, role, modules, isActive = true }) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedName = String(name || '').trim();
  const normalizedRole = String(role || '').toLowerCase();

  if (!normalizedEmail || !normalizedName) {
    const err = new Error('Email and name are required.');
    err.status = 400;
    throw err;
  }
  if (!OpsUser.OPS_USER_ROLES.includes(normalizedRole)) {
    const err = new Error(`Invalid role. Must be one of: ${OpsUser.OPS_USER_ROLES.join(', ')}`);
    err.status = 400;
    throw err;
  }
  if (typeof password !== 'string' || password.length < 8) {
    const err = new Error('Password must be at least 8 characters.');
    err.status = 400;
    throw err;
  }

  const resolvedModules = normalizeModulesForRole(normalizedRole, modules);
  const passwordHash = hashPassword(password);

  try {
    const created = await OpsUser.create({
      email: normalizedEmail,
      name: normalizedName,
      passwordHash,
      role: normalizedRole,
      modules: resolvedModules,
      isActive: isActive !== false
    });

    return {
      id: String(created._id),
      email: created.email,
      name: created.name,
      role: created.role,
      modules: created.modules,
      isActive: created.isActive
    };
  } catch (error) {
    if (error?.code === 11000) {
      const err = new Error('An OPS user with this email already exists.');
      err.status = 409;
      throw err;
    }
    throw error;
  }
}

module.exports = {
  normalizeEmail,
  findOpsUserByEmail,
  verifyOpsUserCredentials,
  createOpsUser
};
