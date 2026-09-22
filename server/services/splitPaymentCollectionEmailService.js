/**
 * SP6 — installment reminder + failure/recovery emails via EmailDeliveryState.
 * Idempotent correlation keys; crash-safe.
 */
'use strict';

const Booking = require('../models/Booking');
const BookingInstallment = require('../models/BookingInstallment');
const EmailDeliveryState = require('../models/EmailDeliveryState');
const Cabin = require('../models/Cabin');
const CabinType = require('../models/CabinType');
const {
  bookingLifecycleCorrelationKey,
  normalizeRecipientEmail
} = require('./email/emailDeliveryCorrelation');
const emailService = require('./emailService');
const { isReminderDue, sofiaTodayDateOnly } = require('./splitPaymentInvoiceTime');
const { formatSofiaDisplayDate } = require('../utils/dateTime');

const TEMPLATE_KEYS = Object.freeze({
  SPLIT_INSTALLMENT_REMINDER: 'split_installment_reminder',
  SPLIT_INSTALLMENT_PAYMENT_FAILED: 'split_installment_payment_failed'
});

function euros(cents) {
  return (Math.trunc(Number(cents) || 0) / 100).toFixed(2);
}

async function loadCabinForBooking(booking) {
  if (booking.cabinId) {
    const cabin = await Cabin.findById(booking.cabinId).lean();
    if (cabin) return cabin;
  }
  if (booking.cabinTypeId) {
    const ct = await CabinType.findById(booking.cabinTypeId).lean();
    if (ct) return { name: ct.name || 'Stay', location: ct.location || '' };
  }
  return { name: 'Your stay', location: '' };
}

async function ensureAndSendLifecycleEmail({
  booking,
  templateKey,
  subject,
  html,
  text,
  extraMeta = {}
}) {
  const recipientEmail = normalizeRecipientEmail(booking.guestInfo?.email);
  if (!recipientEmail) {
    return { sent: false, reason: 'no_email' };
  }
  const correlationKey = bookingLifecycleCorrelationKey({
    bookingId: booking._id,
    templateKey,
    recipientEmail
  });

  const existing = await EmailDeliveryState.findOne({ correlationKey }).lean();
  if (
    existing &&
    (existing.latestStatus === 'succeeded' || existing.latestStatus === 'success')
  ) {
    return { sent: false, reason: 'already_sent', correlationKey };
  }

  const now = new Date();
  await EmailDeliveryState.findOneAndUpdate(
    { correlationKey },
    {
      $setOnInsert: {
        correlationKey,
        bookingId: booking._id,
        templateKey,
        recipient: recipientEmail,
        domain: 'booking_lifecycle',
        latestStatus: 'pending',
        latestEventAt: now,
        latestLifecycleSource: 'automatic',
        attemptCount: 0,
        maxAttempts: 10
      }
    },
    { upsert: true, new: true }
  );

  const claimed = await EmailDeliveryState.findOneAndUpdate(
    {
      correlationKey,
      latestStatus: { $in: ['pending', 'failed'] }
    },
    {
      $set: {
        latestStatus: 'sending',
        claimedAt: now,
        latestEventAt: now
      },
      $inc: { attemptCount: 1 }
    },
    { new: true }
  );
  if (!claimed) {
    return { sent: false, reason: 'not_claimable', correlationKey };
  }

  try {
    await emailService.sendEmail({
      to: recipientEmail,
      subject,
      html,
      text
    });
    await EmailDeliveryState.updateOne(
      { correlationKey },
      {
        $set: {
          latestStatus: 'succeeded',
          latestEventAt: new Date(),
          latestErrorMessage: null,
          claimedBy: null,
          claimedAt: null
        }
      }
    );
    return { sent: true, correlationKey };
  } catch (err) {
    await EmailDeliveryState.updateOne(
      { correlationKey },
      {
        $set: {
          latestStatus: 'failed',
          latestEventAt: new Date(),
          latestErrorMessage: String(err.message || err).slice(0, 500),
          claimedBy: null,
          claimedAt: null
        }
      }
    );
    throw err;
  }
}

function composeReminderContent({ booking, installment, cabin }) {
  const amount = euros(installment.amountCents);
  const chargeDate = formatSofiaDisplayDate(
    `${installment.dueAtDateOnly}T10:00:00`,
    'en-GB'
  );
  const subject = `Upcoming payment for your Drift & Dwells stay — €${amount}`;
  const text = `
Drift & Dwells — Upcoming automatic payment

Hello ${booking.guestInfo?.firstName || 'guest'},

This is a reminder that your saved card will be charged automatically for the next installment of your booking.

Booking: ${cabin.name}
Amount: €${amount}
Charge date: ${chargeDate}

No action is needed if your card is up to date.

Warm regards,
The Drift & Dwells team
`.trim();
  const html = `<p>Hello ${booking.guestInfo?.firstName || 'guest'},</p>
<p>This is a reminder that your <strong>saved card will be charged automatically</strong> for the next installment of your booking.</p>
<ul>
<li><strong>Booking:</strong> ${cabin.name}</li>
<li><strong>Amount:</strong> €${amount}</li>
<li><strong>Charge date:</strong> ${chargeDate}</li>
</ul>
<p>No action is needed if your card is up to date.</p>
<p>Warm regards,<br>The Drift &amp; Dwells team</p>`;
  return { subject, html, text };
}

