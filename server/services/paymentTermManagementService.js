/**
 * PaymentTermTemplate management (SP7 Ops).
 * Draft create/update, clone, activate, retire. Active/retired immutable in place.
 */
'use strict';

const PaymentTermTemplateModel = require('../models/PaymentTermTemplate');
const {
  PaymentTermError,
  validateAndNormalizePaymentTermTemplate
} = require('./paymentTermService');

const MGMT_CODES = Object.freeze({
  INVALID_OPERATOR: 'INVALID_OPERATOR',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  NOT_FOUND: 'NOT_FOUND',
  IMMUTABLE_TEMPLATE: 'IMMUTABLE_TEMPLATE',
  INVALID_STATUS_TRANSITION: 'INVALID_STATUS_TRANSITION',
  DUPLICATE_VERSION: 'DUPLICATE_VERSION',
  STALE_REVISION: 'STALE_REVISION',
  IDENTITY_IMMUTABLE: 'IDENTITY_IMMUTABLE'
});

class PaymentTermManagementError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'PaymentTermManagementError';
    this.code = code;
    this.details = details;
  }
}

function assertOperator(operator) {
  const op = operator == null ? '' : String(operator).trim();
  if (!op) {
    throw new PaymentTermManagementError(MGMT_CODES.INVALID_OPERATOR, 'operator is required');
  }
  return op;
}

function toClient(doc) {
  if (!doc) return null;
  const o = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
  return {
    id: String(o._id),
    code: o.code,
    internalName: o.internalName,
    version: o.version,
    status: o.status,
    currency: o.currency,
    scheduleKind: o.scheduleKind,
    legs: o.legs,
    allowDateTransfer: o.allowDateTransfer === true,
    createdBy: o.createdBy || null,
    updatedBy: o.updatedBy || null,
    activatedAt: o.activatedAt || null,
    activatedBy: o.activatedBy || null,
    retiredAt: o.retiredAt || null,
    retiredBy: o.retiredBy || null,
    revision: o.__v != null ? o.__v : 0,
    createdAt: o.createdAt || null,
    updatedAt: o.updatedAt || null
  };
}

async function listPaymentTermTemplates({ status = null, code = null, limit = 200 } = {}) {
  const q = {};
  if (status) q.status = String(status);
  if (code) q.code = String(code).trim().toLowerCase();
  const rows = await PaymentTermTemplateModel.find(q)
    .sort({ code: 1, version: -1 })
    .limit(Math.min(500, Math.max(1, Number(limit) || 200)));
  return rows.map(toClient);
}

async function createDraftPaymentTermTemplate({ input, operator, session = null }) {
  const op = assertOperator(operator);
  const normalized = validateAndNormalizePaymentTermTemplate({
    ...input,
    status: 'draft'
  });
  if (!normalized.ok) {
    throw new PaymentTermManagementError(
      MGMT_CODES.VALIDATION_FAILED,
      normalized.errors.join('; '),
      { errors: normalized.errors }
    );
  }
  const v = normalized.value;
  try {
    const payload = {
      ...v,
      status: 'draft',
      createdBy: op,
      updatedBy: op
    };
    const docs = session
      ? await PaymentTermTemplateModel.create([payload], { session })
      : [await PaymentTermTemplateModel.create(payload)];
    const doc = docs[0];
    return toClient(doc);
  } catch (err) {
    if (err && err.code === 11000) {
      throw new PaymentTermManagementError(
        MGMT_CODES.DUPLICATE_VERSION,
        `Payment term ${v.code}@v${v.version} already exists`
      );
    }
    throw err;
  }
}

async function updateDraftPaymentTermTemplate({ id, input, operator, expectedRevision = null }) {
  const op = assertOperator(operator);
  const doc = await PaymentTermTemplateModel.findById(id);
  if (!doc) {
    throw new PaymentTermManagementError(MGMT_CODES.NOT_FOUND, 'Payment term not found');
  }
  if (String(doc.status) !== 'draft') {
    throw new PaymentTermManagementError(
      MGMT_CODES.IMMUTABLE_TEMPLATE,
      'Only draft payment terms can be edited in place'
    );
  }
  if (expectedRevision != null && Number(doc.__v) !== Number(expectedRevision)) {
    throw new PaymentTermManagementError(MGMT_CODES.STALE_REVISION, 'Stale revision');
  }

  const nextInput = {
    code: input.code != null ? input.code : doc.code,
    internalName: input.internalName != null ? input.internalName : doc.internalName,
    version: input.version != null ? input.version : doc.version,
    status: 'draft',
    currency: input.currency != null ? input.currency : doc.currency,
    scheduleKind: input.scheduleKind != null ? input.scheduleKind : doc.scheduleKind,
    legs: input.legs != null ? input.legs : doc.legs,
    allowDateTransfer:
      input.allowDateTransfer != null ? input.allowDateTransfer : doc.allowDateTransfer
  };

  if (String(nextInput.code) !== String(doc.code) || Number(nextInput.version) !== Number(doc.version)) {
    throw new PaymentTermManagementError(
      MGMT_CODES.IDENTITY_IMMUTABLE,
      'code and version cannot change on update; clone a new version instead'
    );
  }

  const normalized = validateAndNormalizePaymentTermTemplate(nextInput);
  if (!normalized.ok) {
    throw new PaymentTermManagementError(
      MGMT_CODES.VALIDATION_FAILED,
      normalized.errors.join('; '),
      { errors: normalized.errors }
    );
  }

  Object.assign(doc, normalized.value, { status: 'draft', updatedBy: op });
  await doc.save();
  return toClient(doc);
}

