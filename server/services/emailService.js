const nodemailer = require('nodemailer');
const { formatSofiaDisplayDate } = require('../utils/dateTime');
const { resolveGuideUrl, isPdfUrl } = require('../utils/arrivalGuideUrl');
const { htmlEscape } = require('../utils/htmlEscape');
const {
  BRAND_SAGE,
  buildDetailRowsTable,
  buildGuestTransactionalHtml,
  buildInternalNotificationHtml,
  GUEST_LIFECYCLE_RECEIVED_EXTRA_CSS,
  GUEST_LIFECYCLE_CONFIRMED_EXTRA_CSS,
  GUEST_LIFECYCLE_CANCELLED_EXTRA_CSS,
  INTERNAL_NOTIFICATION_EXTRA_CSS
} = require('./emailTemplates/guestLifecycleLayout');

const SUPPORT_CONTACT_EMAIL = process.env.CONTACT_EMAIL || 'jose@driftdwells.com';

const EMAIL_SITE_ORIGIN = (process.env.APP_URL || 'https://driftdwells.com').replace(/\/$/, '');
const INSTAGRAM_URL = (process.env.INSTAGRAM_URL || 'https://www.instagram.com/driftdwells/').trim();
const FACEBOOK_URL = (
  process.env.FACEBOOK_URL || 'https://www.facebook.com/profile.php?id=61569960933269'
).trim();

function isLocalOrUnroutableOrigin(origin) {
  try {
    const u = new URL(origin);
    const h = u.hostname.toLowerCase();
    if (u.protocol === 'file:') return true;
    return (
      h === 'localhost' ||
      h === '127.0.0.1' ||
      h === '0.0.0.0' ||
      h === '[::1]' ||
      h.endsWith('.local')
    );
  } catch {
    return true;
  }
}

function upgradeToHttpsIfRemote(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'http:' && !isLocalOrUnroutableOrigin(url)) {
      u.protocol = 'https:';
      return u.href;
    }
  } catch {
    return url;
  }
  return url;
}

/**
 * Absolute URL for `<img src>` in lifecycle email HTML.
 * Uses EMAIL_BRAND_LOGO_URL when set; else joins EMAIL_BRAND_LOGO_PATH to a public origin.
 * When APP_URL points at localhost (typical dev), uses EMAIL_PUBLIC_ASSET_ORIGIN or EMAIL_LOGO_FALLBACK_ORIGIN
 * so previews and mail clients load a real HTTPS asset instead of a broken localhost URL.
 */
function resolveBrandLogoAbsoluteUrl() {
  const disable = process.env.EMAIL_BRAND_LOGO_DISABLE;
  if (disable === '1' || disable === 'true' || disable === 'yes') {
    return '';
  }
  const explicit = (process.env.EMAIL_BRAND_LOGO_URL || '').trim();
  if (explicit === '0' || explicit.toLowerCase() === 'off' || explicit.toLowerCase() === 'false') {
    return '';
  }
  if (explicit.startsWith('https://')) {
    return explicit;
  }
  if (explicit.startsWith('http://')) {
    return upgradeToHttpsIfRemote(explicit);
  }

  const path = (process.env.EMAIL_BRAND_LOGO_PATH || '/uploads/Logo/DRIFTS-01.png').trim();
  const normalized = path.startsWith('/') ? path : `/${path}`;

  const publicOrigin = (process.env.EMAIL_PUBLIC_ASSET_ORIGIN || '').trim().replace(/\/$/, '');
  if (publicOrigin.startsWith('https://') || publicOrigin.startsWith('http://')) {
    return `${upgradeToHttpsIfRemote(publicOrigin)}${normalized}`;
  }

  const fallbackOrigin = (process.env.EMAIL_LOGO_FALLBACK_ORIGIN || 'https://driftdwells.com')
    .trim()
    .replace(/\/$/, '');

  if (isLocalOrUnroutableOrigin(EMAIL_SITE_ORIGIN)) {
    return `${fallbackOrigin}${normalized}`;
  }

  let origin = EMAIL_SITE_ORIGIN;
  try {
    const u = new URL(origin);
    if (u.protocol === 'http:') {
      origin = upgradeToHttpsIfRemote(origin);
    }
  } catch {
    return `${fallbackOrigin}${normalized}`;
  }
  return `${String(origin).replace(/\/$/, '')}${normalized}`;
}

function copyrightYear() {
  return new Date().getFullYear();
}

