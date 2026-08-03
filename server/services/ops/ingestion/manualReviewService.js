const mongoose = require('mongoose');
const ManualReviewItem = require('../../../models/ManualReviewItem');
const {
  buildOrdinaryManualReviewResolutionFilter,
  withOrdinaryManualReviewHoldExclusion,
  classifyOrdinaryResolutionZeroMatch
} = require('./manualReviewResolutionHoldFilter');

async function openManualReviewItem({
  category,
  severity = 'medium',
  entityType = null,
  entityId = null,
  title,
  details = '',
  provenance = {},
  evidence = {}
}) {
  const filter = {
    category,
    status: 'open',
    entityType: entityType || null,
    entityId: entityId ? String(entityId) : null,
    'provenance.source': provenance.source || 'internal',
    'provenance.sourceReference': provenance.sourceReference || null
  };

  const update = {
    $setOnInsert: {
      category,
      severity,
      status: 'open',
      entityType: entityType || null,
      entityId: entityId ? String(entityId) : null,
      title,
      provenance: {
        source: provenance.source || 'internal',
        sourceReference: provenance.sourceReference || null,
        detectedAt: provenance.detectedAt || new Date()
      }
    },
    $set: {
      details,
      evidence
    }
  };

  const item = await ManualReviewItem.findOneAndUpdate(filter, update, {
    upsert: true,
    new: true
  });

  // Immediate ops push for payment finalization failures (scheduled-job health is a separate track).
  if (category === 'payment_finalization_failure' && item) {
    try {
      const {
        notifyOpsPushManualReviewOpened
      } = require('../push/opsPushEventNotifications');
      await notifyOpsPushManualReviewOpened({
        manualReviewItemId: item._id,
        category,
        failedInvariant: evidence?.failedInvariant || null,
        correlationId: evidence?.correlationId || provenance?.sourceReference || null
      });
    } catch {
      /* non-fatal */
    }
  }

  return item;
}

async function openEmailDeliveryManualReview({
  category,
  severity = 'high',
  entityType = null,
  entityId = null,
  title,
  details = '',
  provenance = {},
  evidence = {}
}) {
  const deliveryCorrelationKey =
    evidence?.deliveryCorrelationKey != null ? String(evidence.deliveryCorrelationKey).trim() : '';
  if (!deliveryCorrelationKey) {
    throw new Error('openEmailDeliveryManualReview requires evidence.deliveryCorrelationKey');
  }

  const filter = {
    category,
    status: 'open',
    'evidence.deliveryCorrelationKey': deliveryCorrelationKey
  };

  const update = {
    $setOnInsert: {
      category,
      severity,
      status: 'open',
      entityType: entityType || null,
      entityId: entityId ? String(entityId) : null,
      title,
      provenance: {
        source: provenance.source || 'internal',
        sourceReference: provenance.sourceReference || null,
        detectedAt: provenance.detectedAt || new Date()
      }
    },
    $set: {
      details,
      evidence: {
        ...evidence,
        deliveryCorrelationKey
      }
    }
  };

  return ManualReviewItem.findOneAndUpdate(filter, update, {
    upsert: true,
    new: true
  });
}

async function resolveEmailDeliveryManualReviews({
  deliveryCorrelationKey,
  categories = [],
  resolvedBy = 'system',
  note = 'Auto-resolved: email delivered successfully.'
}) {
  const key = deliveryCorrelationKey != null ? String(deliveryCorrelationKey).trim() : '';
  if (!key) {
    return { attempted: false, resolvedCount: 0, reason: 'missing_correlation_key' };
  }

  const categoryFilter = Array.isArray(categories) && categories.length > 0 ? categories : null;
  const now = new Date();
  const query = {
    status: 'open',
    'evidence.deliveryCorrelationKey': key
  };
  if (categoryFilter) {
    query.category = { $in: categoryFilter };
  }

  const updateResult = await ManualReviewItem.updateMany(
    withOrdinaryManualReviewHoldExclusion(query),
    {
      $set: {
        status: 'resolved',
        resolution: {
          resolvedAt: now,
          resolvedBy: resolvedBy || 'system',
          note: note || 'Auto-resolved: email delivered successfully.'
        },
        updatedAt: now
      }
    }
  );

  return {
    attempted: true,
    resolvedCount: Number(updateResult.modifiedCount || 0)
  };
}

async function resolveSmtpHealthManualReviews({
  category,
  entityId,
  resolvedBy = 'smtp_health_service',
  note = 'Auto-resolved: SMTP health check passed.'
}) {
  const categoryValue = category != null ? String(category).trim() : '';
  const entityIdValue = entityId != null ? String(entityId).trim() : '';
  if (!categoryValue || !entityIdValue) {
    return { attempted: false, resolvedCount: 0, reason: 'missing_category_or_entity' };
  }

  const now = new Date();
  const updateResult = await ManualReviewItem.updateMany(
    withOrdinaryManualReviewHoldExclusion({
      status: 'open',
      category: categoryValue,
      entityType: 'SmtpHealth',
      entityId: entityIdValue
    }),
    {
      $set: {
        status: 'resolved',
        resolution: {
          resolvedAt: now,
          resolvedBy: resolvedBy || 'smtp_health_service',
          note: note || 'Auto-resolved: SMTP health check passed.'
        },
        updatedAt: now
      }
    }
  );

  return {
    attempted: true,
    resolvedCount: Number(updateResult.modifiedCount || 0)
  };
}

