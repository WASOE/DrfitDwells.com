import { useTranslation } from 'react-i18next';

/**
 * Clean inline trust line for the paid-traffic landing.
 * Scores match the site footer. No boxes, no horizontal scroll.
 */
export default function PaidTrafficTrustStrip({ className = '', tone = 'dark' }) {
  const { t } = useTranslation('seo');
  const isLight = tone === 'light';

  const items = [
    { platform: 'Airbnb', score: '4.95' },
    { platform: 'Booking.com', score: '9.8' },
    { platform: 'Tripadvisor', score: '5.0' }
  ];

  const baseText = isLight ? 'text-white/80' : 'text-[#4a4a4a]';
  const dotColor = isLight ? 'text-white/40' : 'text-[#b8b8b8]';
  const platformColor = isLight ? 'text-white/90' : 'text-[#1a1a1a]';
  const scoreColor = isLight ? 'text-white' : 'text-[#1a1a1a]';

  return (
    <p
      className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] ${baseText} ${className}`}
      aria-label={t('paidStaysBulgaria.trustStrip.aria')}
    >
      {items.map((item, i) => (
        <span key={item.platform} className="inline-flex items-center gap-1 whitespace-nowrap">
          {i > 0 ? <span className={`${dotColor} pr-2`} aria-hidden>·</span> : null}
          <span className={`font-medium ${platformColor}`}>{item.platform}</span>
          <span className={`font-semibold ${scoreColor} tabular-nums`}>{item.score}</span>
        </span>
      ))}
    </p>
  );
}
