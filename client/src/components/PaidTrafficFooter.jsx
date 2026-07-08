import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { localizePath } from '../utils/localizedRoutes';
import { useSiteLanguage } from '../hooks/useSiteLanguage';
import { CONTACT_EMAIL, CONTACT_PHONE } from '../data/gmbLocations';
import { BRANDING, BRANDING_DIMENSIONS } from '../config/brandingAssets';

/** Minimal footer for paid-traffic landing — legal + contact only. */
export default function PaidTrafficFooter() {
  const { t: tc } = useTranslation('common');
  const { t: ts } = useTranslation('seo');
  const { language } = useSiteLanguage();

  const homePath = localizePath('/', language);
  const giftPath = localizePath('/gift-vouchers', language);

  const linkClass =
    "font-['Montserrat'] text-[#111] hover:opacity-60 transition-opacity uppercase text-[11px] tracking-[0.12em] font-semibold";

  return (
    <footer className="relative bg-[#F9F8F6] text-[#111] z-10 border-t border-[rgba(0,0,0,0.08)]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 md:py-10">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-6 md:gap-10">
          <div className="flex flex-col gap-3 max-w-sm">
            <Link to={homePath} className="w-fit shrink-0" aria-label="Drift & Dwells">
              <picture>
                <source srcSet={BRANDING.headerDarkWebp} type="image/webp" />
                <img
                  src={BRANDING.headerDarkPng}
                  alt="Drift & Dwells"
                  width={BRANDING_DIMENSIONS.header.width}
                  height={BRANDING_DIMENSIONS.header.height}
                  className="h-7 w-auto max-h-7 object-contain object-left opacity-90"
                  loading="lazy"
                  decoding="async"
                />
              </picture>
            </Link>
            <div
              className="font-['Montserrat'] text-[#111] text-sm"
              style={{ opacity: 0.85, lineHeight: 1.6 }}
            >
              <p>
                <a href={`mailto:${CONTACT_EMAIL}`} className="hover:opacity-60 transition-opacity">
                  {CONTACT_EMAIL}
                </a>
              </p>
              <p className="tabular-nums">
                <a href={`tel:${CONTACT_PHONE.replace(/\s/g, '')}`} className="hover:opacity-60 transition-opacity">
                  {CONTACT_PHONE}
                </a>
              </p>
            </div>
            <p className="font-['Montserrat'] text-[12px] text-[#111] leading-snug" style={{ opacity: 0.7 }}>
              {ts('paidStaysBulgaria.secondaryExit.giftPrefix')}{' '}
              <Link
                to={giftPath}
                className="underline underline-offset-4 hover:opacity-60 transition-opacity"
              >
                {ts('paidStaysBulgaria.secondaryExit.giftLink')}
              </Link>
            </p>
          </div>

          <nav aria-label="Legal" className="flex flex-wrap gap-x-6 gap-y-3">
            <Link to={localizePath('/terms', language)} className={linkClass}>
              {tc('footer.termsLink')}
            </Link>
            <Link to={localizePath('/privacy', language)} className={linkClass}>
              {tc('footer.privacyLink')}
            </Link>
            <Link to={localizePath('/cancellation-policy', language)} className={linkClass}>
              {tc('footer.cancellationLink')}
            </Link>
          </nav>
        </div>

        <p
          className="font-['Montserrat'] text-[#111] text-center sm:text-left mt-8 pt-6 border-t border-[rgba(0,0,0,0.08)]"
          style={{ fontSize: '11px', opacity: 0.6 }}
        >
          {tc('footer.legalLine')}
        </p>
      </div>
    </footer>
  );
}
