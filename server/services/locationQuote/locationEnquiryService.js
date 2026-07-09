const LocationEnquiry = require('../../models/LocationEnquiry');
const emailService = require('../emailService');
const { createDomainError } = require('../ops/domain/errors');
const { getLocationEntry } = require('../ops/domain/locationRegistry');
const {
  resolveLocationKeyFromParam,
  getPublicSlugForLocationKey
} = require('./locationSlugRegistry');
const { htmlEscape } = require('../../utils/htmlEscape');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeOptionalString(value, maxLen) {
  if (value == null || value === '') return '';
  return String(value).trim().slice(0, maxLen);
}

function buildInternalEnquiryEmail(enquiry, locationLabel) {
  const snap = enquiry.quoteSnapshot || {};
  const lines = [
    `New private retreat enquiry — ${locationLabel}`,
    '',
    `Name: ${enquiry.name}`,
    `Email: ${enquiry.email}`,
    enquiry.phone ? `Phone: ${enquiry.phone}` : null,
    `Dates: ${enquiry.checkIn} → ${enquiry.checkOut}`,
    `Guests: ${enquiry.adults} adults, ${enquiry.children} children`,
    `Quote available: ${snap.available === true ? 'yes' : 'no'}`,
    snap.totalPrice != null ? `Estimated lodging: €${snap.totalPrice}` : null,
    snap.nights != null ? `Nights: ${snap.nights}` : null,
    enquiry.message ? `Message:\n${enquiry.message}` : null,
    '',
    'This is a request-to-book enquiry. No booking or block was created automatically.'
  ].filter(Boolean);

  const text = lines.join('\n');
  const html = `
    <h2>${htmlEscape(`New private retreat enquiry — ${locationLabel}`)}</h2>
    <p><strong>Name:</strong> ${htmlEscape(enquiry.name)}</p>
    <p><strong>Email:</strong> ${htmlEscape(enquiry.email)}</p>
    ${enquiry.phone ? `<p><strong>Phone:</strong> ${htmlEscape(enquiry.phone)}</p>` : ''}
    <p><strong>Dates:</strong> ${htmlEscape(enquiry.checkIn)} → ${htmlEscape(enquiry.checkOut)}</p>
    <p><strong>Guests:</strong> ${enquiry.adults} adults, ${enquiry.children} children</p>
    <p><strong>Quote available:</strong> ${snap.available === true ? 'Yes' : 'No'}</p>
    ${snap.totalPrice != null ? `<p><strong>Estimated lodging:</strong> €${htmlEscape(String(snap.totalPrice))}</p>` : ''}
    ${snap.nights != null ? `<p><strong>Nights:</strong> ${htmlEscape(String(snap.nights))}</p>` : ''}
    ${enquiry.message ? `<p><strong>Message:</strong><br>${htmlEscape(enquiry.message).replace(/\n/g, '<br>')}</p>` : ''}
    <p><em>No booking or availability block was created automatically.</em></p>
  `;

  return {
    subject: `Private retreat enquiry — ${locationLabel} (${enquiry.checkIn})`,
    text,
    html
  };
}

/**
 * @param {object} body
 */
async function submitLocationEnquiry(body) {
  const name = normalizeOptionalString(body?.name, 200);
  const email = normalizeOptionalString(body?.email, 320).toLowerCase();
  const phone = normalizeOptionalString(body?.phone, 40) || null;
  const checkIn = normalizeOptionalString(body?.checkIn, 32);
  const checkOut = normalizeOptionalString(body?.checkOut, 32);
  const message = normalizeOptionalString(body?.message, 4000);
  const quoteSnapshot = body?.quoteSnapshot;

  if (!name) {
    throw createDomainError('validation', 'Name is required', null, 400);
  }
  if (!email || !EMAIL_PATTERN.test(email)) {
    throw createDomainError('validation', 'A valid email address is required', null, 400);
  }
  if (!checkIn || !checkOut) {
    throw createDomainError('validation', 'checkIn and checkOut are required', null, 400);
  }
  if (!quoteSnapshot || typeof quoteSnapshot !== 'object') {
    throw createDomainError('validation', 'quoteSnapshot from a recent quote is required', null, 400);
  }

  const adults = Math.max(0, parseInt(body?.adults, 10) || 0);
  const children = Math.max(0, parseInt(body?.children, 10) || 0);
  if (adults + children < 1) {
    throw createDomainError('validation', 'At least one guest is required', null, 400);
  }

  let locationKey;
  try {
    const slugOrKey = body?.locationKey || body?.locationSlug || 'the-valley';
    locationKey = resolveLocationKeyFromParam(slugOrKey);
  } catch {
    throw createDomainError('validation', 'Unknown location', null, 400);
  }

  const { label: locationLabel } = getLocationEntry(locationKey);
  const locationSlug = getPublicSlugForLocationKey(locationKey);

  const enquiry = await LocationEnquiry.create({
    name,
    email,
    phone,
    checkIn,
    checkOut,
    adults,
    children,
    message,
    locationKey,
    locationSlug,
    quoteSnapshot,
    status: 'new'
  });

  const internalEmail = buildInternalEnquiryEmail(enquiry, locationLabel);
  const to = process.env.EMAIL_TO_INTERNAL || 'ops@driftdwells.com';

  let notificationSent = false;
  try {
    const sendResult = await emailService.sendEmail({
      to,
      subject: internalEmail.subject,
      html: internalEmail.html,
      text: internalEmail.text,
      trigger: 'location_enquiry_internal',
      skipIdempotencyWindow: true
    });
    notificationSent = Boolean(sendResult?.success);
  } catch (err) {
    console.error('Location enquiry notification failed:', err.message);
  }

  if (notificationSent) {
    enquiry.notificationSent = true;
    await enquiry.save();
  }

  return {
    enquiryId: String(enquiry._id),
    notificationSent
  };
}

module.exports = {
  submitLocationEnquiry
};