function guestEmailFooterHtml() {
  const terms = `${EMAIL_SITE_ORIGIN}/terms`;
  const privacy = `${EMAIL_SITE_ORIGIN}/privacy`;
  const y = copyrightYear();
  return `
          <div class="footer">
            <p class="footer-tagline">Off-grid eco-retreat · Bulgaria</p>
            <p class="footer-home"><a href="${htmlEscape(EMAIL_SITE_ORIGIN)}">driftdwells.com</a></p>
            <p><a href="${htmlEscape(terms)}">Terms</a> · <a href="${htmlEscape(privacy)}">Privacy</a> · <a href="${htmlEscape(INSTAGRAM_URL)}">Instagram</a> · <a href="${htmlEscape(FACEBOOK_URL)}">Facebook</a></p>
            <p class="footer-legal">© ${y} Drift &amp; Dwells</p>
          </div>`;
}

function guestEmailFooterText() {
  return `driftdwells.com · Off-grid eco-retreat · Bulgaria
Terms: ${EMAIL_SITE_ORIGIN}/terms
Privacy: ${EMAIL_SITE_ORIGIN}/privacy
Instagram: ${INSTAGRAM_URL}
Facebook: ${FACEBOOK_URL}`;
}

function internalEmailSocialFooterHtml() {
  const y = copyrightYear();
  return `
          <div class="footer">
            <p class="footer-legal">© ${y} Drift &amp; Dwells. Internal notification.</p>
            <p><a href="${htmlEscape(INSTAGRAM_URL)}">Instagram</a> | <a href="${htmlEscape(FACEBOOK_URL)}">Facebook</a></p>
          </div>`;
}

const sentEvents = new Map();
const EVENT_TTL_MS = 10 * 60 * 1000;

function isEmailDeliveryRequired() {
  return process.env.EMAIL_DELIVERY_REQUIRED === '1' || process.env.EMAIL_DELIVERY_REQUIRED === 'true';
}

function parseBooleanEnv(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes') return true;
  if (normalized === '0' || normalized === 'false' || normalized === 'no') return false;
  return fallback;
}

function buildSmtpTransportConfig() {
  const smtpHost = (process.env.SMTP_HOST || '').trim();
  const tlsServername = (process.env.SMTP_TLS_SERVERNAME || '').trim();

  if (smtpHost) {
    const smtpPort = Number.parseInt(process.env.SMTP_PORT || '587', 10);
    const secure = parseBooleanEnv(process.env.SMTP_SECURE, smtpPort === 465);
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    const config = {
      host: smtpHost,
      port: Number.isFinite(smtpPort) ? smtpPort : 587,
      secure
    };
    if (smtpUser || smtpPass) {
      config.auth = { user: smtpUser || '', pass: smtpPass || '' };
    }
    if (tlsServername) {
      config.tls = { servername: tlsServername };
    }
    return { config, source: 'SMTP_HOST' };
  }

  const smtpUrl = (process.env.SMTP_URL || '').trim();
  if (!smtpUrl) return null;

  const config = { url: smtpUrl };
  if (tlsServername) {
    config.tls = { servername: tlsServername };
  }
  return { config, source: 'SMTP_URL' };
}

function cleanupSentEvents() {
  const now = Date.now();
  for (const [k, t] of sentEvents) {
    if (now - t >= EVENT_TTL_MS) sentEvents.delete(k);
  }
}

const _cleanupInterval = setInterval(cleanupSentEvents, EVENT_TTL_MS);
if (_cleanupInterval.unref) _cleanupInterval.unref();

function markAndCheckEventRecentlySent(key) {
  const now = Date.now();
  const prev = sentEvents.get(key);
  if (prev && now - prev < EVENT_TTL_MS) return true;
  sentEvents.set(key, now);
  return false;
}

class EmailService {
  constructor() {
    this.transporter = null;
    this.isConfigured = false;
    this.lastInitError = null;
    this.initPromise = this.init();
  }

