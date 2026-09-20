import { useLayoutEffect } from 'react';
import { useRegisterOpsPageWidth } from '../layout/OpsPageLayoutContext';
import { opsCx } from './opsCx';

export const OPS_PAGE_WIDTHS = Object.freeze(['narrow', 'default', 'wide', 'full']);

export const OPS_PAGE_MAX_WIDTHS = Object.freeze({
  narrow: '720px',
  default: '1040px',
  wide: '1360px',
  full: 'none'
});

export function resolveOpsPageWidth(width) {
  if (OPS_PAGE_WIDTHS.includes(width)) return width;
  return 'default';
}

function isForbiddenWidthClass(token) {
  return (
    token.startsWith('ops-page') ||
    token.startsWith('max-w-') ||
    token === 'w-screen' ||
    token === 'min-w-screen' ||
    token === 'w-dvw' ||
    token === 'w-svw' ||
    token === 'w-lvw'
  );
}

function sanitizeOpsPageClassName(className) {
  if (!className) return undefined;
  const cleaned = String(className)
    .split(/\s+/)
    .filter((token) => token && !isForbiddenWidthClass(token))
    .join(' ');
  return cleaned || undefined;
}

/**
 * Thin page container: canonical max-width, padding, and shell width opt-in.
 * Not a collection/detail/dashboard/settings template.
 */
export default function OpsPage({ width = 'default', className, children, ...rest }) {
  const resolved = resolveOpsPageWidth(width);
  const register = useRegisterOpsPageWidth();

  useLayoutEffect(() => {
    if (typeof register !== 'function') return undefined;
    return register();
  }, [register]);

  return (
    <div
      className={opsCx(sanitizeOpsPageClassName(className), 'ops-page', `ops-page--${resolved}`)}
      data-ops-page-width={resolved}
      data-testid="ops-page"
      {...rest}
    >
      {children}
    </div>
  );
}
