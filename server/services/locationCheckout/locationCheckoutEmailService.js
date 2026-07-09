const emailService = require('../emailService');

function formatDateRange(checkIn, checkOut) {
  const opts = { year: 'numeric', month: 'long', day: 'numeric' };
  const inStr = checkIn ? new Date(checkIn).toLocaleDateString('en-GB', opts) : '';
  const outStr = checkOut ? new Date(checkOut).toLocaleDateString('en-GB', opts) : '';
  return `${inStr} – ${outStr}`;
}

async function sendLocationBookingConfirmationEmail(locationBooking) {
  const guest = locationBooking.guestInfo || {};
  const to = guest.email;
  if (!to) {
    return { success: false, error: 'missing_guest_email' };
  }

  const subject = 'Your private retreat at The Valley is confirmed';
  const html = `
    <p>Dear ${guest.firstName || 'Guest'},</p>
    <p>Thank you for booking <strong>The Valley</strong> exclusively for your group.</p>
    <p><strong>Dates:</strong> ${formatDateRange(locationBooking.checkIn, locationBooking.checkOut)}</p>
    <p><strong>Guests:</strong> ${locationBooking.adults} adult${locationBooking.adults !== 1 ? 's' : ''}${
      locationBooking.children
        ? `, ${locationBooking.children} child${locationBooking.children !== 1 ? 'ren' : ''}`
        : ''
    }</p>
    <p><strong>Total:</strong> €${Number(locationBooking.totalPrice || 0).toLocaleString('en-EU')}</p>
    <p>Our team will be in touch with arrival details. If you shared room preferences, we have noted them for your stay.</p>
    <p>With warmth,<br/>Drift &amp; Dwells</p>
  `;

  return emailService.sendEmail({
    to,
    subject,
    html,
    text: `Your private retreat at The Valley is confirmed for ${formatDateRange(
      locationBooking.checkIn,
      locationBooking.checkOut
    )}. Total: €${locationBooking.totalPrice}.`
  });
}

async function sendLocationBookingInternalNotification({ locationBooking, childCount }) {
  const guest = locationBooking.guestInfo || {};
  const adminEmail = process.env.ADMIN_EMAIL || process.env.BOOKING_NOTIFICATION_EMAIL;
  if (!adminEmail) {
    return { success: false, error: 'no_admin_email' };
  }

  const subject = `New whole-Valley booking — ${guest.firstName || ''} ${guest.lastName || ''}`.trim();
  const allocationNote = locationBooking.roomAllocation?.notes
    ? `<p><strong>Room allocation notes:</strong> ${locationBooking.roomAllocation.notes}</p>`
    : '';
  const html = `
    <p><strong>Whole-location booking confirmed</strong></p>
    <p>Guest: ${guest.firstName} ${guest.lastName} (${guest.email})</p>
    <p>Dates: ${formatDateRange(locationBooking.checkIn, locationBooking.checkOut)}</p>
    <p>Total: €${locationBooking.totalPrice}</p>
    <p>Child stay rows created: ${childCount}</p>
    ${allocationNote}
  `;

  return emailService.sendEmail({
    to: adminEmail,
    subject,
    html,
    text: `Whole-Valley booking for ${guest.email}, ${childCount} child rows.`
  });
}

module.exports = {
  sendLocationBookingConfirmationEmail,
  sendLocationBookingInternalNotification
};
