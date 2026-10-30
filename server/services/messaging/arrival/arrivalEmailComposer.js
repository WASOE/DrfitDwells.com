'use strict';

const moment = require('moment-timezone');
const { PROPERTY_TIMEZONE, formatSofiaDisplayDate } = require('../../../utils/dateTime');
const { htmlEscape } = require('../../../utils/htmlEscape');
const { renderGmaEmailHtml } = require('../gmaEmailHtmlRenderer');
const { resolveArrivalStayContext } = require('./arrivalStayResolver');
const {
  GUEST_CHECK_IN_FROM,
  SUPPORT_PHONE_DISPLAY,
  VALLEY,
  CABIN,
  absoluteUrl,
  valleyGuideUrl,
  cabinGuideUrl,
  valleyTransferOfferLine,
  resolveGuestCheckoutDisplay
} = require('./arrivalPropertyFacts');

function formatStayDate(value) {
  if (value == null) return null;
  const m = moment.tz(value, PROPERTY_TIMEZONE);
  if (!m.isValid()) return null;
  return formatSofiaDisplayDate(value, 'en-GB');
}

function valleyFacilitiesLines(valleyStayFamily) {
  switch (valleyStayFamily) {
    case 'a_frame':
      return [
        'Your A-frame sleeps two guests.',
        'Kitchen, toilets, and hot showers are in the shared Stone House.',
        'Outdoor BBQs are available.',
        'Dogs are welcome if kept under control and you follow house rules.'
      ];
    case 'stone_house':
      return [
        'The Stone House has an equipped kitchen and Starlink internet.',
        'Dogs are welcome subject to house rules.'
      ];
    case 'lux_cabin':
      return [
        'The Lux Cabin has its own kitchen and private bathroom.',
        'This cabin is strictly pet-free.'
      ];
    default:
      return [
        'The Valley includes A-frame cabins, the Stone House, and the Lux Cabin — your booking names your unit.',
        'A-frames share Stone House kitchen, toilets, and hot showers.',
        'The Lux Cabin is strictly pet-free; A-frames and the Stone House permit dogs subject to house rules.'
      ];
  }
}

function paragraphsToHtml(paragraphs) {
  return paragraphs
    .filter((p) => p != null && String(p).trim() !== '')
    .map((p) => {
      const raw = String(p);
      if (raw.startsWith('## ')) {
        return `<h3 style="margin:20px 0 8px;font-size:16px;color:#1a1918;">${htmlEscape(raw.slice(3))}</h3>`;
      }
      if (raw.startsWith('- ')) {
        return `<p style="margin:0 0 6px;padding-left:12px;">• ${htmlEscape(raw.slice(2))}</p>`;
      }
      // Allow a single trusted absolute URL line as a link
      const urlMatch = raw.match(/^(https:\/\/[^\s]+)$/);
      if (urlMatch) {
        const u = urlMatch[1];
        return `<p style="margin:0 0 12px;"><a href="${htmlEscape(u)}">${htmlEscape(u)}</a></p>`;
      }
      return `<p style="margin:0 0 12px;">${htmlEscape(raw)}</p>`;
    })
    .join('\n');
}

function paragraphsToText(paragraphs) {
  return paragraphs
    .filter((p) => p != null && String(p).trim() !== '')
    .map((p) => {
      const raw = String(p);
      if (raw.startsWith('## ')) return raw.slice(3).toUpperCase();
      return raw;
    })
    .join('\n\n');
}

function buildValleyConfirmationParagraphs({
  guestFirstName,
  propertyName,
  checkInDate,
  checkOutDate,
  valleyStayFamily,
  checkoutTime
}) {
  const lines = [
    `Hi ${guestFirstName},`,
    `Your stay at ${propertyName} in The Valley is confirmed.`,
    '## Stay details',
    `Check-in: from ${GUEST_CHECK_IN_FROM} on ${checkInDate}`,
    `Checkout: by ${checkoutTime} on ${checkOutDate}`,
    'Please read your Valley guide before you travel:',
    valleyGuideUrl(),
    '## How arrival works',
    `Drive: ${VALLEY.routeLine}.`,
    VALLEY.kraishteWarning,
    `Park at ${VALLEY.parkingLabel}: ${VALLEY.parkingCoordinatesDisplay}.`,
    `From parking, the final approach is ${VALLEY.finalApproachPhrase} on foot (free), or by arranged off-road transfer.`,
    '## Off-road transfer (optional)',
    valleyTransferOfferLine(),
    'Transfers must be arranged in advance and are subject to availability.',
    'Only suitable off-road vehicles should continue beyond the parking area, at the driver’s own risk.',
    '## Your accommodation',
    ...valleyFacilitiesLines(valleyStayFamily).map((l) => `- ${l}`),
    '## Before you come',
    'There are no shops or restaurants nearby. Please bring the food and supplies you need for your stay.',
    'Practical arrival details are also in your guide. Closer to arrival, our team may send final access information for check-in.',
    'If anything is unclear, reply to this email.',
    'We look forward to hosting you.',
    'Drift & Dwells'
  ];
  return lines;
}

