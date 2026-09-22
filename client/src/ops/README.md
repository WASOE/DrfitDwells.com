# Drift & Dwells OPS design system

Private design system for the complete authenticated `/ops` product. This is not a public-site style guide and not a Dashboard-only theme.

## Authority

- Design language: `docs/ops-design/OPS_DESIGN_LANGUAGE.md`
- Reviewed deviations: `docs/ops-design/OPS_DESIGN_EXCEPTION_REGISTER.md`
- Agent rule: `.cursor/rules/ops-design.mdc`

Do not create another design-language document. Update the authoritative guide and its implementation in the same change.

## Ownership

| Concern | Path |
|---|---|
| Tokens and appearance | `client/src/ops/ops.css` |
| Token-name contract | `client/src/ops/tokens/opsTokenNames.js` |
| Canonical primitives | `client/src/ops/primitives/` |
| Overlay behavior | `client/src/ops/primitives/opsOverlay.js` |
| Status meaning | `client/src/ops/status/opsStatusRegistry.js` |
| Shell | `client/src/layouts/ops/` |
| Domain composition | `client/src/pages/ops/` |
| Internal showcase | `client/src/ops/pages/OpsDesignSystemPage.jsx` |

Every new file under `client/src/pages/ops/**` is automatically included in the design guard.

## Gate

From `client/`:

```bash
npm run test:ops-design
```

This validates the design-system source and the full production OPS page tree.
