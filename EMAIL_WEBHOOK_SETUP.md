# Email Webhook & Observability Setup

## Environment Variables

Add the following environment variable to your `.env` file:

```bash
# Postmark Webhook Secret (for email event tracking)
POSTMARK_WEBHOOK_SECRET=your-postmark-webhook-secret-here
```

## Postmark Configuration

1. Go to Postmark → **Servers** → **Drift & Dwells** → **Message Streams** → **Default Transactional** → **Webhooks**

2. **Add Webhook**:
   - **URL**: `https://booking.driftdwells.com/api/email/webhook/postmark`
   - **Events**: **Delivery, Bounce, SpamComplaint, Open, Click** (at minimum)
   - **Secret**: Create a strong random secret → paste as `POSTMARK_WEBHOOK_SECRET` on the server

3. **Save** and use Postmark's **"Send test"** to confirm `200 OK`

## Features

- ✅ **Email Event Tracking**: All email events (delivered, opened, clicked, bounced, complaints) are stored
- ✅ **Admin UI Badges**: Bookings list shows email issue badges for bounced/complaint emails
- ✅ **Email Activity Panel**: Booking detail page shows complete email event history
- ✅ **Signature Verification**: Webhook requests are verified using HMAC SHA256
- ✅ **Idempotency**: Duplicate events are prevented using unique keys
- ✅ **90-day TTL**: Email events automatically expire after 90 days (optional)

## API Endpoints

- `POST /api/email/webhook/postmark` - Postmark webhook endpoint
- `GET /api/admin/email-events?bookingId=<id>` - Get email events for a booking
- `GET /api/admin/email-events/summary?email=<email>` - Get email summary for an email address

## Database

The `EmailEvent` model stores:
- Provider (postmark)
- Event type (Delivered, Opened, Clicked, Bounce, SpamComplaint)
- Message ID and Postmark ID
- Booking ID (linked to booking)
- Recipient email and subject
- Event details and metadata
- Timestamps

