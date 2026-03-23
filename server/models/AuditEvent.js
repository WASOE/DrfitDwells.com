const mongoose = require('mongoose');

const ACTOR_TYPES = ['user', 'system', 'webhook', 'sync_importer'];

const auditEventSchema = new mongoose.Schema(
  {
    happenedAt: {
      type: Date,
      required: true,
      default: Date.now,
      immutable: true,
      index: true
    },
    actorType: {
      type: String,
      enum: ACTOR_TYPES,
      required: true,
      immutable: true
    },
    actorId: {
      type: String,
      default: null,
      immutable: true
    },
    /** JWT role at write time: admin | operator (NIST RBAC audit trail). */
    actorRole: {
      type: String,
      default: null,
      immutable: true,
      index: true
    },
    entityType: {
      type: String,
      required: true,
      immutable: true,
      index: true
    },
    entityId: {
      type: String,
      required: true,
      immutable: true,
      index: true
    },
    action: {
      type: String,
      required: true,
      immutable: true,
      index: true
    },
    beforeSnapshot: {
      type: Object,
      default: null,
      immutable: true
    },
    afterSnapshot: {
      type: Object,
      default: null,
      immutable: true
    },
    metadata: {
      type: Object,
      default: {},
      immutable: true
    },
    reason: {
      type: String,
      default: null,
      immutable: true
    },
    sourceContext: {
      type: Object,
      default: null,
      immutable: true
    }
  },
  { timestamps: true, versionKey: false }
);

auditEventSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne'], function rejectUpdates(next) {
  next(new Error('AuditEvent history is append-only and immutable'));
});
auditEventSchema.pre(['deleteOne', 'deleteMany', 'findOneAndDelete', 'findByIdAndDelete'], function rejectDeletes(next) {
  next(new Error('AuditEvent history is append-only and immutable'));
});

module.exports = mongoose.model('AuditEvent', auditEventSchema);
module.exports.ACTOR_TYPES = ACTOR_TYPES;
