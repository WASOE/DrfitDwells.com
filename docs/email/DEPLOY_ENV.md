# Production Email Environment (Local SMTP Submission)

WARNING: Do not paste this file into the repo. Set these on the host/PaaS only.

Set the following environment variables in production:

```
EMAIL_FROM="Drift & Dwells <bookings@driftdwells.com>"
NODE_ENV=production
EMAIL_DELIVERY_REQUIRED=1

# Option A: explicit host/port auth config (recommended for local submission with TLS servername override)
SMTP_HOST=127.0.0.1
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=<local-submission-username>
SMTP_PASS=<local-submission-password>
SMTP_TLS_SERVERNAME=<certificate-hostname-presented-by-local-relay>

# Option B: URL mode (kept env-driven), still with TLS servername override
# SMTP_URL="smtp://<user>:<pass>@127.0.0.1:587"
# SMTP_TLS_SERVERNAME=<certificate-hostname-presented-by-local-relay>
```

Notes:
- App transport remains provider-agnostic: application submits to local SMTP relay, relay handles upstream provider.
- Do not use public `mail.driftdwells.com` as the application transport path for this architecture.
- `SMTP_TLS_SERVERNAME` exists to handle hostname validation when connecting to `127.0.0.1` over STARTTLS.
- With `EMAIL_DELIVERY_REQUIRED=1`, unusable SMTP transport returns hard failures (no success-like logged fallback).