function composeFailureContent({
  booking,
  installment,
  cabin,
  reason,
  nextPaymentAttemptAt,
  hostedInvoiceUrl
}) {
  const amount = euros(installment.amountCents);
  const subject = `Payment issue for your Drift & Dwells stay — €${amount}`;
  const nextLine = nextPaymentAttemptAt
    ? `Stripe may retry on ${formatSofiaDisplayDate(nextPaymentAttemptAt, 'en-GB')}.`
    : 'You can complete payment securely using the recovery link below.';
  const action =
    reason === 'requires_action'
      ? 'Your bank requires additional authentication to complete the payment.'
      : 'We could not complete the automatic installment charge.';
  const text = `
Drift & Dwells — Payment needs attention

Hello ${booking.guestInfo?.firstName || 'guest'},

${action}

Booking: ${cabin.name}
Amount: €${amount}
${nextLine}

Complete payment securely:
${hostedInvoiceUrl || '(recovery link unavailable — contact support)'}

Warm regards,
The Drift & Dwells team
`.trim();
  const html = `<p>Hello ${booking.guestInfo?.firstName || 'guest'},</p>
<p>${action}</p>
<ul>
<li><strong>Booking:</strong> ${cabin.name}</li>
<li><strong>Amount:</strong> €${amount}</li>
</ul>
<p>${nextLine}</p>
${
  hostedInvoiceUrl
    ? `<p><a href="${hostedInvoiceUrl}">Complete payment securely</a></p>`
    : '<p>Please contact support to complete payment.</p>'
}
<p>Warm regards,<br>The Drift &amp; Dwells team</p>`;
  return { subject, html, text };
}

async function sendSplitInstallmentReminder({ booking, installment }) {
  if (!installment || Number(installment.sequence) < 2) {
    return { sent: false, reason: 'not_future' };
  }
  if (['paid', 'voided', 'cancelled', 'waived'].includes(String(installment.status))) {
    return { sent: false, reason: 'terminal' };
  }
  if (installment.reminderSentAt) {
    return { sent: false, reason: 'already_marked' };
  }
  if (!isReminderDue({ dueAtDateOnly: installment.dueAtDateOnly })) {
    return { sent: false, reason: 'not_due' };
  }

  const cabin = await loadCabinForBooking(booking);
  const content = composeReminderContent({ booking, installment, cabin });
  const templateKey = `${TEMPLATE_KEYS.SPLIT_INSTALLMENT_REMINDER}:seq${installment.sequence}`;
  const result = await ensureAndSendLifecycleEmail({
    booking,
    templateKey,
    ...content,
    extraMeta: {
      installmentId: String(installment._id),
      sequence: installment.sequence,
      dueAtDateOnly: installment.dueAtDateOnly
    }
  });

  if (result.sent || result.reason === 'already_sent') {
    await BookingInstallment.updateOne(
      { _id: installment._id, reminderSentAt: null },
      {
        $set: {
          reminderSentAt: new Date(),
          reminderDeliveryKey: result.correlationKey || null
        }
      }
    );
  }
  return result;
}

async function sendSplitInstallmentFailureEmail({
  booking,
  installment,
  reason,
  nextPaymentAttemptAt,
  hostedInvoiceUrl
}) {
  if (!installment || Number(installment.sequence) < 2) {
    return { sent: false, reason: 'not_future' };
  }
  if (String(installment.status) === 'paid') {
    return { sent: false, reason: 'paid' };
  }

  const cabin = await loadCabinForBooking(booking);
  const content = composeFailureContent({
    booking,
    installment,
    cabin,
    reason,
    nextPaymentAttemptAt,
    hostedInvoiceUrl
  });
  // Include attempt count so meaningful new failures can notify once each.
  const attempt = Number(installment.attemptCount) || 0;
  const templateKey = `${TEMPLATE_KEYS.SPLIT_INSTALLMENT_PAYMENT_FAILED}:seq${installment.sequence}:a${attempt}:${reason}`;
  const result = await ensureAndSendLifecycleEmail({
    booking,
    templateKey,
    ...content,
    extraMeta: {
      installmentId: String(installment._id),
      sequence: installment.sequence,
      reason,
      hostedInvoiceUrl: hostedInvoiceUrl || null
    }
  });
  if (result.sent || result.reason === 'already_sent') {
    await BookingInstallment.updateOne(
      { _id: installment._id },
      {
        $set: {
          failureEmailSentAt: new Date(),
          failureEmailDeliveryKey: result.correlationKey || null
        }
      }
    );
  }
  return result;
}

async function processDueInstallmentReminders({
  limit = 50,
  now = new Date(),
  BookingInstallmentModel = BookingInstallment,
  BookingModel = Booking
} = {}) {
  const today = sofiaTodayDateOnly(now);
  const rows = await BookingInstallmentModel.find({
    sequence: { $gte: 2 },
    status: { $in: ['scheduled', 'processing', 'failed', 'requires_action', 'retry_exhausted'] },
    reminderSentAt: null,
    dueAtDateOnly: { $gte: today }
  })
    .sort({ dueAtDateOnly: 1 })
    .limit(limit * 3);

  const results = [];
  for (const row of rows) {
    if (!isReminderDue({ dueAtDateOnly: row.dueAtDateOnly, now })) continue;
    const booking = await BookingModel.findById(row.bookingId);
    if (!booking) continue;
    results.push({
      installmentId: String(row._id),
      ...(await sendSplitInstallmentReminder({ booking, installment: row }))
    });
    if (results.length >= limit) break;
  }
  return results;
}

module.exports = {
  TEMPLATE_KEYS,
  sendSplitInstallmentReminder,
  sendSplitInstallmentFailureEmail,
  processDueInstallmentReminders,
  composeReminderContent,
  composeFailureContent
};