async function activatePaymentTermTemplate({ id, operator, expectedRevision = null, session = null }) {
  const op = assertOperator(operator);
  const docQuery = PaymentTermTemplateModel.findById(id);
  if (session) docQuery.session(session);
  const doc = await docQuery;
  if (!doc) {
    throw new PaymentTermManagementError(MGMT_CODES.NOT_FOUND, 'Payment term not found');
  }
  if (String(doc.status) === 'active') {
    return { ...toClient(doc), idempotent: true };
  }
  if (String(doc.status) !== 'draft') {
    throw new PaymentTermManagementError(
      MGMT_CODES.INVALID_STATUS_TRANSITION,
      'Only draft payment terms can be activated'
    );
  }
  if (expectedRevision != null && Number(doc.__v) !== Number(expectedRevision)) {
    throw new PaymentTermManagementError(MGMT_CODES.STALE_REVISION, 'Stale revision');
  }

  // Retire any other active version of the same code
  const retireQuery = PaymentTermTemplateModel.updateMany(
    { code: doc.code, status: 'active', _id: { $ne: doc._id } },
    {
      $set: {
        status: 'retired',
        retiredAt: new Date(),
        retiredBy: op
      }
    }
  );
  if (session) retireQuery.session(session);
  await retireQuery;

  doc.status = 'active';
  doc.activatedAt = new Date();
  doc.activatedBy = op;
  doc.updatedBy = op;
  await doc.save(session ? { session } : undefined);
  return toClient(doc);
}

async function retirePaymentTermTemplate({ id, operator, expectedRevision = null }) {
  const op = assertOperator(operator);
  const doc = await PaymentTermTemplateModel.findById(id);
  if (!doc) {
    throw new PaymentTermManagementError(MGMT_CODES.NOT_FOUND, 'Payment term not found');
  }
  if (String(doc.status) === 'retired') {
    return { ...toClient(doc), idempotent: true };
  }
  if (String(doc.status) !== 'active') {
    throw new PaymentTermManagementError(
      MGMT_CODES.INVALID_STATUS_TRANSITION,
      'Only active payment terms can be retired'
    );
  }
  if (expectedRevision != null && Number(doc.__v) !== Number(expectedRevision)) {
    throw new PaymentTermManagementError(MGMT_CODES.STALE_REVISION, 'Stale revision');
  }
  doc.status = 'retired';
  doc.retiredAt = new Date();
  doc.retiredBy = op;
  doc.updatedBy = op;
  await doc.save();
  return toClient(doc);
}

async function clonePaymentTermTemplate({ id, operator }) {
  const op = assertOperator(operator);
  const src = await PaymentTermTemplateModel.findById(id);
  if (!src) {
    throw new PaymentTermManagementError(MGMT_CODES.NOT_FOUND, 'Payment term not found');
  }
  const latest = await PaymentTermTemplateModel.findOne({ code: src.code })
    .sort({ version: -1 })
    .lean();
  const nextVersion = (latest?.version || src.version) + 1;
  return createDraftPaymentTermTemplate({
    operator: op,
    input: {
      code: src.code,
      internalName: src.internalName,
      version: nextVersion,
      currency: src.currency,
      scheduleKind: src.scheduleKind,
      legs: src.legs,
      allowDateTransfer: src.allowDateTransfer === true
    }
  });
}

async function getPaymentTermTemplate(id) {
  const doc = await PaymentTermTemplateModel.findById(id);
  if (!doc) {
    throw new PaymentTermManagementError(MGMT_CODES.NOT_FOUND, 'Payment term not found');
  }
  return toClient(doc);
}

module.exports = {
  MGMT_CODES,
  PaymentTermManagementError,
  listPaymentTermTemplates,
  getPaymentTermTemplate,
  createDraftPaymentTermTemplate,
  updateDraftPaymentTermTemplate,
  activatePaymentTermTemplate,
  retirePaymentTermTemplate,
  clonePaymentTermTemplate,
  toClient
};