const MIN_MANUAL_REVIEW_RESOLUTION_NOTE_LENGTH = 3;
const MAX_MANUAL_REVIEW_RESOLUTION_NOTE_LENGTH = 500;

function normalizeResolutionNote(note) {
  if (note == null) return '';
  return String(note).trim();
}

function mapManualReviewItemResponse(item) {
  if (!item) return null;
  const doc = item.toObject ? item.toObject() : item;
  return {
    manualReviewItemId: String(doc._id),
    category: doc.category,
    severity: doc.severity,
    status: doc.status,
    title: doc.title,
    details: doc.details,
    entityType: doc.entityType || null,
    entityId: doc.entityId || null,
    provenance: doc.provenance || null,
    evidence: doc.evidence || {},
    resolution: doc.resolution || null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt
  };
}

async function resolveManualReviewItem({ manualReviewItemId, resolvedBy, note }) {
  if (!manualReviewItemId || !mongoose.Types.ObjectId.isValid(String(manualReviewItemId))) {
    const err = new Error('Invalid manual review item id');
    err.code = 'INVALID_MANUAL_REVIEW_ID';
    err.status = 400;
    throw err;
  }

  const trimmedNote = normalizeResolutionNote(note);
  if (trimmedNote.length < MIN_MANUAL_REVIEW_RESOLUTION_NOTE_LENGTH) {
    const err = new Error(
      `Resolution note must be at least ${MIN_MANUAL_REVIEW_RESOLUTION_NOTE_LENGTH} characters`
    );
    err.code = 'INVALID_RESOLUTION_NOTE';
    err.status = 400;
    throw err;
  }
  if (trimmedNote.length > MAX_MANUAL_REVIEW_RESOLUTION_NOTE_LENGTH) {
    const err = new Error(
      `Resolution note must be at most ${MAX_MANUAL_REVIEW_RESOLUTION_NOTE_LENGTH} characters`
    );
    err.code = 'INVALID_RESOLUTION_NOTE';
    err.status = 400;
    throw err;
  }

  const existing = await ManualReviewItem.findById(manualReviewItemId).lean();
  if (!existing) {
    const err = new Error('Manual review item not found');
    err.code = 'MANUAL_REVIEW_NOT_FOUND';
    err.status = 404;
    throw err;
  }

  if (existing.status === 'resolved') {
    return {
      status: 'already_resolved',
      item: mapManualReviewItemResponse(existing)
    };
  }

  if (existing.status === 'ignored') {
    const err = new Error('Manual review item is ignored and cannot be resolved');
    err.code = 'MANUAL_REVIEW_NOT_OPEN';
    err.status = 409;
    throw err;
  }

  if (existing.status !== 'open') {
    const err = new Error('Manual review item is not open');
    err.code = 'MANUAL_REVIEW_NOT_OPEN';
    err.status = 409;
    throw err;
  }

  const now = new Date();
  const resolvedByValue =
    resolvedBy != null && String(resolvedBy).trim() ? String(resolvedBy).trim() : 'ops_user';

  const updated = await ManualReviewItem.findOneAndUpdate(
    buildOrdinaryManualReviewResolutionFilter({ manualReviewItemId }),
    {
      $set: {
        status: 'resolved',
        resolution: {
          resolvedAt: now,
          resolvedBy: resolvedByValue,
          note: trimmedNote
        },
        updatedAt: now
      }
    },
    { new: true }
  );

  if (!updated) {
    const current = await ManualReviewItem.findById(manualReviewItemId).lean();
    const classification = classifyOrdinaryResolutionZeroMatch(current);
    if (classification === 'already_resolved') {
      return {
        status: 'already_resolved',
        item: mapManualReviewItemResponse(current)
      };
    }
    if (classification === 'held') {
      const err = new Error('Manual review item has an active recovery resolution hold');
      err.code = 'MANUAL_REVIEW_RESOLUTION_HELD';
      err.status = 409;
      throw err;
    }
    const err = new Error('Manual review item is not open');
    err.code = 'MANUAL_REVIEW_NOT_OPEN';
    err.status = 409;
    throw err;
  }

  return {
    status: 'resolved',
    item: mapManualReviewItemResponse(updated)
  };
}

module.exports = {
  openManualReviewItem,
  openEmailDeliveryManualReview,
  resolveEmailDeliveryManualReviews,
  resolveSmtpHealthManualReviews,
  resolveManualReviewItem,
  mapManualReviewItemResponse,
  MIN_MANUAL_REVIEW_RESOLUTION_NOTE_LENGTH,
  MAX_MANUAL_REVIEW_RESOLUTION_NOTE_LENGTH
};
