# Email Smoke Test (Postmark SMTP)

Steps:

1) Create a booking via https://booking.driftdwells.com
- Complete the flow until you reach the final confirmation in the app.

2) In Admin, confirm the booking, then cancel it.
- Expected: exactly one email per event; no duplicates.

3) Check inboxes
- Guest (your test address) should receive: booking received, booking confirmed, booking cancelled.
- Optional: internal notifications (if configured) to jose@driftdwells.com.

4) Postmark → Activity
- Confirm three sends for the booking.

5) Deliverability check
- In Gmail, open each email → “Show original”. Confirm SPF/DKIM/DMARC = pass.

Troubleshooting:
- Ensure NODE_ENV=production and SMTP transport is configured (`SMTP_URL` or `SMTP_HOST` mode), with `SMTP_TLS_SERVERNAME` set when loopback STARTTLS certificate hostname differs from `127.0.0.1`.
- Check server logs for transporter verification messages.
- If duplicates appear, verify idempotency logs (should show skipped-duplicate on rapid retries).

