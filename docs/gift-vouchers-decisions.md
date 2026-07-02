# Gift voucher customization — decisions log

| Batch | Decision | Rule |
|-------|----------|------|
| 4 | Legacy card access tokens | No proactive backfill script. `resolveVoucherByCardAccessToken` never mints a token. Vouchers activated before Batch 4 have `cardAccessTokenHash: null` until ops action. |
| 5 | `sentAt` semantics | Set only on successful `recipient_voucher` or `buyer_gift_card` send (guarded `sentAt: null` update). Never set by `buyer_receipt` or postal path. Scheduled worker sets on recipient send in Batch 6. |
| 5 | Designed emails | No feature flag. Test coverage + revert is the safety net. |
| 5 | Resend download links (interim) | Batch 5 resend emails omit download link entirely (raw token not recoverable from hash). |
| 8 | Ops resend token mint | When `cardAccessTokenHash` is null on legacy voucher, mint token at ops resend so download link can be included. |
| 8 | Resend token rotation | **Permanent rule:** any resend rotates the card access token (mint new, overwrite `cardAccessTokenHash`); old links invalidate. Newest email always carries the working link. |
