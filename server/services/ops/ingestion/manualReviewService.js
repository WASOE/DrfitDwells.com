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

module.exports = {
  openManualReviewItem
};
