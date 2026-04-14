const nodemailer = require('nodemailer');
const { resolveGuideUrl, isPdfUrl } = require('../utils/arrivalGuideUrl');

const SUPPORT_CONTACT_EMAIL = process.env.CONTACT_EMAIL || 'jose@driftdwells.com';

const EMAIL_SITE_ORIGIN = (process.env.APP_URL || 'https://driftdwells.com').replace(/\/$/, '');
const INSTAGRAM_URL = (process.env.INSTAGRAM_URL || 'https://www.instagram.com/driftdwells/').trim();
const FACEBOOK_URL = (
  process.env.FACEBOOK_URL || 'https://www.facebook.com/profile.php?id=61569960933269'
).trim();

function guestEmailFooterHtml() {
  const terms = `${EMAIL_SITE_ORIGIN}/terms`;
  const privacy = `${EMAIL_SITE_ORIGIN}/privacy`;
  return `
          <div class="footer">
            <p>© 2024 Drift & Dwells. All rights reserved.</p>
            <p><a href="${htmlEscape(terms)}" style="color: #6b7280;">Terms of Service</a> | <a href="${htmlEscape(privacy)}" style="color: #6b7280;">Privacy Policy</a></p>
            <p><a href="${htmlEscape(INSTAGRAM_URL)}" style="color: #6b7280;">Instagram</a> | <a href="${htmlEscape(FACEBOOK_URL)}" style="color: #6b7280;">Facebook</a></p>
          </div>`;
}

function guestEmailFooterText() {
  return `Terms: ${EMAIL_SITE_ORIGIN}/terms
Privacy: ${EMAIL_SITE_ORIGIN}/privacy
Instagram: ${INSTAGRAM_URL}
Facebook: ${FACEBOOK_URL}`;
}

function internalEmailSocialFooterHtml() {
  return `
          <div class="footer">
            <p>© 2024 Drift & Dwells. Internal notification.</p>
            <p><a href="${htmlEscape(INSTAGRAM_URL)}" style="color: #6b7280;">Instagram</a> | <a href="${htmlEscape(FACEBOOK_URL)}" style="color: #6b7280;">Facebook</a></p>
          </div>`;
}

