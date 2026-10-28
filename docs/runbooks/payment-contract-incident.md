# Payment contract incident runbook

Incident date: 2026-10-27. Checkout Session V2 was enabled in production while `FINALIZE_INTENT_PERSIST` and `FINALIZE_INTENT_REQUIRED_FOR_PI` were unset on the API. The browser, built with both Vite flags on, called `PUT /api/bookings/checkout-sessions/:checkoutId/finalize-intent` and received `403 FINALIZE_INTENT_PERSIST_DISABLED`. PaymentIntent creation often still returned 200, so guests could start payment attempts that checkout could not finish.

The contract version is `checkout-payment-v2-finalize-1`. An emergency configuration hotfix has already set the two API flags. This runbook is the permanent check path. Do not treat the open Manual Review item as resolved from this document alone.

Do not print Stripe secrets, client secrets, guest details, or request bodies while following these steps.

## 1. Capability mismatch diagnosis

1. Read `GET /api/health`. Confirm `status` is `OK`. Note `applicationRelease`, `frontendRelease`, and `paymentContractVersion` only.
2. Read `GET /api/bookings/checkout-capabilities`. The production contract requires all of:
   - `checkoutSessionV2: true`
   - `finalizeIntentPersist: true`
   - `finalizeIntentRequiredForPi: true`
   - `paymentContractVersion: checkout-payment-v2-finalize-1`
   - `frontendReleaseHint` equal to the frontend release in `client/dist/release-manifest.json`
3. Compare with the manifest using the read-only verifier (no charge, no PaymentIntent):

```bash
node scripts/verifyPaymentContractRuntime.mjs \
  --base-url http://127.0.0.1:5000 \
  --manifest client/dist/release-manifest.json \
  --timeout-ms 5000
```

A non-zero exit lists mismatched fields. `FINALIZE_INTENT_PERSIST is unset` or `disabled` on API startup means the process refused to boot rather than serving an incompatible contract.

Customer-facing checkout blocks when the compiled client expects persist or required-for-PI and the live capability says that flag is false. The page does not auto-reload.

## 2. Emergency configuration restoration

On the API host, set these explicitly to an enabled token (`1`, `true`, `on`, or `yes`). Unset is false.

- `CHECKOUT_SESSION_V2=1`
- `FINALIZE_INTENT_PERSIST=1`
- `FINALIZE_INTENT_REQUIRED_FOR_PI=1`
- `FRONTEND_RELEASE` equal to the value used as `VITE_FRONTEND_RELEASE` for that frontend build
- `APP_RELEASE` when the build manifest recorded an application release id

Do not change Stripe keys as part of this restoration. Do not disable Checkout V2 to hide the 403 unless the matching frontend build is also rolled back (see Rollback).

Production startup now fails closed when Checkout V2 is enabled and either finalize flag is missing, `false`, or not a recognized enabled token. The fatal log names each flag and its state (`unset`, `disabled`, or `invalid`) and does not echo secret values.

## 3. Restart and verification

Restart only the API process after the env file is saved. Then:

1. `GET /api/health` returns `status: OK`.
2. Capabilities show both finalize flags true and the contract version above.
3. `node scripts/verifyPaymentContractRuntime.mjs` exits 0.
4. The process monitor exits 0:

```bash
node ops/driftdwells-production/payment-contract-monitor.mjs \
  --base-url http://127.0.0.1:5000 \
  --timeout-ms 5000 \
  --require-role "driftdwells-production-SHORTSHA" \
  --require-role driftdwells-confirmation-worker
```

Replace `SHORTSHA` with the live API process name before trusting the result. The script default role `driftdwells` is not the production API name and must not be used for this check. `PROCESS_ROLE_MISSING`, `API_HEALTH_FAILED`, and `PAYMENT_CONTRACT_MISMATCH` are separate codes. Installation notes: `ops/driftdwells-production/PAYMENT_CONTRACT_MONITOR.md`. Do not install systemd units from the application change itself.

Place one low-value test booking only after steps 1–4 pass, on a normal checkout, and confirm finalize-intent is not `403 FINALIZE_INTENT_PERSIST_DISABLED`.

## 4. Reconciliation

For the incident window, run the read-only report. It does not refund, cancel, capture, finalize, or email.

```bash
node server/scripts/reportUnfinalizedCheckoutPayments.js \
  --since=2026-10-27T00:00:00.000Z \
  --until=2026-10-27T23:59:59.000Z
```

Classify rows as `succeeded`, `processing`, `requires_action`, `requires_payment_method`, `cancelled`, or `unknown`. Rows are checkout sessions or PaymentIntents in the window that lack a booking in `confirmed`, `in_house`, or `completed`.

`--execute` and other mutation flags exit 2 with `MUTATION_NOT_PERMITTED`. Turning on writes later requires a new explicit flag and a separately reviewed task. Use the JSON to decide guest follow-up outside this command. Do not paste guest emails or `client_secret` values into tickets; the report omits them.

## 5. Rollback

Preferred rollback is to restore a frontend and API pair that share one contract version.

- To keep Checkout V2: both finalize flags must stay explicitly enabled on the API, and the frontend build must have been verified with `VITE_CHECKOUT_SESSION_V2`, `VITE_FINALIZE_INTENT_PERSIST`, and `VITE_FINALIZE_INTENT_REQUIRED_FOR_PI` all enabled.
- To leave Checkout V2: set `CHECKOUT_SESSION_V2=0` and deploy a frontend built with `VITE_CHECKOUT_SESSION_V2` off. Do not leave a V2 frontend pointed at a legacy API.
- Restart the API after the env change and rerun the health, capability, and manifest checks. A V2-off API will fail the production capability watchdog, which expects the V2 contract. Use the manifest verifier against the rolled-back manifest instead, and treat watchdog `PAYMENT_CONTRACT_MISMATCH` as expected until the V2 contract is restored.

Do not roll back by deleting PaymentIntents or bookings from the incident window.

## 6. When it is safe to resolve the Manual Review item

Leave the existing Manual Review item open until all of the following are true:

- Capabilities and the runtime manifest check agree, including both finalize flags and the contract version.
- API startup is on a build that fails closed if those flags are turned off while Checkout V2 stays on.
- New finalize-intent calls are not returning `FINALIZE_INTENT_PERSIST_DISABLED`.
- The read-only reconciliation report for the incident window has been reviewed, and any `succeeded` row without a finalized booking has an owner.
- Push delivery for a new test alert shows `delivered`, or an explicit `no_subscription` / `provider_failure`. `skipped` with `deduped` is acceptable only when a prior delivery in the dedupe window succeeded.

Resolving the Manual Review item is an operations action in the admin UI after that review. This repository change does not resolve it.
