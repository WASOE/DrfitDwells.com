const AuditEvent = require('../models/AuditEvent');

const FORCED_FAIL_ENV = 'FORCE_AUDIT_WRITE_FAIL';
const FORCED_FAIL_HEADER = 'x-force-audit-fail';

function shouldForceAuditFailure(req) {
  if (process.env[FORCED_FAIL_ENV] === '1') return true;
  if (!req) return false;
  return String(req.headers?.[FORCED_FAIL_HEADER] || '').trim() === '1';
}

async function appendAuditEvent(payload, options = {}) {
  const { req } = options;
  if (shouldForceAuditFailure(req)) {
    const err = new Error('Forced audit failure for validation path');
    err.code = 'AUDIT_WRITE_FAILED';
    throw err;
  }

  const doc = await AuditEvent.create({
    happenedAt: payload.happenedAt || new Date(),
    actorType: payload.actorType,
    actorId: payload.actorId ?? null,
    entityType: payload.entityType,
    entityId: String(payload.entityId),
    action: payload.action,
    beforeSnapshot: payload.beforeSnapshot ?? null,
    afterSnapshot: payload.afterSnapshot ?? null,
    metadata: payload.metadata || {},
    reason: payload.reason ?? null,
    sourceContext: payload.sourceContext ?? null
  });

  return doc;
}

module.exports = {
  appendAuditEvent,
  shouldForceAuditFailure,
  FORCED_FAIL_ENV,
  FORCED_FAIL_HEADER
};