  async init() {
    const transportConfig = buildSmtpTransportConfig();

    if (!transportConfig) {
      this.lastInitError = 'SMTP transport not configured';
      if (isEmailDeliveryRequired()) {
        console.error('📧 EMAIL DELIVERY REQUIRED but SMTP transport is missing');
      } else {
        console.log('📧 SMTP transport not configured - emails will be logged instead of sent');
      }
      return;
    }

    try {
      this.transporter = nodemailer.createTransport(transportConfig.config);
      this.isConfigured = true;
      this.lastInitError = null;
      console.log(`📧 Email service configured with SMTP (${transportConfig.source})`);
      if (process.env.NODE_ENV === 'production') {
        try {
          await this.transporter.verify();
          console.log('📧 Email transporter verified');
        } catch (verifyErr) {
          console.error('📧 Email transporter verification failed:', verifyErr.message);
          this.transporter = null;
          this.isConfigured = false;
          this.lastInitError = verifyErr.message || 'SMTP verify failed';
          if (isEmailDeliveryRequired()) {
            console.error('📧 EMAIL DELIVERY REQUIRED and transporter verification failed');
          }
        }
      }
    } catch (error) {
      console.error('📧 Failed to configure email service:', error.message);
      this.lastInitError = error.message || 'SMTP transport init failed';
    }
  }

  async sendEmail({ to, subject, html, text, trigger, bookingId, skipIdempotencyWindow = false }) {
    if (this.initPromise) {
      await this.initPromise;
    }

    // Idempotency: avoid duplicate sends for same booking+event in short window (bypassed for explicit manual resends)
    if (!skipIdempotencyWindow && bookingId && trigger) {
      const key = `${bookingId}:${trigger}`;
      if (markAndCheckEventRecentlySent(key)) {
        console.log('📧 Skipping duplicate email (idempotency):', { bookingId, trigger });
        return { success: true, method: 'skipped-duplicate' };
      }
    }
    const emailData = {
      from: process.env.EMAIL_FROM || 'Drift & Dwells <bookings@driftdwells.com>',
      to,
      subject,
      html,
      text,
      trigger,
      bookingId,
      timestamp: new Date().toISOString()
    };

    if (!this.isConfigured || !this.transporter) {
      const missingTransportError = this.lastInitError || 'SMTP transport unavailable';
      if (isEmailDeliveryRequired()) {
        console.error('📧 Required email delivery failed before send:', {
          trigger,
          bookingId,
          to,
          error: missingTransportError
        });
        return { success: false, method: 'unavailable', error: missingTransportError };
      }
      console.log('📧 EMAIL LOG:', JSON.stringify(emailData, null, 2));
      return { success: true, method: 'logged' };
    }

    try {
      const mailOptions = {
        from: emailData.from,
        to: emailData.to,
        subject: emailData.subject,
        html: emailData.html,
        text: emailData.text
      };

      // Add Postmark tags and metadata for webhook tracking
      if (emailData.bookingId) {
        mailOptions.headers = {
          'X-PM-Tag': `booking:${emailData.bookingId}`,
          'X-PM-Metadata': JSON.stringify({ 
            bookingId: emailData.bookingId,
            trigger: emailData.trigger 
          })
        };
      }

      const info = await this.transporter.sendMail(mailOptions);

      console.log('📧 Email sent successfully:', {
        messageId: info.messageId,
        trigger,
        bookingId,
        to
      });

      return { success: true, method: 'sent', messageId: info.messageId };
    } catch (error) {
      console.error('📧 Failed to send email:', {
        error: error.message,
        trigger,
        bookingId,
        to
      });

      if (isEmailDeliveryRequired()) {
        return { success: false, method: 'failed', error: error.message };
      }
      console.log('📧 EMAIL LOG (failed to send):', JSON.stringify(emailData, null, 2));
      return { success: false, method: 'logged', error: error.message };
    }
  }

