const nodemailer = require('nodemailer');

// In-memory idempotency guard for email events
const sentEvents = new Map(); // key: `${bookingId}:${event}` -> timestamp
const EVENT_TTL_MS = 10 * 60 * 1000; // 10 minutes

function markAndCheckEventRecentlySent(key) {
  const now = Date.now();
  const prev = sentEvents.get(key);
  if (prev && now - prev < EVENT_TTL_MS) return true;
  sentEvents.set(key, now);
  // occasional cleanup
  if (sentEvents.size > 5000) {
    for (const [k, t] of sentEvents) {
      if (now - t >= EVENT_TTL_MS) sentEvents.delete(k);
    }
  }
  return false;
}

class EmailService {
  constructor() {
    this.transporter = null;
    this.isConfigured = false;
    this.init();
  }

  async init() {
    const smtpUrl = process.env.SMTP_URL;
    
    if (!smtpUrl) {
      console.log('📧 SMTP_URL not configured - emails will be logged instead of sent');
      return;
    }

    try {
      this.transporter = nodemailer.createTransport(smtpUrl);
      this.isConfigured = true;
      console.log('📧 Email service configured with SMTP');
      if (process.env.NODE_ENV === 'production') {
        try {
          await this.transporter.verify();
          console.log('📧 Email transporter verified');
        } catch (verifyErr) {
          console.error('📧 Email transporter verification failed:', verifyErr.message);
          this.transporter = null;
          this.isConfigured = false;
        }
      }
    } catch (error) {
      console.error('📧 Failed to configure email service:', error.message);
    }
  }

  async sendEmail({ to, subject, html, text, trigger, bookingId }) {
    // Idempotency: avoid duplicate sends for same booking+event in short window
    if (bookingId && trigger) {
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
      // Log email instead of sending
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

      // Fallback to logging
      console.log('📧 EMAIL LOG (failed to send):', JSON.stringify(emailData, null, 2));
      return { success: false, method: 'logged', error: error.message };
    }
  }

