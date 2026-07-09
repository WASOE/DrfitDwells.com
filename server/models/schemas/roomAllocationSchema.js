const mongoose = require('mongoose');

const roomAllocationAssignmentSchema = new mongoose.Schema(
  {
    targetKey: {
      type: String,
      trim: true,
      default: null
    },
    accommodationName: {
      type: String,
      trim: true,
      maxlength: [120, 'Accommodation name cannot exceed 120 characters']
    },
    plannedGuests: {
      type: Number,
      min: [0, 'plannedGuests cannot be negative'],
      max: [100, 'plannedGuests cannot exceed 100'],
      default: null
    },
    notes: {
      type: String,
      trim: true,
      maxlength: [500, 'Assignment notes cannot exceed 500 characters'],
      default: null
    }
  },
  { _id: false }
);

const roomAllocationSchema = new mongoose.Schema(
  {
    notes: {
      type: String,
      trim: true,
      maxlength: [2000, 'Room allocation notes cannot exceed 2000 characters'],
      default: null
    },
    assignments: {
      type: [roomAllocationAssignmentSchema],
      default: []
    }
  },
  { _id: false }
);

/** Optional OPS-only guest room distribution; never affects pricing. */
const roomAllocationField = {
  type: roomAllocationSchema,
  default: null
};

function normalizeRoomAllocation(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    return trimmed ? { notes: trimmed.slice(0, 2000), assignments: [] } : null;
  }
  if (typeof raw !== 'object') return null;

  const notes =
    typeof raw.notes === 'string' && raw.notes.trim() ? raw.notes.trim().slice(0, 2000) : null;
  const assignments = Array.isArray(raw.assignments)
    ? raw.assignments
        .map((row) => {
          if (!row || typeof row !== 'object') return null;
          const accommodationName =
            typeof row.accommodationName === 'string' ? row.accommodationName.trim().slice(0, 120) : '';
          if (!accommodationName) return null;
          const plannedGuests =
            row.plannedGuests == null || row.plannedGuests === ''
              ? null
              : Math.max(0, Math.min(100, parseInt(row.plannedGuests, 10) || 0));
          const assignmentNotes =
            typeof row.notes === 'string' && row.notes.trim()
              ? row.notes.trim().slice(0, 500)
              : null;
          const targetKey =
            typeof row.targetKey === 'string' && row.targetKey.trim()
              ? row.targetKey.trim().slice(0, 128)
              : null;
          return {
            targetKey,
            accommodationName,
            plannedGuests,
            notes: assignmentNotes
          };
        })
        .filter(Boolean)
    : [];

  if (!notes && assignments.length === 0) return null;
  return { notes, assignments };
}

module.exports = {
  roomAllocationSchema,
  roomAllocationField,
  normalizeRoomAllocation
};
