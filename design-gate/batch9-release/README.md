# Gift voucher design gate — Batch 9 release

Frozen at commit: `632eaf8ae410e0774d3325877b694aeb6da74712` (card design frozen at `6c23a9d`)

Card design is frozen (logo top-right, textures, no stamp/flower/mountain). Forest-as-texture deviation from original spec is **accepted**; this gate judges the frozen design.

## Files (14 HTML)

### Card fragments (email mode preview chrome)
- `forest-email-en.html`
- `forest-email-bg.html`
- `romantic-email-en.html`
- `romantic-email-bg.html`
- `minimal-email-en.html`
- `minimal-email-bg.html`

### Print documents (production print wrapper)
- `forest-print-en.html`
- `forest-print-bg.html`
- `romantic-print-en.html`
- `romantic-print-bg.html`
- `minimal-print-en.html`
- `minimal-print-bg.html`

### Full assembled recipient email (Letter / romantic)
- `romantic-email-full-en.html`
- `romantic-email-full-bg.html`

## Jose sign-off (EN primary)

Review these six EN renders in a browser (Print preview for print files):

1. `forest-email-en.html`
2. `romantic-email-en.html`
3. `minimal-email-en.html`
4. `forest-print-en.html`
5. `romantic-print-en.html`
6. `minimal-print-en.html`

Plus full assembled emails:

7. `romantic-email-full-en.html`
8. `romantic-email-full-bg.html`

Screenshots: `screenshots/` (6 EN fragment PNGs).

## Manual QA (8-point)

1. Desktop 1440px — builder amounts grid, preview, all 3 templates
2. Mobile 375px — same
3. EN + BG card language on Letter
4. Stripe test purchase — recipient_now
5. Email received — designed card + download link opens
6. Ops detail — card fields visible
7. Ops print — printable HTML
8. Compare EN gate PNGs to staging

Regenerate: `node server/scripts/generateGiftVoucherDesignGate.cjs`
Screenshots: `node server/scripts/captureGiftVoucherDesignGateScreenshots.cjs`
