const mongoose = require('mongoose');

const OVERLAP_STATUSES = ['active', 'restricted', 'read_only', 'target_for_cutover'];

const opsModuleCutoverSchema = new mongoose.Schema(
  {
    moduleKey: { type: String, required: true, unique: true, index: true },

    // Whether /ops is primary production surface for this module (read + supported writes).
    opsPrimary: { type: Boolean, default: false, index: true },

    // Governs legacy /admin write enforcement for this module.
    adminWriteOverlapStatus: {
      type: String,
      enum: OVERLAP_STATUSES,
      required: true,
      default: 'target_for_cutover',
      index: true
    },

    // Evidence snapshot reference when the state was applied.
    readinessComputedAt: { type: String, default: null },
    readinessVerdict: { type: String, default: null },

    // For rollback visibility.
    rollbackAvailable: { type: Boolean, default: false },

    enabledAt: { type: Date, default: null },
    rolledBackAt: { type: Date, default: null }
  },
  { timestamps: true }
);

module.exports = {
  OpsModuleCutoverState: mongoose.model('OpsModuleCutoverState', opsModuleCutoverSchema),
  OVERLAP_STATUSES
};