function buildCabinConfirmationParagraphs({ guestFirstName, checkInDate, checkOutDate, checkoutTime }) {
  return [
    `Hi ${guestFirstName},`,
    'Your stay at The Cabin is confirmed.',
    '## Stay details',
    `Check-in: from ${GUEST_CHECK_IN_FROM} on ${checkInDate}`,
    `Checkout: by ${checkoutTime} on ${checkOutDate}`,
    'The Cabin is a rugged off-grid stay near Bachevo. It is a different place from The Valley.',
    'Please read your arrival guide before you travel:',
    cabinGuideUrl(),
    '## How to navigate',
    'Google Earth is the canonical navigation source for The Cabin:',
    CABIN.googleEarthUrl,
    `Always navigate to the Google Earth “${CABIN.parkAndWalkName}” pin.`,
    'Do not use the cabin building coordinates as your driving destination.',
    '## What to expect',
    '- Limited electricity.',
    '- No running water.',
    '- Composting toilet.',
    '- Basic kitchen.',
    '- Fireplace heating.',
    '- Weak or absent mobile signal.',
    '- No Wi-Fi.',
    'If you want the hot tub for your stay, tell us before arrival — it needs advance preparation and a long heating time, and readiness depends on arrangement.',
    'Please bring the food, water, and personal supplies you need.',
    'Practical details are in your guide. Closer to arrival, our team may send final access information for check-in.',
    'If anything is unclear, reply to this email.',
    'We look forward to hosting you.',
    'Drift & Dwells'
  ];
}

/**
 * Manual / automatic-ready arrival reminder — no "three days" / "tomorrow" timing claims.
 */
function buildValleyArrivalParagraphs({
  guestFirstName,
  propertyName,
  checkInDate,
  checkOutDate,
  valleyStayFamily,
  checkoutTime
}) {
  return [
    `Hi ${guestFirstName},`,
    `Here are practical arrival details for your stay at ${propertyName}.`,
    `Arrive from ${GUEST_CHECK_IN_FROM} on ${checkInDate}.`,
    `Checkout by ${checkoutTime} on ${checkOutDate}.`,
    '## Route',
    VALLEY.routeLine + '.',
    VALLEY.kraishteWarning,
    '## Parking',
    `${VALLEY.parkingLabel}: ${VALLEY.parkingCoordinatesDisplay}`,
    'Open navigation to parking:',
    VALLEY.parkingNavigateUrl,
    '## After parking',
    `The final approach is ${VALLEY.finalApproachPhrase}.`,
    'Walking is free.',
    `Off-road transfer: ${valleyTransferOfferLine()}`,
    'Arrange transfers in advance; availability is not guaranteed.',
    'Only suitable off-road vehicles should continue beyond the parking, at the driver’s own risk.',
    '## Your unit',
    propertyName,
    ...valleyFacilitiesLines(valleyStayFamily).map((l) => `- ${l}`),
    '## Prepare',
    'There are no shops or restaurants nearby. Bring food and everything you need.',
    'Wear shoes with grip for the final approach. Bring a light if you may arrive near dark.',
    'If you will arrive later in the day, or want a transfer, message us (or Anife for transfer) before you travel.',
    '## Full guide',
    valleyGuideUrl(),
    absoluteUrl(VALLEY.howToArrivePdfPath),
    `Questions? Reply to this email or call/WhatsApp ${SUPPORT_PHONE_DISPLAY}.`,
    'Drift & Dwells'
  ];
}

function buildCabinArrivalParagraphs({ guestFirstName, checkInDate, checkOutDate, checkoutTime }) {
  return [
    `Hi ${guestFirstName},`,
    'Here are practical arrival details for your stay at The Cabin.',
    `Arrive from ${GUEST_CHECK_IN_FROM} on ${checkInDate}.`,
    `Checkout by ${checkoutTime} on ${checkOutDate}.`,
    '## Important',
    'The Cabin is near Bachevo and is not The Valley.',
    '## Navigation',
    'Google Earth is the source of truth:',
    CABIN.googleEarthUrl,
    `Always navigate to the “${CABIN.parkAndWalkName}” pin (${CABIN.parkAndWalkCoordinatesDisplay}).`,
    'Do not drive to the cabin building coordinates.',
    'Maps shortcut to the Park and walk stop (supporting only — Google Earth remains canonical):',
    CABIN.parkAndWalkNavigateUrl,
    'Park, then walk the last short section. Pull fully off the lane so other traffic can pass.',
    'The final approach can be narrow and rough. Daylight arrival is best.',
    'Phone signal can be weak or absent near the end — open Google Earth and save the guide before you lose coverage.',
    '## Your stay',
    '- Limited electricity, no running water, composting toilet, basic kitchen, fireplace heating, and no Wi-Fi.',
    '- Bring food, water, and everything you need.',
    '- If you want the hot tub prepared, tell us in advance — it takes considerable heating time and depends on arrangement.',
    '## Guide and offline files',
    cabinGuideUrl(),
    absoluteUrl(CABIN.gpxPath),
    absoluteUrl(CABIN.kmlPath),
    'Use the GPX/KML files in an offline map app if helpful. They support the same Park and walk stop.',
    'If your arrival time changes, reply to this email before you travel.',
    `Questions? Reply to this email or call/WhatsApp ${SUPPORT_PHONE_DISPLAY}.`,
    'Drift & Dwells'
  ];
}

