# Gift voucher customization — decisions log

| Batch | Decision | Rule |
|-------|----------|------|
| 4 | Legacy card access tokens | No proactive backfill script. `resolveVoucherByCardAccessToken` never mints a token. Vouchers activated before Batch 4 have `cardAccessTokenHash: null` until ops action. |
| 8 | Ops resend token mint | When ops resends a voucher and `cardAccessTokenHash` is null, generate and persist a token at resend time so the download link can be included. Only moment an old voucher gets a link without re-activation. |
