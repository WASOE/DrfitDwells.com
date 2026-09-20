# Ops design island

Private `/ops` design system. Not a public-site style guide.

## Locked source

- Guide: `docs/ops-design/DND_OPS_DESIGN_LANGUAGE_GUIDE_V1_2_LOCKED.md`
- Exceptions: `docs/ops-design/OPS_DESIGN_EXCEPTION_REGISTER.md`
- Cursor rule: `.cursor/rules/ops-design.mdc`

Legacy screens live in `client/src/pages/ops/**` until an explicit migration slice. Do not treat them as hundreds of exceptions.

## Where things live

| What | Path |
|---|---|
| Tokens | `client/src/ops/ops.css` |
| Token names (tests / Tailwind map) | `client/src/ops/tokens/opsTokenNames.js` |
| Primitives | `client/src/ops/primitives/` |
| Overlay helper | `client/src/ops/primitives/opsOverlay.js` |
| Status registry | `client/src/ops/status/opsStatusRegistry.js` |
| Cleaner EN/BG | `client/src/ops/i18n/namespaces/` |
| Design-system page | `client/src/ops/pages/OpsDesignSystemPage.jsx` |

## Checks

From `client/`:

```bash
npm run test:ops-design
```

That runs the design-island guard plus token, status, and cleaner-namespace tests. It does not scan `client/src/pages/ops/**`.