const htmlEscape = (s) => {
  if (s == null || s === '') return '';
  const str = String(s);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

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

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Booking Confirmation - Drift & Dwells</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 20px; }
          .container { max-width: 600px; margin: 0 auto; }
          .header { background: linear-gradient(135deg, #81887A, #9CAF88); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: white; padding: 30px; border: 1px solid #e5e7eb; }
          .footer { background: #f9fafb; padding: 20px; text-align: center; border-radius: 0 0 8px 8px; font-size: 14px; color: #6b7280; }
          .booking-details { background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0; }
          .detail-row { display: flex; justify-content: space-between; margin: 10px 0; }
          .detail-label { font-weight: 600; color: #374151; }
          .guidance-section { margin: 20px 0; padding: 20px; background: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 4px; }
          .btn { display: inline-block; padding: 12px 24px; background: #81887A; color: white; text-decoration: none; border-radius: 6px; font-weight: 600; margin: 10px 5px; }
          .btn:hover { background: #707668; }
          .packing-list { background: #f0fdf4; border: 1px solid #bbf7d0; padding: 15px; border-radius: 6px; margin: 10px 0; }
          .packing-list ul { margin: 10px 0; padding-left: 20px; }
          .packing-list li { margin: 5px 0; }
          .safety-notes { background: #fef2f2; border: 1px solid #fecaca; padding: 15px; border-radius: 6px; margin: 10px 0; }
          .contact-info { background: #eff6ff; border: 1px solid #bfdbfe; padding: 15px; border-radius: 6px; margin: 10px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin: 0; font-size: 28px;">Drift & Dwells</h1>
            <p style="margin: 10px 0 0; opacity: 0.9;">Your booking has been received!</p>
          </div>
          
          <div class="content">
            <h2>Hello ${htmlEscape(booking.guestInfo?.firstName)}!</h2>
            <p>Thank you for choosing Drift & Dwells for your off-grid retreat. We've received your booking request and are excited to welcome you to nature.</p>
            
            <div class="booking-details">
              <h3 style="margin-top: 0; color: #374151;">Booking Details</h3>
              <div class="detail-row">
                <span class="detail-label">Cabin:</span>
                <span>${htmlEscape(stay.name)} • ${htmlEscape(stay.location)}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Check-in:</span>
                <span>${checkIn.toLocaleDateString('en-GB')} (${htmlEscape(stay.arrivalWindowDefault || 'TBD')})</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Check-out:</span>
                <span>${checkOut.toLocaleDateString('en-GB')}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Duration:</span>
                <span>${nights} night${nights !== 1 ? 's' : ''}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Guests:</span>
                <span>${booking.adults} adult${booking.adults !== 1 ? 's' : ''}${booking.children > 0 ? `, ${booking.children} child${booking.children !== 1 ? 'ren' : ''}` : ''}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Trip Type:</span>
                <span>${htmlEscape(booking.tripType || 'Custom Experience')}</span>
              </div>
              ${booking.transportMethod && booking.transportMethod !== 'Not selected' ? `
              <div class="detail-row">
                <span class="detail-label">Transport:</span>
                <span>${htmlEscape(booking.transportMethod)}</span>
              </div>
              ` : ''}
              <div class="detail-row">
                <span class="detail-label">Total:</span>
                <span style="font-weight: 700; font-size: 18px; color: #81887A;">€${booking.totalPrice}</span>
              </div>
            </div>

            ${stay.meetingPoint?.googleMapsUrl ? `
            <div class="guidance-section">
              <h3 style="margin-top: 0; color: #92400e;">📍 Directions</h3>
              <p><strong>Meeting Point:</strong> ${htmlEscape(stay.meetingPoint.label || stay.location)}</p>
              <a href="${stay.meetingPoint.googleMapsUrl}" class="btn" target="_blank">Open in Google Maps</a>
              ${stay.meetingPoint.what3words ? `<a href="https://what3words.com/${stay.meetingPoint.what3words}" class="btn" target="_blank">///${stay.meetingPoint.what3words}</a>` : ''}
              ${stay.meetingPoint.lat && stay.meetingPoint.lng ? `<p style="margin: 10px 0; font-family: monospace; background: white; padding: 8px; border-radius: 4px;">GPS: ${stay.meetingPoint.lat}, ${stay.meetingPoint.lng}</p>` : ''}
            </div>
            ` : ''}

            ${stay.packingList && stay.packingList.length > 0 ? `
            <div class="packing-list">
              <h3 style="margin-top: 0; color: #166534;">🎒 Packing List</h3>
              <ul>
                ${stay.packingList.slice(0, 5).map(item => `<li>${htmlEscape(item)}</li>`).join('')}
                ${stay.packingList.length > 5 ? `<li><em>... and ${stay.packingList.length - 5} more items</em></li>` : ''}
              </ul>
              ${stay.packingList.length > 5 ? '<p><em>See full packing list in your booking confirmation email.</em></p>' : ''}
            </div>
            ` : ''}

            ${stay.location && (stay.location.toLowerCase().includes('valley') || stay.location.toLowerCase().includes('the valley')) ? `
            <div class="guidance-section" style="background: #dbeafe; border-left: 4px solid #2563eb; padding: 20px; border-radius: 4px; margin: 20px 0;">
              <h3 style="margin-top: 0; color: #1e40af;">🗺️ Interactive Welcome Guide</h3>
              <p><strong>Open your trip guide</strong> to complete checklists, choose your arrival route, and prepare for The Valley.</p>
              <a href="${process.env.APP_URL || 'http://localhost:5173'}/my-trip/${booking._id}/valley-guide" class="btn" style="background: #2563eb; color: white;" target="_blank">Open Valley Welcome Guide</a>
              <p style="margin-top: 10px; font-size: 14px; color: #64748b;">Complete your trip checklist 24 hours before arrival.</p>
            </div>
            ` : ''}

            ${stay.arrivalGuideUrl ? `
            <div class="guidance-section">
              <h3 style="margin-top: 0; color: #92400e;">📄 Arrival Guide</h3>
              <p>Open practical route and arrival instructions (save offline before travel):</p>
              <a href="${resolveGuideUrl(stay.arrivalGuideUrl, process.env.APP_URL)}" class="btn" target="_blank">${isPdfUrl(stay.arrivalGuideUrl) ? 'Download PDF Guide' : 'Open Arrival Guide'}</a>
            </div>
            ` : ''}

            ${stay.safetyNotes ? `
            <div class="safety-notes">
              <h3 style="margin-top: 0; color: #dc2626;">⚠️ Safety & House Rules</h3>
              <p>${htmlEscape(stay.safetyNotes)}</p>
            </div>
            ` : ''}

            ${stay.emergencyContact ? `
            <div class="contact-info">
              <h3 style="margin-top: 0; color: #1e40af;">🚨 Emergency Contact</h3>
              <p><strong>${htmlEscape(stay.emergencyContact)}</strong></p>
            </div>
            ` : ''}

            <div class="guidance-section">
              <h3 style="margin-top: 0; color: #92400e;">💰 Payment</h3>
              <p>Payment of <strong>€${booking.totalPrice}</strong> is due on arrival. We accept cash and major credit cards.</p>
            </div>

            <p style="margin-top: 30px;">We'll send you a confirmation email within 24 hours and detailed arrival instructions 3 days before your stay.</p>
            
            <p>Questions? Reply to this email or contact us at ${htmlEscape(SUPPORT_CONTACT_EMAIL)}</p>
            
            <p>We can't wait to welcome you to your digital detox retreat!</p>
            
            <p>Best regards,<br>The Drift & Dwells Team</p>
          </div>
          
          ${guestEmailFooterHtml()}
        </div>
      </body>
      </html>
    `;

    const text = `
Drift & Dwells - Booking Confirmation

Hello ${booking.guestInfo.firstName}!

Thank you for choosing Drift & Dwells for your off-grid retreat.

BOOKING DETAILS:
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

PAYMENT: €${booking.totalPrice} due on arrival (cash or credit cards accepted)

We'll send you a confirmation email within 24 hours and detailed arrival instructions 3 days before your stay.

Questions? Contact us at ${SUPPORT_CONTACT_EMAIL}

Best regards,
The Drift & Dwells Team

${guestEmailFooterText()}
    `;

    return {
      subject: `Booking Confirmation - ${stay.name} (${checkIn.toLocaleDateString('en-GB')})`,
      html,
      text
    };
  }

  generateBookingConfirmedEmail(booking, cabin) {
    const checkIn = new Date(booking.checkIn);
    const checkOut = new Date(booking.checkOut);
    const nights = Math.ceil((checkOut - checkIn) / (1000 * 3600 * 24));

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Booking Confirmed - Drift & Dwells</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 20px; }
          .container { max-width: 600px; margin: 0 auto; }
          .header { background: linear-gradient(135deg, #059669, #10b981); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: white; padding: 30px; border: 1px solid #e5e7eb; }
          .footer { background: #f9fafb; padding: 20px; text-align: center; border-radius: 0 0 8px 8px; font-size: 14px; color: #6b7280; }
          .confirmed-badge { background: #dcfce7; color: #166534; padding: 10px 20px; border-radius: 20px; display: inline-block; font-weight: 600; margin: 10px 0; }
          .booking-details { background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0; }
          .detail-row { display: flex; justify-content: space-between; margin: 10px 0; }
          .detail-label { font-weight: 600; color: #374151; }
          .btn { display: inline-block; padding: 12px 24px; background: #059669; color: white; text-decoration: none; border-radius: 6px; font-weight: 600; margin: 10px 5px; }
          .btn:hover { background: #047857; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin: 0; font-size: 28px;">Drift & Dwells</h1>
            <p style="margin: 10px 0 0; opacity: 0.9;">Your booking is confirmed!</p>
          </div>
          
          <div class="content">
            <div class="confirmed-badge">✅ BOOKING CONFIRMED</div>
            
            <h2>Hello ${htmlEscape(booking.guestInfo?.firstName)}!</h2>
            <p>Great news! Your booking has been confirmed. We're excited to welcome you to your off-grid retreat at <strong>${htmlEscape(cabin.name)}</strong>.</p>
            
            <div class="booking-details">
              <h3 style="margin-top: 0; color: #374151;">Confirmed Details</h3>
              <div class="detail-row">
                <span class="detail-label">Cabin:</span>
                <span>${htmlEscape(cabin.name)} • ${htmlEscape(cabin.location)}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Check-in:</span>
                <span>${checkIn.toLocaleDateString('en-GB')} (${htmlEscape(cabin.arrivalWindowDefault || 'TBD')})</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Check-out:</span>
                <span>${checkOut.toLocaleDateString('en-GB')}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Duration:</span>
                <span>${nights} night${nights !== 1 ? 's' : ''}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Total:</span>
                <span style="font-weight: 700; font-size: 18px; color: #059669;">€${booking.totalPrice}</span>
              </div>
            </div>

            <p>We'll send you detailed arrival instructions and local recommendations 3 days before your stay.</p>
            
            <p>In the meantime, feel free to reply to this email if you have any questions or special requests.</p>
            
            <p>We can't wait to welcome you to nature!</p>
            
            <p>Best regards,<br>The Drift & Dwells Team</p>
          </div>
          
          ${guestEmailFooterHtml()}
        </div>
      </body>
      </html>
    `;

    const text = `
Drift & Dwells - Booking Confirmed

✅ BOOKING CONFIRMED

Hello ${booking.guestInfo.firstName}!

Great news! Your booking has been confirmed. We're excited to welcome you to your off-grid retreat at ${cabin.name}.

CONFIRMED DETAILS:
- Cabin: ${cabin.name} • ${cabin.location}
- Check-in: ${checkIn.toLocaleDateString('en-GB')} (${cabin?.arrivalWindowDefault || 'TBD'})
- Check-out: ${checkOut.toLocaleDateString('en-GB')}
- Duration: ${nights} night${nights !== 1 ? 's' : ''}
- Total: €${booking.totalPrice}

We'll send you detailed arrival instructions and local recommendations 3 days before your stay.

Questions? Reply to this email or contact us at ${SUPPORT_CONTACT_EMAIL}

Best regards,
The Drift & Dwells Team

${guestEmailFooterText()}
    `;

    return {
      subject: `Booking Confirmed - ${cabin.name} (${checkIn.toLocaleDateString('en-GB')})`,
      html,
      text
    };
  }

  generateBookingCancelledEmail(booking, cabin) {
    const checkIn = new Date(booking.checkIn);
    const checkOut = new Date(booking.checkOut);

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Booking Cancelled - Drift & Dwells</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 20px; }
          .container { max-width: 600px; margin: 0 auto; }
          .header { background: linear-gradient(135deg, #dc2626, #ef4444); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: white; padding: 30px; border: 1px solid #e5e7eb; }
          .footer { background: #f9fafb; padding: 20px; text-align: center; border-radius: 0 0 8px 8px; font-size: 14px; color: #6b7280; }
          .cancelled-badge { background: #fef2f2; color: #dc2626; padding: 10px 20px; border-radius: 20px; display: inline-block; font-weight: 600; margin: 10px 0; border: 1px solid #fecaca; }
          .booking-details { background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0; }
          .detail-row { display: flex; justify-content: space-between; margin: 10px 0; }
          .detail-label { font-weight: 600; color: #374151; }
          .btn { display: inline-block; padding: 12px 24px; background: #81887A; color: white; text-decoration: none; border-radius: 6px; font-weight: 600; margin: 10px 5px; }
          .btn:hover { background: #707668; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin: 0; font-size: 28px;">Drift & Dwells</h1>
            <p style="margin: 10px 0 0; opacity: 0.9;">Booking cancellation notice</p>
          </div>
          
          <div class="content">
            <div class="cancelled-badge">❌ BOOKING CANCELLED</div>
            
            <h2>Hello ${htmlEscape(booking.guestInfo?.firstName)},</h2>
            <p>We're sorry to inform you that your booking for <strong>${htmlEscape(cabin.name)}</strong> has been cancelled.</p>
            
            <div class="booking-details">
              <h3 style="margin-top: 0; color: #374151;">Cancelled Booking</h3>
              <div class="detail-row">
                <span class="detail-label">Cabin:</span>
                <span>${htmlEscape(cabin.name)} • ${htmlEscape(cabin.location)}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Check-in:</span>
                <span>${checkIn.toLocaleDateString('en-GB')}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Check-out:</span>
                <span>${checkOut.toLocaleDateString('en-GB')}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Total:</span>
                <span>€${booking.totalPrice}</span>
              </div>
            </div>

            <p>If you have any questions about this cancellation or would like to make a new booking, please don't hesitate to contact us.</p>
            
            <p>We hope to welcome you to Drift & Dwells in the future.</p>
            
            <p>Best regards,<br>The Drift & Dwells Team</p>
          </div>
          
          ${guestEmailFooterHtml()}
        </div>
      </body>
      </html>
    `;

    const text = `
Drift & Dwells - Booking Cancelled

❌ BOOKING CANCELLED

Hello ${booking.guestInfo.firstName},

We're sorry to inform you that your booking for ${cabin.name} has been cancelled.

CANCELLED BOOKING:
- Cabin: ${cabin.name} • ${cabin.location}
- Check-in: ${checkIn.toLocaleDateString('en-GB')}
- Check-out: ${checkOut.toLocaleDateString('en-GB')}
- Total: €${booking.totalPrice}

If you have any questions about this cancellation or would like to make a new booking, please don't hesitate to contact us.

We hope to welcome you to Drift & Dwells in the future.

Best regards,
The Drift & Dwells Team

${guestEmailFooterText()}
    `;

    return {
      subject: `Booking Cancelled - ${cabin.name} (${checkIn.toLocaleDateString('en-GB')})`,
      html,
      text
    };
  }

  generateInternalNotificationEmail(booking, cabin) {
    const checkIn = new Date(booking.checkIn);
    const checkOut = new Date(booking.checkOut);
    const nights = Math.ceil((checkOut - checkIn) / (1000 * 3600 * 24));

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>New Booking - Drift & Dwells Admin</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 20px; }
          .container { max-width: 600px; margin: 0 auto; }
          .header { background: linear-gradient(135deg, #1f2937, #374151); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: white; padding: 30px; border: 1px solid #e5e7eb; }
          .footer { background: #f9fafb; padding: 20px; text-align: center; border-radius: 0 0 8px 8px; font-size: 14px; color: #6b7280; }
          .new-badge { background: #dbeafe; color: #1e40af; padding: 10px 20px; border-radius: 20px; display: inline-block; font-weight: 600; margin: 10px 0; }
          .booking-details { background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0; }
          .detail-row { display: flex; justify-content: space-between; margin: 10px 0; }
          .detail-label { font-weight: 600; color: #374151; }
          .admin-link { background: #1f2937; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; display: inline-block; margin: 10px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin: 0; font-size: 28px;">Drift & Dwells Admin</h1>
            <p style="margin: 10px 0 0; opacity: 0.9;">New booking received</p>
          </div>
          
          <div class="content">
            <div class="new-badge">🔔 NEW BOOKING</div>
            
            <h2>New Booking Received</h2>
            <p>A new booking has been submitted and requires review.</p>
            
            <div class="booking-details">
              <h3 style="margin-top: 0; color: #374151;">Booking Details</h3>
              <div class="detail-row">
                <span class="detail-label">Booking ID:</span>
                <span>${booking._id}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Cabin:</span>
                <span>${htmlEscape(cabin.name)} • ${htmlEscape(cabin.location)}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Check-in:</span>
                <span>${checkIn.toLocaleDateString('en-GB')}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Check-out:</span>
                <span>${checkOut.toLocaleDateString('en-GB')}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Duration:</span>
                <span>${nights} night${nights !== 1 ? 's' : ''}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Guest:</span>
                <span>${htmlEscape(booking.guestInfo?.firstName)} ${htmlEscape(booking.guestInfo?.lastName)}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Email:</span>
                <span>${htmlEscape(booking.guestInfo?.email)}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Phone:</span>
                <span>${htmlEscape(booking.guestInfo?.phone)}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Guests:</span>
                <span>${booking.adults} adult${booking.adults !== 1 ? 's' : ''}${booking.children > 0 ? `, ${booking.children} child${booking.children !== 1 ? 'ren' : ''}` : ''}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Trip Type:</span>
                <span>${htmlEscape(booking.tripType || 'Custom Experience')}</span>
              </div>
              ${booking.transportMethod && booking.transportMethod !== 'Not selected' ? `
              <div class="detail-row">
                <span class="detail-label">Transport:</span>
                <span>${htmlEscape(booking.transportMethod)}</span>
              </div>
              ` : ''}
              <div class="detail-row">
                <span class="detail-label">Total:</span>
                <span style="font-weight: 700; font-size: 18px; color: #059669;">€${booking.totalPrice}</span>
              </div>
              ${booking.specialRequests ? `
              <div class="detail-row">
                <span class="detail-label">Special Requests:</span>
                <span>${htmlEscape(booking.specialRequests)}</span>
              </div>
              ` : ''}
            </div>

            <p><strong>Status:</strong> ${htmlEscape(booking.status)}</p>
            
            <p>Please review and confirm this booking in the admin panel.</p>
          </div>
          
          ${internalEmailSocialFooterHtml()}
        </div>
      </body>
      </html>
    `;

    const text = `
Drift & Dwells Admin - New Booking

🔔 NEW BOOKING

New Booking Received

A new booking has been submitted and requires review.

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