  generateBookingReceivedEmail(booking, cabin) {
    const checkIn = new Date(booking.checkIn);
    const checkOut = new Date(booking.checkOut);
    const nights = Math.ceil((checkOut - checkIn) / (1000 * 3600 * 24));

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
            <h2>Hello ${booking.guestInfo.firstName}!</h2>
            <p>Thank you for choosing Drift & Dwells for your off-grid retreat. We've received your booking request and are excited to welcome you to nature.</p>
            
            <div class="booking-details">
              <h3 style="margin-top: 0; color: #374151;">Booking Details</h3>
              <div class="detail-row">
                <span class="detail-label">Cabin:</span>
                <span>${cabin.name} • ${cabin.location}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Check-in:</span>
                <span>${checkIn.toLocaleDateString('en-GB')} (${booking.cabinId.arrivalWindowDefault || 'TBD'})</span>
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
                <span>${booking.tripType || 'Custom Experience'}</span>
              </div>
              ${booking.transportMethod && booking.transportMethod !== 'Not selected' ? `
              <div class="detail-row">
                <span class="detail-label">Transport:</span>
                <span>${booking.transportMethod}</span>
              </div>
              ` : ''}
              <div class="detail-row">
                <span class="detail-label">Total:</span>
                <span style="font-weight: 700; font-size: 18px; color: #81887A;">€${booking.totalPrice}</span>
              </div>
            </div>

            ${cabin.meetingPoint?.googleMapsUrl ? `
            <div class="guidance-section">
              <h3 style="margin-top: 0; color: #92400e;">📍 Directions</h3>
              <p><strong>Meeting Point:</strong> ${cabin.meetingPoint.label || cabin.location}</p>
              <a href="${cabin.meetingPoint.googleMapsUrl}" class="btn" target="_blank">Open in Google Maps</a>
              ${cabin.meetingPoint.what3words ? `<a href="https://what3words.com/${cabin.meetingPoint.what3words}" class="btn" target="_blank">///${cabin.meetingPoint.what3words}</a>` : ''}
              ${cabin.meetingPoint.lat && cabin.meetingPoint.lng ? `<p style="margin: 10px 0; font-family: monospace; background: white; padding: 8px; border-radius: 4px;">GPS: ${cabin.meetingPoint.lat}, ${cabin.meetingPoint.lng}</p>` : ''}
            </div>
            ` : ''}

            ${cabin.packingList && cabin.packingList.length > 0 ? `
            <div class="packing-list">
              <h3 style="margin-top: 0; color: #166534;">🎒 Packing List</h3>
              <ul>
                ${cabin.packingList.slice(0, 5).map(item => `<li>${item}</li>`).join('')}
                ${cabin.packingList.length > 5 ? `<li><em>... and ${cabin.packingList.length - 5} more items</em></li>` : ''}
              </ul>
              ${cabin.packingList.length > 5 ? '<p><em>See full packing list in your booking confirmation email.</em></p>' : ''}
            </div>
            ` : ''}

            ${cabin.location && (cabin.location.toLowerCase().includes('valley') || cabin.location.toLowerCase().includes('the valley')) ? `
            <div class="guidance-section" style="background: #dbeafe; border-left: 4px solid #2563eb; padding: 20px; border-radius: 4px; margin: 20px 0;">
              <h3 style="margin-top: 0; color: #1e40af;">🗺️ Interactive Welcome Guide</h3>
              <p><strong>Open your trip guide</strong> to complete checklists, choose your arrival route, and prepare for The Valley.</p>
              <a href="${process.env.APP_URL || 'http://localhost:5173'}/my-trip/${booking._id}/valley-guide" class="btn" style="background: #2563eb; color: white;" target="_blank">Open Valley Welcome Guide</a>
              <p style="margin-top: 10px; font-size: 14px; color: #64748b;">Complete your trip checklist 24 hours before arrival.</p>
            </div>
            ` : ''}

            ${cabin.arrivalGuideUrl ? `
            <div class="guidance-section">
              <h3 style="margin-top: 0; color: #92400e;">📄 Offline Arrival Guide</h3>
              <p>Download our detailed arrival guide for offline reference:</p>
              <a href="${cabin.arrivalGuideUrl}" class="btn" target="_blank">Download PDF Guide</a>
            </div>
            ` : ''}

            ${cabin.safetyNotes ? `
            <div class="safety-notes">
              <h3 style="margin-top: 0; color: #dc2626;">⚠️ Safety & House Rules</h3>
              <p>${cabin.safetyNotes}</p>
            </div>
            ` : ''}

            ${cabin.emergencyContact ? `
            <div class="contact-info">
              <h3 style="margin-top: 0; color: #1e40af;">🚨 Emergency Contact</h3>
              <p><strong>${cabin.emergencyContact}</strong></p>
            </div>
            ` : ''}

            <div class="guidance-section">
              <h3 style="margin-top: 0; color: #92400e;">💰 Payment</h3>
              <p>Payment of <strong>€${booking.totalPrice}</strong> is due on arrival. We accept cash and major credit cards.</p>
            </div>

            <p style="margin-top: 30px;">We'll send you a confirmation email within 24 hours and detailed arrival instructions 3 days before your stay.</p>
            
            <p>Questions? Reply to this email or contact us at info@driftdwells.com</p>
            
            <p>We can't wait to welcome you to your digital detox retreat!</p>
            
            <p>Best regards,<br>The Drift & Dwells Team</p>
          </div>
          
          <div class="footer">
            <p>© 2024 Drift & Dwells. All rights reserved.</p>
            <p><a href="#" style="color: #6b7280;">Terms of Service</a> | <a href="#" style="color: #6b7280;">Privacy Policy</a></p>
          </div>
        </div>
      </body>
      </html>
    `;

    const text = `
Drift & Dwells - Booking Confirmation

Hello ${booking.guestInfo.firstName}!

Thank you for choosing Drift & Dwells for your off-grid retreat.

BOOKING DETAILS:
- Cabin: ${cabin.name} • ${cabin.location}
- Check-in: ${checkIn.toLocaleDateString('en-GB')} (${booking.cabinId.arrivalWindowDefault || 'TBD'})
- Check-out: ${checkOut.toLocaleDateString('en-GB')}
- Duration: ${nights} night${nights !== 1 ? 's' : ''}
- Guests: ${booking.adults} adult${booking.adults !== 1 ? 's' : ''}${booking.children > 0 ? `, ${booking.children} child${booking.children !== 1 ? 'ren' : ''}` : ''}
- Trip Type: ${booking.tripType || 'Custom Experience'}
${booking.transportMethod && booking.transportMethod !== 'Not selected' ? `- Transport: ${booking.transportMethod}` : ''}
- Total: €${booking.totalPrice}

${cabin.meetingPoint?.googleMapsUrl ? `
DIRECTIONS:
Meeting Point: ${cabin.meetingPoint.label || cabin.location}
Google Maps: ${cabin.meetingPoint.googleMapsUrl}
${cabin.meetingPoint.what3words ? `What3Words: ///${cabin.meetingPoint.what3words}` : ''}
${cabin.meetingPoint.lat && cabin.meetingPoint.lng ? `GPS: ${cabin.meetingPoint.lat}, ${cabin.meetingPoint.lng}` : ''}
` : ''}

${cabin.packingList && cabin.packingList.length > 0 ? `
PACKING LIST:
${cabin.packingList.slice(0, 5).map(item => `- ${item}`).join('\n')}
${cabin.packingList.length > 5 ? `... and ${cabin.packingList.length - 5} more items` : ''}
` : ''}

${cabin.location && (cabin.location.toLowerCase().includes('valley') || cabin.location.toLowerCase().includes('the valley')) ? `
INTERACTIVE WELCOME GUIDE:
Open your trip guide: ${process.env.APP_URL || 'http://localhost:5173'}/my-trip/${booking._id}/valley-guide
Complete your trip checklist 24 hours before arrival.
` : ''}

${cabin.arrivalGuideUrl ? `
OFFLINE GUIDE: ${cabin.arrivalGuideUrl}
` : ''}

${cabin.safetyNotes ? `
SAFETY & HOUSE RULES:
${cabin.safetyNotes}
` : ''}

${cabin.emergencyContact ? `
EMERGENCY CONTACT: ${cabin.emergencyContact}
` : ''}

PAYMENT: €${booking.totalPrice} due on arrival (cash or credit cards accepted)

We'll send you a confirmation email within 24 hours and detailed arrival instructions 3 days before your stay.

Questions? Contact us at info@driftdwells.com

Best regards,
The Drift & Dwells Team
    `;

    return {
      subject: `Booking Confirmation - ${cabin.name} (${checkIn.toLocaleDateString('en-GB')})`,
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
            
            <h2>Hello ${booking.guestInfo.firstName}!</h2>
            <p>Great news! Your booking has been confirmed. We're excited to welcome you to your off-grid retreat at <strong>${cabin.name}</strong>.</p>
            
            <div class="booking-details">
              <h3 style="margin-top: 0; color: #374151;">Confirmed Details</h3>
              <div class="detail-row">
                <span class="detail-label">Cabin:</span>
                <span>${cabin.name} • ${cabin.location}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Check-in:</span>
                <span>${checkIn.toLocaleDateString('en-GB')} (${booking.cabinId.arrivalWindowDefault || 'TBD'})</span>
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
          
          <div class="footer">
            <p>© 2024 Drift & Dwells. All rights reserved.</p>
            <p><a href="#" style="color: #6b7280;">Terms of Service</a> | <a href="#" style="color: #6b7280;">Privacy Policy</a></p>
          </div>
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
- Check-in: ${checkIn.toLocaleDateString('en-GB')} (${booking.cabinId.arrivalWindowDefault || 'TBD'})
- Check-out: ${checkOut.toLocaleDateString('en-GB')}
- Duration: ${nights} night${nights !== 1 ? 's' : ''}
- Total: €${booking.totalPrice}

We'll send you detailed arrival instructions and local recommendations 3 days before your stay.

Questions? Reply to this email or contact us at info@driftdwells.com

Best regards,
The Drift & Dwells Team
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
            
            <h2>Hello ${booking.guestInfo.firstName},</h2>
            <p>We're sorry to inform you that your booking for <strong>${cabin.name}</strong> has been cancelled.</p>
            
            <div class="booking-details">
              <h3 style="margin-top: 0; color: #374151;">Cancelled Booking</h3>
              <div class="detail-row">
                <span class="detail-label">Cabin:</span>
                <span>${cabin.name} • ${cabin.location}</span>
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
          
          <div class="footer">
            <p>© 2024 Drift & Dwells. All rights reserved.</p>
            <p><a href="#" style="color: #6b7280;">Terms of Service</a> | <a href="#" style="color: #6b7280;">Privacy Policy</a></p>
          </div>
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
                <span>${cabin.name} • ${cabin.location}</span>
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
                <span>${booking.guestInfo.firstName} ${booking.guestInfo.lastName}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Email:</span>
                <span>${booking.guestInfo.email}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Phone:</span>
                <span>${booking.guestInfo.phone}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Guests:</span>
                <span>${booking.adults} adult${booking.adults !== 1 ? 's' : ''}${booking.children > 0 ? `, ${booking.children} child${booking.children !== 1 ? 'ren' : ''}` : ''}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Trip Type:</span>
                <span>${booking.tripType || 'Custom Experience'}</span>
              </div>
              ${booking.transportMethod && booking.transportMethod !== 'Not selected' ? `
              <div class="detail-row">
                <span class="detail-label">Transport:</span>
                <span>${booking.transportMethod}</span>
              </div>
              ` : ''}
              <div class="detail-row">
                <span class="detail-label">Total:</span>
                <span style="font-weight: 700; font-size: 18px; color: #059669;">€${booking.totalPrice}</span>
              </div>
              ${booking.specialRequests ? `
              <div class="detail-row">
                <span class="detail-label">Special Requests:</span>
                <span>${booking.specialRequests}</span>
              </div>
              ` : ''}
            </div>

            <p><strong>Status:</strong> ${booking.status}</p>
            
            <p>Please review and confirm this booking in the admin panel.</p>
          </div>
          
          <div class="footer">
            <p>© 2024 Drift & Dwells. Internal notification.</p>
          </div>
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
    `;

    return {
      subject: `New Booking - ${cabin.name} (${booking.guestInfo.firstName} ${booking.guestInfo.lastName})`,
      html,
      text
    };
  }
}

module.exports = new EmailService();

