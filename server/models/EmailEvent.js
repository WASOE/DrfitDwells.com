const mongoose = require('mongoose');

const EmailEventSchema = new mongoose.Schema({
  provider: { type: String, default: 'postmark', index: true },
  stream:   { type: String, index: true }, // Transactional/Broadcast if present
  type:     { type: String, index: true }, // Delivered, Opened, Clicked, Bounced, SpamComplaint, etc.
  messageId:{ type: String, index: true, unique: true, sparse: true }, // Postmark 'MessageID' if unique per message
  postmarkId:{ type: Number, index: true },  // Postmark 'ID' for bounces
  bookingId:{ type: mongoose.Schema.Types.ObjectId, ref: 'Booking' }, // if we can derive from metadata/tag
  to:       { type: String, index: true },
  subject:  String,
  tag:      String,
  details:  Object, // raw payload slice (safe fields)
  /** App-logged booking lifecycle / resend rows (type === 'LifecycleEmail') */
  templateKey: { type: String, index: true },
  lifecycleSource: { type: String, enum: ['automatic', 'manual_resend'], index: true },
  emailTrigger: { type: String, index: true },
  sendStatus: { type: String, enum: ['success', 'failed', 'skipped'], index: true },
  deliveryMethod: { type: String },
  overrideRecipientUsed: { type: Boolean, default: false },
  guestEmailAtSend: { type: String },
  errorMessage: { type: String },
  actorId: { type: String },
  actorRole: { type: String },
  createdAt:{ type: Date, default: Date.now, index: true }
});

// Optional TTL (90 days)
// EmailEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 3600 });

module.exports = mongoose.model('EmailEvent', EmailEventSchema);