function wrapFragment(paragraphs) {
  return `<section lang="en">\n${paragraphsToHtml(paragraphs)}\n</section>`;
}

/**
 * @param {'confirmation'|'arrival'} purpose
 */
async function composeArrivalGuestEmail({ booking, purpose }) {
  if (!booking) {
    return { ok: false, code: 'booking_missing', message: 'Booking is required' };
  }
  if (purpose !== 'confirmation' && purpose !== 'arrival') {
    return { ok: false, code: 'invalid_purpose', message: 'purpose must be confirmation or arrival' };
  }

  const guestFirstName = (booking.guestInfo?.firstName && String(booking.guestInfo.firstName).trim()) || 'Guest';
  const checkInDate = formatStayDate(booking.checkIn);
  const checkOutDate = formatStayDate(booking.checkOut);
  if (!checkInDate || !checkOutDate) {
    return { ok: false, code: 'invalid_dates', message: 'Booking check-in/out dates are invalid' };
  }

  const stay = await resolveArrivalStayContext(booking);
  if (!stay.ok) {
    return stay;
  }

  const checkout = resolveGuestCheckoutDisplay(booking);
  const checkoutTime = checkout.time;

  let paragraphs;
  let subject;
  let templateKey;

  if (stay.propertyKind === 'valley') {
    templateKey = purpose === 'confirmation' ? 'booking_confirmed_valley_prep' : 'arrival_3d_the_valley';
    if (purpose === 'confirmation') {
      subject = `Booking confirmed — ${stay.propertyName} (${checkInDate})`;
      paragraphs = buildValleyConfirmationParagraphs({
        guestFirstName,
        propertyName: stay.propertyName,
        checkInDate,
        checkOutDate,
        valleyStayFamily: stay.valleyStayFamily,
        checkoutTime
      });
    } else {
      subject = `Your arrival to The Valley — ${checkInDate}`;
      paragraphs = buildValleyArrivalParagraphs({
        guestFirstName,
        propertyName: stay.propertyName,
        checkInDate,
        checkOutDate,
        valleyStayFamily: stay.valleyStayFamily,
        checkoutTime
      });
    }
  } else if (stay.propertyKind === 'cabin') {
    templateKey = purpose === 'confirmation' ? 'booking_confirmed_cabin_prep' : 'arrival_3d_the_cabin';
    if (purpose === 'confirmation') {
      subject = `Booking confirmed — The Cabin (${checkInDate})`;
      paragraphs = buildCabinConfirmationParagraphs({
        guestFirstName,
        checkInDate,
        checkOutDate,
        checkoutTime
      });
    } else {
      subject = `Your arrival to The Cabin — ${checkInDate}`;
      paragraphs = buildCabinArrivalParagraphs({
        guestFirstName,
        checkInDate,
        checkOutDate,
        checkoutTime
      });
    }
  } else {
    return { ok: false, code: 'unsupported_property_kind', message: `Unsupported propertyKind ${stay.propertyKind}` };
  }

  const fragmentHtml = wrapFragment(paragraphs);
  const text = paragraphsToText(paragraphs);
  const html = renderGmaEmailHtml({
    audience: 'guest',
    subject,
    fragmentHtml,
    propertyName: stay.propertyName
  });

  return {
    ok: true,
    subject,
    html,
    text,
    fragmentHtml,
    templateKey,
    templateVersion: 1,
    propertyKind: stay.propertyKind,
    propertyName: stay.propertyName,
    valleyStayFamily: stay.valleyStayFamily,
    staySlug: stay.staySlug,
    checkoutTime,
    checkoutSource: checkout.source,
    isLateCheckout: checkout.isLateCheckout
  };
}

module.exports = {
  composeArrivalGuestEmail,
  buildValleyConfirmationParagraphs,
  buildCabinConfirmationParagraphs,
  buildValleyArrivalParagraphs,
  buildCabinArrivalParagraphs,
  valleyFacilitiesLines,
  paragraphsToHtml,
  paragraphsToText
};
