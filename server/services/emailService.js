const nodemailer = require('nodemailer');
const { resolveGuideUrl, isPdfUrl } = require('../utils/arrivalGuideUrl');
const { htmlEscape } = require('../utils/htmlEscape');
const {
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

function copyrightYear() {
  return new Date().getFullYear();
}

function guestEmailFooterHtml() {
  const terms = `${EMAIL_SITE_ORIGIN}/terms`;
  const privacy = `${EMAIL_SITE_ORIGIN}/privacy`;
  const y = copyrightYear();
  return `
          <div class="footer">
            <p class="footer-legal">© ${y} Drift &amp; Dwells. All rights reserved.</p>
            <p><a href="${htmlEscape(terms)}">Terms of Service</a> | <a href="${htmlEscape(privacy)}">Privacy Policy</a></p>
            <p><a href="${htmlEscape(INSTAGRAM_URL)}">Instagram</a> | <a href="${htmlEscape(FACEBOOK_URL)}">Facebook</a></p>
          </div>`;
}

function guestEmailFooterText() {
  return `Terms: ${EMAIL_SITE_ORIGIN}/terms
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

    const bodyHtml = `
            <h2>Hello ${htmlEscape(booking.guestInfo?.firstName)}</h2>
            <p class="lede">Thank you for choosing Drift &amp; Dwells. We've received your booking request and will confirm your stay as soon as we can—usually within 24 hours. This email is not a final confirmation yet.</p>

            <div class="booking-details">
              <h3>Your request</h3>
              <div class="detail-row">
                <span class="detail-label">Cabin</span>
                <span>${htmlEscape(stay.name)} • ${htmlEscape(stay.location)}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Check-in</span>
                <span>${checkIn.toLocaleDateString('en-GB')} (${htmlEscape(stay.arrivalWindowDefault || 'TBD')})</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Check-out</span>
                <span>${checkOut.toLocaleDateString('en-GB')}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Duration</span>
                <span>${nights} night${nights !== 1 ? 's' : ''}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Guests</span>
                <span>${booking.adults} adult${booking.adults !== 1 ? 's' : ''}${booking.children > 0 ? `, ${booking.children} child${booking.children !== 1 ? 'ren' : ''}` : ''}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Trip type</span>
                <span>${htmlEscape(booking.tripType || 'Custom Experience')}</span>
              </div>
              ${booking.transportMethod && booking.transportMethod !== 'Not selected' ? `
              <div class="detail-row">
                <span class="detail-label">Transport</span>
                <span>${htmlEscape(booking.transportMethod)}</span>
              </div>
              ` : ''}
              <div class="detail-row">
                <span class="detail-label">Total</span>
                <span class="total-accent">€${booking.totalPrice}</span>
              </div>
            </div>

            ${stay.meetingPoint?.googleMapsUrl ? `
            <div class="guidance-section">
              <h3>Directions</h3>
              <p><strong>Meeting point:</strong> ${htmlEscape(stay.meetingPoint.label || stay.location)}</p>
              <a href="${stay.meetingPoint.googleMapsUrl}" class="btn btn-sage" target="_blank" rel="noopener noreferrer">Open in Google Maps</a>
              ${stay.meetingPoint.what3words ? `<a href="https://what3words.com/${stay.meetingPoint.what3words}" class="btn btn-sage" target="_blank" rel="noopener noreferrer">///${stay.meetingPoint.what3words}</a>` : ''}
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
              <a href="${process.env.APP_URL || 'http://localhost:5173'}/my-trip/${booking._id}/valley-guide" class="btn btn-blue" target="_blank" rel="noopener noreferrer">Open welcome guide</a>
              <p style="margin-top: 10px; font-size: 14px; color: #5a5a54;">Please complete your trip checklist at least 24 hours before arrival.</p>
            </div>
            ` : ''}

            ${stay.arrivalGuideUrl ? `
            <div class="guidance-section">
              <h3>Arrival guide</h3>
              <p>Open practical route and arrival instructions (save offline before travel):</p>
              <a href="${resolveGuideUrl(stay.arrivalGuideUrl, process.env.APP_URL)}" class="btn btn-sage" target="_blank" rel="noopener noreferrer">${isPdfUrl(stay.arrivalGuideUrl) ? 'Download PDF guide' : 'Open arrival guide'}</a>
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
      preheader: `We received your request for ${htmlEscape(stay.name)} — check-in ${checkIn.toLocaleDateString('en-GB')}`,
      headerGradientFrom: '#5c6156',
      headerGradientTo: '#5c6156',
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
- Check-in: ${checkIn.toLocaleDateString('en-GB')} (${stay.arrivalWindowDefault || 'TBD'})
- Check-out: ${checkOut.toLocaleDateString('en-GB')}
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
      subject: `Booking request received — ${stay.name} (${checkIn.toLocaleDateString('en-GB')})`,
      html,
      text
    };
  }

  generateBookingConfirmedEmail(booking, cabin) {
    const checkIn = new Date(booking.checkIn);
    const checkOut = new Date(booking.checkOut);
    const nights = Math.ceil((checkOut - checkIn) / (1000 * 3600 * 24));

    const bodyHtml = `
            <div class="confirmed-badge" role="status">Booking confirmed</div>

            <h2>Hello ${htmlEscape(booking.guestInfo?.firstName)}</h2>
            <p class="lede">Your stay at <strong>${htmlEscape(cabin.name)}</strong> is confirmed. We're glad you'll be with us for a quiet off-grid retreat.</p>

            <div class="booking-details">
              <h3>Confirmed stay</h3>
              <div class="detail-row">
                <span class="detail-label">Cabin</span>
                <span>${htmlEscape(cabin.name)} • ${htmlEscape(cabin.location)}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Check-in</span>
                <span>${checkIn.toLocaleDateString('en-GB')} (${htmlEscape(cabin.arrivalWindowDefault || 'TBD')})</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Check-out</span>
                <span>${checkOut.toLocaleDateString('en-GB')}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Duration</span>
                <span>${nights} night${nights !== 1 ? 's' : ''}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Total</span>
                <span class="total-accent">€${booking.totalPrice}</span>
              </div>
            </div>

            <p>We'll send practical arrival instructions and local notes a few days before you travel.</p>

            <p>Reply to this email any time if you have questions or special requests.</p>

            <p>We look forward to hosting you.</p>

            <p>With warm regards,<br>The Drift &amp; Dwells team</p>
    `;

    const html = buildGuestTransactionalHtml({
      title: 'Booking confirmed — Drift & Dwells',
      preheader: `You're confirmed for ${htmlEscape(cabin.name)} — check-in ${checkIn.toLocaleDateString('en-GB')}`,
      headerGradientFrom: '#4a6b55',
      headerGradientTo: '#4a6b55',
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
- Check-in: ${checkIn.toLocaleDateString('en-GB')} (${cabin?.arrivalWindowDefault || 'TBD'})
- Check-out: ${checkOut.toLocaleDateString('en-GB')}
- Duration: ${nights} night${nights !== 1 ? 's' : ''}
- Total: €${booking.totalPrice}

We'll send practical arrival instructions and local notes a few days before you travel.

Questions? Reply to this email or ${SUPPORT_CONTACT_EMAIL}

Warm regards,
The Drift & Dwells team

${guestEmailFooterText()}
    `;

    return {
      subject: `Booking confirmed — ${cabin.name} (${checkIn.toLocaleDateString('en-GB')})`,
      html,
      text
    };
  }

  generateBookingCancelledEmail(booking, cabin) {
    const checkIn = new Date(booking.checkIn);
    const checkOut = new Date(booking.checkOut);

    const bodyHtml = `
            <div class="cancelled-badge" role="status">Booking cancelled</div>

            <h2>Hello ${htmlEscape(booking.guestInfo?.firstName)}</h2>
            <p class="lede">Your booking for <strong>${htmlEscape(cabin.name)}</strong> has been cancelled. If you were not expecting this, please reach out—we're here to help.</p>

            <div class="booking-details">
              <h3>Cancelled stay</h3>
              <div class="detail-row">
                <span class="detail-label">Cabin</span>
                <span>${htmlEscape(cabin.name)} • ${htmlEscape(cabin.location)}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Check-in</span>
                <span>${checkIn.toLocaleDateString('en-GB')}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Check-out</span>
                <span>${checkOut.toLocaleDateString('en-GB')}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Total</span>
                <span>€${booking.totalPrice}</span>
              </div>
            </div>

            <p>If you have questions about this cancellation or would like to plan another visit, reply to this email or contact ${htmlEscape(SUPPORT_CONTACT_EMAIL)}.</p>

            <p>We would be glad to host you another time.</p>

            <p>With warm regards,<br>The Drift &amp; Dwells team</p>
    `;

    const html = buildGuestTransactionalHtml({
      title: 'Booking cancelled — Drift & Dwells',
      preheader: `Your stay at ${htmlEscape(cabin.name)} was cancelled — we're here if you need us`,
      headerGradientFrom: '#6b4e4e',
      headerGradientTo: '#6b4e4e',
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
- Check-in: ${checkIn.toLocaleDateString('en-GB')}
- Check-out: ${checkOut.toLocaleDateString('en-GB')}
- Total: €${booking.totalPrice}

If you have questions or would like to plan another visit: ${SUPPORT_CONTACT_EMAIL}

Warm regards,
The Drift & Dwells team

${guestEmailFooterText()}
    `;

    return {
      subject: `Booking cancelled — ${cabin.name} (${checkIn.toLocaleDateString('en-GB')})`,
      html,
      text
    };
  }

  generateInternalNotificationEmail(booking, cabin) {
    const checkIn = new Date(booking.checkIn);
    const checkOut = new Date(booking.checkOut);
    const nights = Math.ceil((checkOut - checkIn) / (1000 * 3600 * 24));

    const bodyHtml = `
            <div class="new-badge">New booking</div>

            <h2>New booking received</h2>
            <p>A guest booking has been submitted and may need your review.</p>

            <div class="booking-details">
              <h3>Booking details</h3>
              <div class="detail-row">
                <span class="detail-label">Booking ID</span>
                <span>${booking._id}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Cabin</span>
                <span>${htmlEscape(cabin.name)} • ${htmlEscape(cabin.location)}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Check-in</span>
                <span>${checkIn.toLocaleDateString('en-GB')}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Check-out</span>
                <span>${checkOut.toLocaleDateString('en-GB')}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Duration</span>
                <span>${nights} night${nights !== 1 ? 's' : ''}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Guest</span>
                <span>${htmlEscape(booking.guestInfo?.firstName)} ${htmlEscape(booking.guestInfo?.lastName)}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Email</span>
                <span>${htmlEscape(booking.guestInfo?.email)}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Phone</span>
                <span>${htmlEscape(booking.guestInfo?.phone)}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Guests</span>
                <span>${booking.adults} adult${booking.adults !== 1 ? 's' : ''}${booking.children > 0 ? `, ${booking.children} child${booking.children !== 1 ? 'ren' : ''}` : ''}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Trip type</span>
                <span>${htmlEscape(booking.tripType || 'Custom Experience')}</span>
              </div>
              ${booking.transportMethod && booking.transportMethod !== 'Not selected' ? `
              <div class="detail-row">
                <span class="detail-label">Transport</span>
                <span>${htmlEscape(booking.transportMethod)}</span>
              </div>
              ` : ''}
              <div class="detail-row">
                <span class="detail-label">Total</span>
                <span style="font-weight: 700; font-size: 17px; color: #047857;">€${booking.totalPrice}</span>
              </div>
              ${booking.specialRequests ? `
              <div class="detail-row">
                <span class="detail-label">Special requests</span>
                <span>${htmlEscape(booking.specialRequests)}</span>
              </div>
              ` : ''}
            </div>

            <p><strong>Status:</strong> ${htmlEscape(booking.status)}</p>

            <p>Please review and confirm this booking in the admin panel.</p>
    `;

    const html = buildInternalNotificationHtml({
      title: 'New booking — Drift & Dwells Admin',
      preheader: `New booking: ${htmlEscape(cabin.name)} — ${htmlEscape(booking.guestInfo?.email || '')}`,
      headerGradientFrom: '#3d3d38',
      headerGradientTo: '#3d3d38',
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
- Check-in: ${checkIn.toLocaleDateString('en-GB')}
- Check-out: ${checkOut.toLocaleDateString('en-GB')}
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

