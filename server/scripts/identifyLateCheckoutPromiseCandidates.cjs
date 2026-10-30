'use strict';

/**
 * Read-only helper: surface bookings that MAY have been promised a non-standard
 * (e.g. 12:00) checkout in free text. Does NOT change any guest agreement.
 *
 * Usage (against a non-prod or explicitly approved URI):
 *   node server/scripts/identifyLateCheckoutPromiseCandidates.cjs
 *
 * Looks for:
 * - craft.extras.lateCheckoutApproved === true (structured, honored by V2)
 * - specialRequests / cleaningNotes mentioning late checkout or 12:00
 *
 * Free-text matches require human verification before any guest communication change.
 */

const mongoose = require('mongoose');
const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');
const Booking = require('../models/Booking');

const TEXT_RE = /late\s*check[\s-]*out|checkout\s*by\s*12|12:00|12\s*o'?clock/i;

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || DEFAULT_MONGO_URI;
  await mongoose.connect(uri);

  const structured = await Booking.find({
    'craft.extras.lateCheckoutApproved': true
  })
    .select('_id status checkIn checkOut guestInfo.email craft.extras specialRequests cleaningNotes')
    .lean();

  const textCandidates = await Booking.find({
    $or: [
      { specialRequests: TEXT_RE },
      { cleaningNotes: TEXT_RE }
    ]
  })
    .select('_id status checkIn checkOut guestInfo.email craft.extras specialRequests cleaningNotes')
    .limit(200)
    .lean();

  const report = {
    generatedAt: new Date().toISOString(),
    note:
      'Structured approvals are honored by Arrival V2. Free-text candidates must be verified manually; never retroactively change a confirmed guest-specific agreement without ops confirmation.',
    structuredApprovedCount: structured.length,
    structuredApproved: structured.map((b) => ({
      bookingId: String(b._id),
      status: b.status,
      approvedLateCheckoutBy: b.craft?.extras?.approvedLateCheckoutBy || null,
      email: b.guestInfo?.email || null
    })),
    freeTextCandidateCount: textCandidates.length,
    freeTextCandidates: textCandidates.map((b) => ({
      bookingId: String(b._id),
      status: b.status,
      email: b.guestInfo?.email || null,
      specialRequests: b.specialRequests || null,
      cleaningNotes: b.cleaningNotes || null,
      structuredApproved: b.craft?.extras?.lateCheckoutApproved === true
    }))
  };

  console.log(JSON.stringify(report, null, 2));
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(JSON.stringify({ success: false, error: err.message }, null, 2));
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
