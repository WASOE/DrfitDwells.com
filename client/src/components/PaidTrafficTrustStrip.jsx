import { useTranslation } from 'react-i18next';
import { BRANDING, BRANDING_DIMENSIONS } from '../config/brandingAssets';

/**
 * Compact platform trust proof for paid-traffic landing (scores match site footer).
 */
export default function PaidTrafficTrustStrip() {
  const { t } = useTranslation('seo');
  const { t: tc } = useTranslation('common');

  const itemClass =
    'flex items-center gap-2 rounded-lg border border-[rgba(0,0,0,0.08)] bg-white px-3 py-2 min-w-0';

  return (
    <div className="mt-3 md:mt-4" aria-label={t('paidStaysBulgaria.trustStrip.aria')}>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3">
        <li className={itemClass}>
          <img
            src={BRANDING.partnerAirbnbWebp}
            alt="Airbnb"
            width={BRANDING_DIMENSIONS.partnerAirbnb.width}
            height={BRANDING_DIMENSIONS.partnerAirbnb.height}
            className="h-5 w-auto object-contain mix-blend-multiply brightness-0 shrink-0"
            loading="lazy"
            decoding="async"
          />
          <div className="leading-tight min-w-0">
            <div className="text-sm font-semibold text-[#1a1a1a] tabular-nums">4.95</div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-[#717171]">
              {tc('footer.ratings.topHomes')}
            </div>
          </div>
        </li>
        <li className={itemClass}>
          <span className="text-[11px] font-bold text-[#1a1a1a] tracking-tight shrink-0">Booking.com</span>
          <div className="leading-tight min-w-0">
            <div className="text-sm font-semibold text-[#1a1a1a] tabular-nums">9.8</div>
            <div className="text-[10px] uppercase tracking-[0.1em] text-[#717171] leading-snug">
              {tc('footer.ratings.travellerAwards')}
            </div>
          </div>
        </li>
        <li className={`${itemClass} col-span-2 sm:col-span-1`}>
          <img
            src={BRANDING.partnerTripadvisorWebp}
            alt="TripAdvisor"
            width={BRANDING_DIMENSIONS.partnerTripadvisor.width}
            height={BRANDING_DIMENSIONS.partnerTripadvisor.height}
            className="h-6 w-auto object-contain shrink-0"
            loading="lazy"
            decoding="async"
          />
          <div className="leading-tight min-w-0">
            <div className="text-sm font-semibold text-[#1a1a1a] tabular-nums">5.0</div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-[#717171]">
              {tc('footer.ratings.travelersChoice')}
            </div>
          </div>
        </li>
      </ul>
    </div>
  );
}