  generateBookingReceivedEmail(booking, cabin) {
    const checkIn = new Date(booking.checkIn);
    const checkOut = new Date(booking.checkOut);
    const nights = Math.ceil((checkOut - checkIn) / (1000 * 3600 * 24));

    const FALLBACK_STAY_ENTITY = {
      name: 'Your stay',
      location: '',
      arrivalWindowDefault: '',
      meetingPoint: undefined,
      packingList: [],
      arrivalGuideUrl: '',
      safetyNotes: '',
      emergencyContact: ''
    };
    let stay;
    if (cabin != null && typeof cabin === 'object') {
      stay = cabin;
    } else {
      console.warn('[email] generateBookingReceivedEmail: missing cabin/cabinType entity; using placeholder', {
        bookingId: booking?._id != null ? String(booking._id) : undefined
      });
      stay = FALLBACK_STAY_ENTITY;
    }

    const bookingDetailRows = [
      { label: 'Cabin', valueHtml: `${htmlEscape(stay.name)} • ${htmlEscape(stay.location)}` },
      {
        label: 'Check-in',
        valueHtml: `${htmlEscape(formatSofiaDisplayDate(checkIn, 'en-GB'))} (${htmlEscape(stay.arrivalWindowDefault || 'TBD')})`
      },
      { label: 'Check-out', valueHtml: htmlEscape(formatSofiaDisplayDate(checkOut, 'en-GB')) },
      {
        label: 'Duration',
        valueHtml: htmlEscape(`${nights} night${nights !== 1 ? 's' : ''}`)
      },
      {
        label: 'Guests',
        valueHtml: htmlEscape(
          `${booking.adults} adult${booking.adults !== 1 ? 's' : ''}${
            booking.children > 0
              ? `, ${booking.children} child${booking.children !== 1 ? 'ren' : ''}`
              : ''
          }`
        )
      },
      { label: 'Trip type', valueHtml: htmlEscape(booking.tripType || 'Custom Experience') }
    ];
    if (booking.transportMethod && booking.transportMethod !== 'Not selected') {
      bookingDetailRows.push({ label: 'Transport', valueHtml: htmlEscape(booking.transportMethod) });
    }
    bookingDetailRows.push({
      label: 'Total',
      valueHtml: `<span class="total-accent">€${htmlEscape(String(booking.totalPrice))}</span>`
    });
    const receivedDetailsTable = buildDetailRowsTable(bookingDetailRows);

    const bodyHtml = `
            <h2 class="email-heading">Hello ${htmlEscape(booking.guestInfo?.firstName)}</h2>
            <p class="lede">Thank you for choosing Drift &amp; Dwells. We've received your booking request and will confirm your stay as soon as we can—usually within 24 hours. This email is not a final confirmation yet.</p>

            <div class="booking-details">
              <h3>Your request</h3>
              ${receivedDetailsTable}
            </div>

            ${stay.meetingPoint?.googleMapsUrl ? `
            <div class="guidance-section">
              <h3>Directions</h3>
              <p><strong>Meeting point:</strong> ${htmlEscape(stay.meetingPoint.label || stay.location)}</p>
              <a href="${stay.meetingPoint.googleMapsUrl}" class="btn btn-brand" target="_blank" rel="noopener noreferrer">Open in Google Maps</a>
              ${stay.meetingPoint.what3words ? `<a href="https://what3words.com/${stay.meetingPoint.what3words}" class="btn btn-brand" target="_blank" rel="noopener noreferrer">///${stay.meetingPoint.what3words}</a>` : ''}
              ${stay.meetingPoint.lat && stay.meetingPoint.lng ? `<p style="margin: 10px 0 0; font-family: ui-monospace, monospace; background: #fff; padding: 8px 10px; border-radius: 6px; font-size: 14px;">GPS: ${stay.meetingPoint.lat}, ${stay.meetingPoint.lng}</p>` : ''}
            </div>
            ` : ''}

            ${stay.packingList && stay.packingList.length > 0 ? `
            <div class="packing-list">
              <h3>Packing list</h3>
              <ul>
                ${stay.packingList.slice(0, 5).map(item => `<li>${htmlEscape(item)}</li>`).join('')}
                ${stay.packingList.length > 5 ? `<li><em>... and ${stay.packingList.length - 5} more items</em></li>` : ''}
              </ul>
              ${stay.packingList.length > 5 ? '<p><em>See full packing list in your booking confirmation email.</em></p>' : ''}
            </div>
            ` : ''}

            ${stay.location && (stay.location.toLowerCase().includes('valley') || stay.location.toLowerCase().includes('the valley')) ? `
            <div class="guidance-section valley">
              <h3>Welcome guide</h3>
              <p>Use your trip guide to complete checklists, choose your arrival route, and prepare for The Valley.</p>
              <a href="${process.env.APP_URL || 'http://localhost:5173'}/my-trip/${booking._id}/valley-guide" class="btn btn-secondary" target="_blank" rel="noopener noreferrer">Open welcome guide</a>
              <p style="margin-top: 10px; font-size: 14px; color: #5a5a54;">Please complete your trip checklist at least 24 hours before arrival.</p>
            </div>
            ` : ''}

            ${stay.arrivalGuideUrl ? `
            <div class="guidance-section">
              <h3>Arrival guide</h3>
              <p>Open practical route and arrival instructions (save offline before travel):</p>
              <a href="${resolveGuideUrl(stay.arrivalGuideUrl, process.env.APP_URL)}" class="btn btn-brand" target="_blank" rel="noopener noreferrer">${isPdfUrl(stay.arrivalGuideUrl) ? 'Download PDF guide' : 'Open arrival guide'}</a>
            </div>
            ` : ''}

            ${stay.safetyNotes ? `
            <div class="safety-notes">
              <h3>Safety &amp; house rules</h3>
              <p>${htmlEscape(stay.safetyNotes)}</p>
            </div>
            ` : ''}

            ${stay.emergencyContact ? `
            <div class="contact-info">
              <h3>Emergency contact</h3>
              <p><strong>${htmlEscape(stay.emergencyContact)}</strong></p>
            </div>
            ` : ''}

            <div class="guidance-section">
              <h3>Payment</h3>
              <p>If your booking is confirmed, <strong>€${booking.totalPrice}</strong> is due on arrival unless we tell you otherwise. We accept cash and major cards.</p>
            </div>

            <p style="margin-top: 26px;">Once your stay is confirmed, we'll follow up with a confirmation email. Closer to your dates, we'll send practical arrival instructions.</p>

            <p>Questions? Reply to this email or write to ${htmlEscape(SUPPORT_CONTACT_EMAIL)}.</p>

            <p>With warm regards,<br>The Drift &amp; Dwells team</p>
    `;

    const html = buildGuestTransactionalHtml({
      title: 'Booking request received — Drift & Dwells',
      preheader: `We received your request for ${htmlEscape(stay.name)} — check-in ${formatSofiaDisplayDate(checkIn, 'en-GB')}`,
      logoUrl: resolveBrandLogoAbsoluteUrl(),
      siteHomeUrl: EMAIL_SITE_ORIGIN,
      headerAccentColor: BRAND_SAGE,
      headerLogoWidth: 208,
      headerTagline:
        '<span class="email-kicker">Request received</span><span class="email-tagline-lead">We will confirm your stay by email.</span>',
      bodyHtml,
      extraHeadCss: GUEST_LIFECYCLE_RECEIVED_EXTRA_CSS,
      footerHtml: guestEmailFooterHtml()
    });

    const text = `
Drift & Dwells — Booking request received

Hello ${booking.guestInfo.firstName},

Thank you for choosing Drift & Dwells. We've received your booking request (this is not a final confirmation yet). We usually confirm within 24 hours.

YOUR REQUEST:
- Cabin: ${stay.name} • ${stay.location}
- Check-in: ${formatSofiaDisplayDate(checkIn, 'en-GB')} (${stay.arrivalWindowDefault || 'TBD'})
- Check-out: ${formatSofiaDisplayDate(checkOut, 'en-GB')}
- Duration: ${nights} night${nights !== 1 ? 's' : ''}
- Guests: ${booking.adults} adult${booking.adults !== 1 ? 's' : ''}${booking.children > 0 ? `, ${booking.children} child${booking.children !== 1 ? 'ren' : ''}` : ''}
- Trip Type: ${booking.tripType || 'Custom Experience'}
${booking.transportMethod && booking.transportMethod !== 'Not selected' ? `- Transport: ${booking.transportMethod}` : ''}
- Total: €${booking.totalPrice}

${stay.meetingPoint?.googleMapsUrl ? `
DIRECTIONS:
Meeting Point: ${stay.meetingPoint.label || stay.location}
Google Maps: ${stay.meetingPoint.googleMapsUrl}
${stay.meetingPoint.what3words ? `What3Words: ///${stay.meetingPoint.what3words}` : ''}
${stay.meetingPoint.lat && stay.meetingPoint.lng ? `GPS: ${stay.meetingPoint.lat}, ${stay.meetingPoint.lng}` : ''}
` : ''}

${stay.packingList && stay.packingList.length > 0 ? `
PACKING LIST:
${stay.packingList.slice(0, 5).map(item => `- ${item}`).join('\n')}
${stay.packingList.length > 5 ? `... and ${stay.packingList.length - 5} more items` : ''}
` : ''}

${stay.location && (stay.location.toLowerCase().includes('valley') || stay.location.toLowerCase().includes('the valley')) ? `
INTERACTIVE WELCOME GUIDE:
Open your trip guide: ${process.env.APP_URL || 'http://localhost:5173'}/my-trip/${booking._id}/valley-guide
Complete your trip checklist 24 hours before arrival.
` : ''}

${stay.arrivalGuideUrl ? `
ARRIVAL GUIDE: ${resolveGuideUrl(stay.arrivalGuideUrl, process.env.APP_URL)}
` : ''}

${stay.safetyNotes ? `
SAFETY & HOUSE RULES:
${stay.safetyNotes}
` : ''}

${stay.emergencyContact ? `
EMERGENCY CONTACT: ${stay.emergencyContact}
` : ''}

PAYMENT: If confirmed, €${booking.totalPrice} is due on arrival unless we tell you otherwise (cash or major cards).

Once your stay is confirmed, we'll email you again. Closer to your trip, we'll send arrival instructions.

Questions? ${SUPPORT_CONTACT_EMAIL}

Warm regards,
The Drift & Dwells team

${guestEmailFooterText()}
    `;

    return {
      subject: `Booking request received — ${stay.name} (${formatSofiaDisplayDate(checkIn, 'en-GB')})`,
      html,
      text
    };
  }

