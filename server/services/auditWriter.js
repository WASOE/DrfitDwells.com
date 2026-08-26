const AuditEvent = require('../models/AuditEvent');

const FORCED_FAIL_ENV = 'FORCE_AUDIT_WRITE_FAIL';
const FORCED_FAIL_HEADER = 'x-force-audit-fail';

function shouldForceAuditFailure(req) {
  if (process.env[FORCED_FAIL_ENV] === '1') return true;
  if (!req) return false;
  return String(req.headers?.[FORCED_FAIL_HEADER] || '').trim() === '1';
}

/**
 * Normalize optional dedupeKey: only non-empty strings are stored.
 * Empty / null / undefined → omit field (do not write null — avoids unique-null collisions).
 */
function normalizeDedupeKey(raw) {
  if (raw == null) return undefined;
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

async function appendAuditEvent(payload, options = {}) {
  const { req } = options;
  if (shouldForceAuditFailure(req)) {
    const err = new Error('Forced audit failure for validation path');
    err.code = 'AUDIT_WRITE_FAILED';
    throw err;
  }

  const actorRoleFromReq = options.req?.user?.role != null ? String(options.req.user.role) : null;
  const dedupeKey = normalizeDedupeKey(payload.dedupeKey);
  const docPayload = {
    happenedAt: payload.happenedAt || new Date(),
    actorType: payload.actorType,
    actorId: payload.actorId ?? null,
    actorRole: payload.actorRole != null ? String(payload.actorRole) : actorRoleFromReq,
    entityType: payload.entityType,
    entityId: String(payload.entityId),
    action: payload.action,
    beforeSnapshot: payload.beforeSnapshot ?? null,
    afterSnapshot: payload.afterSnapshot ?? null,
    metadata: payload.metadata || {},
    reason: payload.reason ?? null,
    sourceContext: payload.sourceContext ?? null
  };
  if (dedupeKey !== undefined) {
    docPayload.dedupeKey = dedupeKey;
  }

  const doc = await AuditEvent.create(docPayload);
  return doc;
}

module.exports = {
  appendAuditEvent,
  shouldForceAuditFailure,
  normalizeDedupeKey,
  FORCED_FAIL_ENV,
  FORCED_FAIL_HEADER
};
