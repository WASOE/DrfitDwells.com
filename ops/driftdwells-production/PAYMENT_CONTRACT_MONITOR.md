# Payment contract monitor

Read-only watchdog for the 2026-10-27 Checkout V2 contract incident. It checks named PM2 roles, `GET /api/health`, and `GET /api/bookings/checkout-capabilities`. It does not restart processes, edit systemd units, create PaymentIntents, or print environment values.

## What it alerts on

| Code | Meaning |
|------|---------|
| `PROCESS_ROLE_MISSING` | A required process name is absent. Extra unrelated workers do not alert. |
| `PROCESS_ROLE_NOT_ONLINE` | A required process is present but not `online`. |
| `API_HEALTH_FAILED` | `/api/health` did not return HTTP 200 with `status: OK`, or the request timed out. |
| `PAYMENT_CONTRACT_MISMATCH` | Live capabilities are not Checkout V2 with both finalize flags enabled and `paymentContractVersion` `checkout-payment-v2-finalize-1`. |

Default required roles:

- `driftdwells` (historical API name; not the current production API name)
- `driftdwells-confirmation-worker`

`driftdwells-accommodation-hold-expiry-worker` is not required. Additional PM2 apps are ignored. Override the set with repeated `--require-role=` arguments. Do not assert an exact worker count.

Current production documentation names the API `driftdwells-production-<short-sha>` (one numeric PM2 ID). The default `driftdwells` role will report `PROCESS_ROLE_MISSING` against that deployment. Production runs must pass `--require-role=driftdwells-production-<short-sha>` and `--require-role=driftdwells-confirmation-worker` after the live name is confirmed. Do not invent or rewrite the release-specific name in this repository.

## Install or update

Run on the app host as the service user. This copies nothing into systemd.

```bash
cd /home/illoc/apps/driftdwells-booking-portal
node ops/driftdwells-production/payment-contract-monitor.mjs --help
node ops/driftdwells-production/payment-contract-monitor.mjs \
  --base-url http://127.0.0.1:5000 \
  --timeout-ms 5000 \
  --require-role "driftdwells-production-SHORTSHA" \
  --require-role driftdwells-confirmation-worker
```

Replace `SHORTSHA` with the confirmed live API name. Do not run the production check with the default role `driftdwells`.

Exit 0 means the named roles are online and the live contract matches. Any alert is non-zero and the stdout JSON lists `alertCodes`.

To point a future timer at the script, keep the unit outside this change and exec the command above. Do not install or edit units as part of the application deploy that only updates this repository copy. Re-run the same command after each git pull; the script lives in the checkout, so no separate binary install is required.

Offline or CI checks can pass a snapshot that contains only names and statuses:

```bash
node ops/driftdwells-production/payment-contract-monitor.mjs \
  --base-url http://127.0.0.1:5000 \
  --process-snapshot /path/to/processes.json
```

`pm2 jlist` output is accepted, but only `name` and `status` are retained. Do not log the raw PM2 JSON; it includes process environments.

## Pair with the release manifest

After the API is listening, compare the build manifest as well:

```bash
node scripts/verifyPaymentContractRuntime.mjs \
  --base-url http://127.0.0.1:5000 \
  --manifest client/dist/release-manifest.json \
  --timeout-ms 5000
```

That command is also read-only. Set the same `FRONTEND_RELEASE` on the API that was baked in as `VITE_FRONTEND_RELEASE`, and set `APP_RELEASE` on both the build environment and the API when an application release id should be compared.