  generateBookingConfirmedEmail(booking, cabin) {
    const checkIn = new Date(booking.checkIn);
    const checkOut = new Date(booking.checkOut);
    const nights = Math.ceil((checkOut - checkIn) / (1000 * 3600 * 24));

    const confirmedDetailRows = [
      { label: 'Cabin', valueHtml: `${htmlEscape(cabin.name)} • ${htmlEscape(cabin.location)}` },
      {
        label: 'Check-in',
        valueHtml: `${htmlEscape(formatSofiaDisplayDate(checkIn, 'en-GB'))} (${htmlEscape(cabin.arrivalWindowDefault || 'TBD')})`
      },
      { label: 'Check-out', valueHtml: htmlEscape(formatSofiaDisplayDate(checkOut, 'en-GB')) },
      {
        label: 'Duration',
        valueHtml: htmlEscape(`${nights} night${nights !== 1 ? 's' : ''}`)
      },
      {
        label: 'Total',
        valueHtml: `<span class="total-accent">€${htmlEscape(String(booking.totalPrice))}</span>`
      }
    ];
    const confirmedDetailsTable = buildDetailRowsTable(confirmedDetailRows);

    const bodyHtml = `
            <div class="confirmed-badge" role="status">Booking confirmed</div>

            <h2 class="email-heading">Hello ${htmlEscape(booking.guestInfo?.firstName)}</h2>
            <p class="lede">Your stay at <strong>${htmlEscape(cabin.name)}</strong> is confirmed. We're glad you'll be with us for a quiet off-grid retreat.</p>

            <div class="booking-details">
              <h3>Confirmed stay</h3>
              ${confirmedDetailsTable}
            </div>

            <p>We'll send practical arrival instructions and local notes a few days before you travel.</p>

            <p>Reply to this email any time if you have questions or special requests.</p>

            <p>We look forward to hosting you.</p>

            <p>With warm regards,<br>The Drift &amp; Dwells team</p>
    `;

    const html = buildGuestTransactionalHtml({
      title: 'Booking confirmed — Drift & Dwells',
      preheader: `You're confirmed for ${htmlEscape(cabin.name)} — check-in ${formatSofiaDisplayDate(checkIn, 'en-GB')}`,
      logoUrl: resolveBrandLogoAbsoluteUrl(),
      siteHomeUrl: EMAIL_SITE_ORIGIN,
      headerAccentColor: '#6d8f75',
      headerLogoWidth: 208,
      headerTagline:
        '<span class="email-kicker">Confirmed</span><span class="email-tagline-lead">Your stay is on our calendar.</span>',
      bodyHtml,
      extraHeadCss: GUEST_LIFECYCLE_CONFIRMED_EXTRA_CSS,
      footerHtml: guestEmailFooterHtml()
    });

    const text = `
Drift & Dwells — Booking confirmed

BOOKING CONFIRMED

Hello ${booking.guestInfo.firstName},

Your stay at ${cabin.name} is confirmed. We're glad you'll be with us for a quiet off-grid retreat.

CONFIRMED STAY:
- Cabin: ${cabin.name} • ${cabin.location}
- Check-in: ${formatSofiaDisplayDate(checkIn, 'en-GB')} (${cabin?.arrivalWindowDefault || 'TBD'})
- Check-out: ${formatSofiaDisplayDate(checkOut, 'en-GB')}
- Duration: ${nights} night${nights !== 1 ? 's' : ''}
- Total: €${booking.totalPrice}

We'll send practical arrival instructions and local notes a few days before you travel.

Questions? Reply to this email or ${SUPPORT_CONTACT_EMAIL}

Warm regards,
The Drift & Dwells team

${guestEmailFooterText()}
    `;

    return {
      subject: `Booking confirmed — ${cabin.name} (${formatSofiaDisplayDate(checkIn, 'en-GB')})`,
      html,
      text
    };
  }

