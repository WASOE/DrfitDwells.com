const ManualReviewItem = require('../../../models/ManualReviewItem');

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

  const updateResult = await ManualReviewItem.updateMany(query, {
    $set: {
      status: 'resolved',
      resolution: {
        resolvedAt: now,
        resolvedBy: resolvedBy || 'system',
        note: note || 'Auto-resolved: email delivered successfully.'
      },
      updatedAt: now
    }
  });

  return {
    attempted: true,
    resolvedCount: Number(updateResult.modifiedCount || 0)
  };
}

module.exports = {
  openManualReviewItem,
  openEmailDeliveryManualReview,
  resolveEmailDeliveryManualReviews
};
