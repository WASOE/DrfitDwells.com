import { Snowflake, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSeason } from '../context/SeasonContext';

/**
 * Minimal, compact season switcher for hero video headers.
 * - Default: bottom-center (mobile, Cabin, Valley pages)
 * - position="below-menu": home desktop only, centered below the header/menu
 */
const HeroSeasonToggle = ({ position = 'bottom-center' }) => {
  const { season, setSeason } = useSeason();
  const { t } = useTranslation('common');

  // below-menu: sit under the header (nav). --header-offset never set in layout, so fallback to header height.
  const positionClasses = position === 'below-menu'
    ? 'absolute top-[calc(var(--header-offset,5.5rem)+0.5rem)] left-1/2 -translate-x-1/2 z-30 pointer-events-auto'
    : 'absolute bottom-6 left-1/2 -translate-x-1/2 z-30 pointer-events-auto';

  return (
    <div
      className={positionClasses}
      role="group"
      aria-label={t('seasonToggle.groupAria')}
    >
      <div className="inline-flex items-center rounded-full overflow-hidden border border-white/20 bg-white/[0.08] backdrop-blur-sm">
        <button
          type="button"
          onClick={() => setSeason('winter')}
          className={`inline-flex items-center gap-1.5 px-2.5 py-2 text-[11px] font-medium uppercase tracking-wider transition-all duration-200 min-h-[36px] touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent ${
            season === 'winter'
              ? 'bg-white/15 text-white border-r border-white/15'
              : 'text-white/60 hover:text-white/85'
          }`}
          aria-pressed={season === 'winter'}
          aria-label={t('seasonToggle.winterViewAria')}
        >
          <Snowflake className="w-3 h-3 flex-shrink-0" strokeWidth={2} />
          <span>{t('seasonToggle.winter')}</span>
        </button>
        <button
          type="button"
          onClick={() => setSeason('summer')}
          className={`inline-flex items-center gap-1.5 px-2.5 py-2 text-[11px] font-medium uppercase tracking-wider transition-all duration-200 min-h-[36px] touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent ${
            season === 'summer'
              ? 'bg-white/15 text-white border-l border-white/15'
              : 'text-white/60 hover:text-white/85'
          }`}
          aria-pressed={season === 'summer'}
          aria-label={t('seasonToggle.summerViewAria')}
        >
          <Sun className="w-3 h-3 flex-shrink-0" strokeWidth={2} />
          <span>{t('seasonToggle.summer')}</span>
        </button>
      </div>
    </div>
  );
};

export default HeroSeasonToggle;
