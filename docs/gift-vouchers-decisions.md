# Gift voucher customization — decisions log

| Batch | Decision | Rule |
|-------|----------|------|
| 4 | Legacy card access tokens | No proactive backfill script. `resolveVoucherByCardAccessToken` never mints a token. Vouchers activated before Batch 4 have `cardAccessTokenHash: null` until ops action. |
| 5 | `sentAt` semantics | Set only on successful `recipient_voucher` or `buyer_gift_card` send (guarded `sentAt: null` update). Never set by `buyer_receipt` or postal path. Scheduled worker sets on recipient send in Batch 6. |
| 5 | Designed emails | No feature flag. Test coverage + revert is the safety net. |
| 5 | Resend download links (interim) | Batch 5 resend emails omit download link entirely (raw token not recoverable from hash). |
| 6 | Scheduled worker go-live | Step 1: deploy `runGiftVoucherDeliveryWorker.js` with `GIFT_VOUCHER_DELIVERY_WORKER_ENABLED=1` and `GIFT_VOUCHER_SCHEDULED_ENABLED=0`. Step 2: flip `GIFT_VOUCHER_SCHEDULED_ENABLED=1`. Worker still delivers in-flight vouchers if purchase flag is rolled back. |
| 6 | Scheduled send token rotation | Worker rotates `cardAccessTokenHash` at recipient send time. Buyer receipt link from activation may invalidate; recipient email carries the working link. Hash-only storage; no encrypted token persistence. |
| 6 | Scheduled retry backoff | Worker retries only when ≥30 minutes have passed since the last `scheduled_delivery_attempt_failed` event. Max 3 attempts, then manual review. |
| 6 | Past-expiry scheduled delivery | If Sofia `deliveryDate >= expiresAt`, write one-time `scheduled_delivery_date_past_expiry` event and open manual review; exclude from future ticks. |
| 7 | Client go-live order | Deploy server with `GET /api/gift-vouchers/config` first. New client can ship any time after — scheduled option hidden when `GIFT_VOUCHER_SCHEDULED_ENABLED` is off. Flip scheduled flag later (after worker soak); client deploy does not wait for it. |
| 7 | Card preview background | Live preview uses `gift-voucher-card-bg.jpg` (Batch 3 email/print derivative), never `gift-voucher-hero.jpg`. |
| 7 | Preview vs payload | `PREVIEW_EXAMPLE` in `shared/giftVoucher/cardCopy.js` fills empty preview fields only; `buildSubmitPayload` never includes example strings (tested). |
| 7 | Card copy source | `shared/giftVoucher/cardCopy.js` is single source; `server/data/giftVoucherCardCopy.js` re-exports (no duplicated content). |
| 7 | Card design language | Templates rebuilt to the manual-card language: Postcard (stored `forest`), Letter (stored `romantic`), Ink (stored `minimal`). Brand line on every card (EN "The gift of time offline." / BG "Подари време офлайн."). Shared TO/VALID UNTIL/CODE/VALUE form block with dotted underlines is the voucher identity. Message (Caveat) is always the largest text element. |
| 7 | Card fonts | Self-hosted woff2 (OFL, Latin + Cyrillic): Marck Script (script), Caveat (message), Oswald (utility caps); Playfair (statement) + Inter (small utility) stay. Roles documented in `CARD_FONT_ROLES`. Email mode: script/message fall back to Playfair italic, textures degrade to solid warm colors. |
| 7 | Card artifact assets | Canva exports owned by the business go in `client/public/media/gift-vouchers/card/` (paper texture, crumpled texture, mountain line-art, stamp frame; optional flower, signpost — each <150KB). Until a file lands its slot renders the flat `#F7F4EE` fallback; no substitute artwork ever. |
| 7 | Legacy card bg | `gift-voucher-card-bg.jpg` stays on disk permanently — already-sent emails hot-link it (test-enforced). |
| 7 | Template design direction (Batch 7 QA) | Decorative assets (stamp, flower, mountain line-art) removed; site logo top-right on all three templates; textures retained. Design gate in Batch 9 judges against this direction. |
| 8 | Ops resend token mint | When `cardAccessTokenHash` is null on legacy voucher, mint token at ops resend so download link can be included. |
| 8 | Resend token rotation | **Permanent rule:** any resend rotates the card access token (mint new, overwrite `cardAccessTokenHash`); old links invalidate. Newest email always carries the working link. |
| 8 | Failed resend rotation | If ops resend fails after rotation, the hash stays rotated and old download links are dead. A retry rotates again; newest link wins. Same rule as Batch 6 scheduled delivery. |
