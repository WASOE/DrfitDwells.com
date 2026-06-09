const mongoose = require('mongoose');
const OpsUser = require('../../models/OpsUser');
const { hashPassword, verifyPassword } = require('./opsPasswordService');
const { normalizeModulesForRole } = require('./opsModuleRegistry');
const {
  resolveOpsUserContactInput,
  applyResolvedContactFields,
  propertyKindsForRole
} = require('../../utils/opsUserContactFields');

function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

function toPublicOpsUser(doc) {
  if (!doc) {
    return null;
  }
  const role = doc.role;
  return {
    id: String(doc._id || doc.id),
    email: doc.email,
    name: doc.name,
    role,
    modules: normalizeModulesForRole(role, doc.modules),
    isActive: doc.isActive !== false,
    phone: doc.phone ?? null,
    locale: doc.locale ?? null,
    propertyKinds: Array.isArray(doc.propertyKinds) ? [...doc.propertyKinds] : [],
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt
  };
}

async function findOpsUserByEmail(email, { includePassword = false } = {}) {
  const query = OpsUser.findOne({ email: normalizeEmail(email) });
  if (includePassword) {
    query.select('+passwordHash');
  }
  return query.lean({ virtuals: false });
}

async function findOpsUserAuthRecord(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return null;
  }
  return OpsUser.findById(id).select('isActive tokenVersion').lean();
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

async function listOpsUsers() {
  const users = await OpsUser.find({}).sort({ email: 1 }).lean();
  return users.map(toPublicOpsUser);
}

async function createOpsUser({
  email,
  name,
  password,
  role,
  modules,
  isActive = true,
  phone,
  locale,
  propertyKinds
}) {
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
  const resolvedContact = resolveOpsUserContactInput({
    role: normalizedRole,
    phone,
    locale,
    propertyKinds
  });

  try {
    const payload = {
      email: normalizedEmail,
      name: normalizedName,
      passwordHash,
      role: normalizedRole,
      modules: resolvedModules,
      isActive: isActive !== false,
      propertyKinds: propertyKindsForRole(normalizedRole, [])
    };
    applyResolvedContactFields(payload, resolvedContact);

    const created = await OpsUser.create(payload);

    return toPublicOpsUser(created);
  } catch (error) {
    if (error?.code === 11000) {
      const err = new Error('An OPS user with this email already exists.');
      err.status = 409;
      throw err;
    }
    throw error;
  }
}

async function updateOpsUser(id, { name, role, modules, isActive, phone, locale, propertyKinds }) {
  const user = await OpsUser.findById(id);
  if (!user) {
    const err = new Error('OPS user not found.');
    err.status = 404;
    throw err;
  }

  let bumpToken = false;

  if (name !== undefined) {
    const normalizedName = String(name).trim();
    if (!normalizedName || normalizedName.length > 120) {
      const err = new Error('Name must be between 1 and 120 characters.');
      err.status = 400;
      throw err;
    }
    user.name = normalizedName;
  }

  if (role !== undefined) {
    const normalizedRole = String(role).toLowerCase();
    if (!OpsUser.OPS_USER_ROLES.includes(normalizedRole)) {
      const err = new Error(`Invalid role. Must be one of: ${OpsUser.OPS_USER_ROLES.join(', ')}`);
      err.status = 400;
      throw err;
    }
    user.role = normalizedRole;
    user.modules = normalizeModulesForRole(normalizedRole, modules !== undefined ? modules : user.modules);
  } else if (modules !== undefined) {
    user.modules = normalizeModulesForRole(user.role, modules);
  }

  if (isActive !== undefined) {
    const nextActive = isActive !== false;
    if (user.isActive && !nextActive) {
      bumpToken = true;
    }
    user.isActive = nextActive;
  }

  if (bumpToken) {
    user.tokenVersion = (user.tokenVersion || 1) + 1;
  }

  const effectiveRole = user.role;
  const resolvedContact = resolveOpsUserContactInput({
    role: effectiveRole,
    phone,
    locale,
    propertyKinds
  });
  applyResolvedContactFields(user, resolvedContact);
  if (effectiveRole !== 'cleaner') {
    user.propertyKinds = [];
  }

  await user.save();
  return toPublicOpsUser(user);
}

async function setOpsUserPassword(id, password) {
  if (typeof password !== 'string' || password.length < 8) {
    const err = new Error('Password must be at least 8 characters.');
    err.status = 400;
    throw err;
  }

  const user = await OpsUser.findById(id).select('+passwordHash');
  if (!user) {
    const err = new Error('OPS user not found.');
    err.status = 404;
    throw err;
  }

  user.passwordHash = hashPassword(password);
  user.tokenVersion = (user.tokenVersion || 1) + 1;
  await user.save();

  const updated = await OpsUser.findById(id).lean();
  return toPublicOpsUser(updated);
}

module.exports = {
  normalizeEmail,
  findOpsUserByEmail,
  findOpsUserAuthRecord,
  verifyOpsUserCredentials,
  toPublicOpsUser,
  listOpsUsers,
  createOpsUser,
  updateOpsUser,
  setOpsUserPassword
};
