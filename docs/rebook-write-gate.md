# REBOOK API write gate

The production API accepts REBOOK writes only when `REBOOK_ENABLED` is the
exact string `true`. Missing, empty, malformed or any other value keeps the
gate closed. The HTTP route and both exported REBOOK service entry points check
the gate before database access. REALLOCATE and other reservation/payment
operations do not use this setting.

## Deployment order

1. Deploy this gate-only change from its reviewed release. Keep
   `REBOOK_ENABLED` unset or explicitly set it to `false` in the production API
   environment. Restart only through the guarded API deployment procedure.
2. Before cutover, explicitly set `REBOOK_ENABLED=false` in both isolated
   candidate and rollback environments. Confirm the old live PM2 environment
   does not contain `REBOOK_ENABLED=true`; the guarded launcher overlays
   non-empty current PM2 values on the candidate `.env`. Probe the candidate
   directly on `127.0.0.1:5001` using an authenticated request with a valid,
   non-existent source ID to `POST /api/ops/reservations/:id/actions/rebook`.
   It must return HTTP 503 with `details.code = REBOOK_DISABLED`.
3. After cutover, repeat that authenticated request directly on
   `127.0.0.1:5000` and through public ingress. Verify the production PM2
   environment has no true REBOOK flag. The service-level checks protect
   internal callers as well as HTTP.
4. Deploy the separately reviewed durable source-ownership release with the
   gate still closed. Do not resume an old API process or allow any old-version
   REBOOK writer to run after the ownership release.
5. Before enabling REBOOK, verify all active API executors use the ownership
   protocol, inspect historical REBOOK operations for ambiguous target/claim
   ownership, and reconcile any ambiguity. Enable only by setting the exact
   value `REBOOK_ENABLED=true` for every API process and restarting through the
   guarded process procedure. Recheck the effective value on every process.

## Rollback

Keep REBOOK disabled before and throughout rollback. The pre-gate API ignores
`REBOOK_ENABLED`; therefore restoring it while REBOOK is enabled can reopen the
old unsafe writer. Do not resume the pre-ownership writer against any source
booking consumed or fenced by the new protocol. Preserve source ownership and
inventory claims for explicit reconciliation.

No migration or index creation is required for the gate. Do not use a
production booking as a gate test.
