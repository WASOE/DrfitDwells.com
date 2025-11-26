# Production Email Environment (Postmark SMTP)

WARNING: Do not paste this file into the repo. Set these on the host/PaaS only.

Set the following environment variables in production:

```
BOOKING_APP_BASE_URL=https://booking.driftdwells.com
EMAIL_FROM="Jose at Drift & Dwells <jose@driftdwells.com>"
SMTP_URL="smtp://06e474ce-1cc8-4bd1-98b4-c56c06a50c2c:06e474ce-1cc8-4bd1-98b4-c56c06a50c2c@smtp.postmarkapp.com:587"
NODE_ENV=production
```

Notes:
- Domain `driftdwells.com` has DKIM and Return-Path verified in Postmark.
- Keep the Server Token secret; rotate via Postmark if needed.
- App will only send real emails when NODE_ENV=production and SMTP_URL verifies; otherwise it logs emails.

