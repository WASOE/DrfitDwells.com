import { useTranslation } from 'react-i18next';

/**
 * Clean inline trust line for the paid-traffic landing.
 * Scores match the site footer. No boxes, no horizontal scroll.
 */
export default function PaidTrafficTrustStrip({ className = '' }) {
  const { t } = useTranslation('seo');

  const items = [
    { platform: 'Airbnb', score: '4.95' },
    { platform: 'Booking.com', score: '9.8' },
    { platform: 'Tripadvisor', score: '5.0' }
  ];

  return (
    <p
      className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-[#4a4a4a] ${className}`}
      aria-label={t('paidStaysBulgaria.trustStrip.aria')}
    >
      {items.map((item, i) => (
        <span key={item.platform} className="inline-flex items-center gap-1 whitespace-nowrap">
          {i > 0 ? <span className="text-[#b8b8b8] pr-2" aria-hidden>·</span> : null}
          <span className="font-medium text-[#1a1a1a]">{item.platform}</span>
          <span className="font-semibold text-[#1a1a1a] tabular-nums">{item.score}</span>
        </span>
      ))}
    </p>
  );
}
