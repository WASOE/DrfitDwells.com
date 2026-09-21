import { BRANDING, BRANDING_DIMENSIONS } from '../../config/brandingAssets';
import { useOpsAppearance } from '../../ops/appearance/OpsAppearanceProvider';

/**
 * Desktop sidebar brand mark. Expanded: wordmark. Collapsed: compact favicon.
 * Light appearance → dark wordmark. Dark appearance → white wordmark.
 */
export default function OpsSidebarBrand({ collapsed = false }) {
  const { appearance } = useOpsAppearance();
  const isDark = appearance === 'dark';

  if (collapsed) {
    return (
      <div className="ops-sidebar-brand ops-sidebar-brand--collapsed" data-testid="ops-sidebar-brand">
        <img
          className="ops-sidebar-brand__mark"
          src={BRANDING.favicon48}
          alt="Drift & Dwells"
          width={24}
          height={24}
          decoding="async"
          data-testid="ops-sidebar-brand-mark"
        />
      </div>
    );
  }

  const webp = isDark ? BRANDING.headerWhiteWebp : BRANDING.headerDarkWebp;
  const png = isDark ? BRANDING.headerWhitePng : BRANDING.headerDarkPng;

  return (
    <div className="ops-sidebar-brand ops-sidebar-brand--expanded" data-testid="ops-sidebar-brand">
      <picture>
        <source type="image/webp" srcSet={webp} />
        <img
          className="ops-sidebar-brand__wordmark"
          src={png}
          alt="Drift & Dwells"
          width={BRANDING_DIMENSIONS.header.width}
          height={BRANDING_DIMENSIONS.header.height}
          decoding="async"
          data-testid="ops-sidebar-brand-wordmark"
          data-ops-brand-tone={isDark ? 'white' : 'dark'}
        />
      </picture>
    </div>
  );
}