  generateBookingCancelledEmail(booking, cabin) {
    const checkIn = new Date(booking.checkIn);
    const checkOut = new Date(booking.checkOut);

    const cancelledDetailRows = [
      { label: 'Cabin', valueHtml: `${htmlEscape(cabin.name)} • ${htmlEscape(cabin.location)}` },
      { label: 'Check-in', valueHtml: htmlEscape(formatSofiaDisplayDate(checkIn, 'en-GB')) },
      { label: 'Check-out', valueHtml: htmlEscape(formatSofiaDisplayDate(checkOut, 'en-GB')) },
      { label: 'Total', valueHtml: htmlEscape(`€${booking.totalPrice}`) }
    ];
    const cancelledDetailsTable = buildDetailRowsTable(cancelledDetailRows);

    const bodyHtml = `
            <div class="cancelled-badge" role="status">Booking cancelled</div>

            <h2 class="email-heading">Hello ${htmlEscape(booking.guestInfo?.firstName)}</h2>
            <p class="lede">Your booking for <strong>${htmlEscape(cabin.name)}</strong> has been cancelled. If you were not expecting this, please reach out—we're here to help.</p>

            <div class="booking-details">
              <h3>Cancelled stay</h3>
              ${cancelledDetailsTable}
            </div>

            <p>If you have questions about this cancellation or would like to plan another visit, reply to this email or contact ${htmlEscape(SUPPORT_CONTACT_EMAIL)}.</p>

            <p>We would be glad to host you another time.</p>

            <p>With warm regards,<br>The Drift &amp; Dwells team</p>
    `;

    const html = buildGuestTransactionalHtml({
      title: 'Booking cancelled — Drift & Dwells',
      preheader: `Your stay at ${htmlEscape(cabin.name)} was cancelled — we're here if you need us`,
      logoUrl: resolveBrandLogoAbsoluteUrl(),
      siteHomeUrl: EMAIL_SITE_ORIGIN,
      headerAccentColor: '#a67c7c',
      headerLogoWidth: 208,
      headerTagline:
        '<span class="email-kicker">Cancelled</span><span class="email-tagline-lead">This stay will not go ahead.</span>',
      bodyHtml,
      extraHeadCss: GUEST_LIFECYCLE_CANCELLED_EXTRA_CSS,
      footerHtml: guestEmailFooterHtml()
    });

    const text = `
Drift & Dwells — Booking cancelled

BOOKING CANCELLED

Hello ${booking.guestInfo.firstName},

Your booking for ${cabin.name} has been cancelled. If you were not expecting this, please contact us.

CANCELLED STAY:
- Cabin: ${cabin.name} • ${cabin.location}
- Check-in: ${formatSofiaDisplayDate(checkIn, 'en-GB')}
- Check-out: ${formatSofiaDisplayDate(checkOut, 'en-GB')}
- Total: €${booking.totalPrice}

If you have questions or would like to plan another visit: ${SUPPORT_CONTACT_EMAIL}

Warm regards,
The Drift & Dwells team

${guestEmailFooterText()}
    `;

    return {
      subject: `Booking cancelled — ${cabin.name} (${formatSofiaDisplayDate(checkIn, 'en-GB')})`,
      html,
      text
    };
  }

  generateInternalNotificationEmail(booking, cabin) {
    const checkIn = new Date(booking.checkIn);
    const checkOut = new Date(booking.checkOut);
    const nights = Math.ceil((checkOut - checkIn) / (1000 * 3600 * 24));

    const internalDetailRows = [
      { label: 'Booking ID', valueHtml: htmlEscape(String(booking._id)) },
      { label: 'Cabin', valueHtml: `${htmlEscape(cabin.name)} • ${htmlEscape(cabin.location)}` },
      { label: 'Check-in', valueHtml: htmlEscape(formatSofiaDisplayDate(checkIn, 'en-GB')) },
      { label: 'Check-out', valueHtml: htmlEscape(formatSofiaDisplayDate(checkOut, 'en-GB')) },
      {
        label: 'Duration',
        valueHtml: htmlEscape(`${nights} night${nights !== 1 ? 's' : ''}`)
      },
      {
        label: 'Guest',
        valueHtml: `${htmlEscape(booking.guestInfo?.firstName)} ${htmlEscape(booking.guestInfo?.lastName)}`
      },
      { label: 'Email', valueHtml: htmlEscape(booking.guestInfo?.email) },
      { label: 'Phone', valueHtml: htmlEscape(booking.guestInfo?.phone || '—') },
      {
        label: 'Party',
        valueHtml: htmlEscape(
          `${booking.adults} adult${booking.adults !== 1 ? 's' : ''}${
            booking.children > 0
              ? `, ${booking.children} child${booking.children !== 1 ? 'ren' : ''}`
              : ''
          }`
        )
      },
      { label: 'Trip type', valueHtml: htmlEscape(booking.tripType || 'Custom Experience') }
    ];
    if (booking.transportMethod && booking.transportMethod !== 'Not selected') {
      internalDetailRows.push({ label: 'Transport', valueHtml: htmlEscape(booking.transportMethod) });
    }
    internalDetailRows.push({
      label: 'Total',
      valueHtml: `<span style="font-weight:700;font-size:17px;color:${BRAND_SAGE};">€${htmlEscape(String(booking.totalPrice))}</span>`
    });
    if (booking.specialRequests) {
      internalDetailRows.push({
        label: 'Special requests',
        valueHtml: htmlEscape(booking.specialRequests)
      });
    }
    const internalDetailsTable = buildDetailRowsTable(internalDetailRows);

    const bodyHtml = `
            <div class="new-badge">New booking</div>

            <h2 class="email-heading">New booking received</h2>
            <p>A guest booking has been submitted and may need your review.</p>

            <div class="booking-details">
              <h3>Reservation snapshot</h3>
              ${internalDetailsTable}
            </div>

            <p><strong>Status:</strong> ${htmlEscape(booking.status)}</p>

            <p>Please review and confirm this booking in the admin panel.</p>
    `;

    const html = buildInternalNotificationHtml({
      title: 'New booking — Drift & Dwells Admin',
      preheader: `New booking: ${htmlEscape(cabin.name)} — ${htmlEscape(booking.guestInfo?.email || '')}`,
      logoUrl: resolveBrandLogoAbsoluteUrl(),
      siteHomeUrl: EMAIL_SITE_ORIGIN,
      headerAccentColor: '#b0aea6',
      headerLogoWidth: 160,
      headerTagline:
        '<span class="email-kicker">Inbox</span><span class="email-tagline-lead">Review when you are ready.</span>',
      bodyHtml,
      extraHeadCss: INTERNAL_NOTIFICATION_EXTRA_CSS,
      footerHtml: internalEmailSocialFooterHtml()
    });

    const text = `
Drift & Dwells Admin — New booking

NEW BOOKING

A guest booking has been submitted and may need your review.

BOOKING DETAILS:
- Booking ID: ${booking._id}
- Cabin: ${cabin.name} • ${cabin.location}
- Check-in: ${formatSofiaDisplayDate(checkIn, 'en-GB')}
- Check-out: ${formatSofiaDisplayDate(checkOut, 'en-GB')}
- Duration: ${nights} night${nights !== 1 ? 's' : ''}
- Guest: ${booking.guestInfo.firstName} ${booking.guestInfo.lastName}
- Email: ${booking.guestInfo.email}
- Phone: ${booking.guestInfo.phone}
- Guests: ${booking.adults} adult${booking.adults !== 1 ? 's' : ''}${booking.children > 0 ? `, ${booking.children} child${booking.children !== 1 ? 'ren' : ''}` : ''}
- Trip Type: ${booking.tripType || 'Custom Experience'}
${booking.transportMethod && booking.transportMethod !== 'Not selected' ? `- Transport: ${booking.transportMethod}` : ''}
- Total: €${booking.totalPrice}
${booking.specialRequests ? `- Special Requests: ${booking.specialRequests}` : ''}

Status: ${booking.status}

Please review and confirm this booking in the admin panel.

Instagram: ${INSTAGRAM_URL}
Facebook: ${FACEBOOK_URL}
    `;

    return {
      subject: `New Booking - ${cabin.name} (${booking.guestInfo.firstName} ${booking.guestInfo.lastName})`,
      html,
      text
    };
  }
}

module.exports = new EmailService();

