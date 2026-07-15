import { useEffect, useState } from 'react';

export const DESKTOP_HERO_QUERY = '(min-width: 1024px)';

/**
 * Desktop split hero row: 55% copy column + 45% card slot with matchMedia gate.
 *
 * @param {object} props
 * @param {import('react').ReactNode} props.copyColumn
 * @param {(isDesktopHero: boolean) => import('react').ReactNode} props.renderCardSlot
 */
const SplitHeroDesktopLayout = ({ copyColumn, renderCardSlot }) => {
  const [isDesktopHero, setIsDesktopHero] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;

    const mediaQuery = window.matchMedia(DESKTOP_HERO_QUERY);
    const update = () => setIsDesktopHero(mediaQuery.matches);
    update();
    mediaQuery.addEventListener('change', update);
    return () => mediaQuery.removeEventListener('change', update);
  }, []);

  return (
    <div className="split-hero-desktop retreat-hero-desktop hidden lg:flex relative z-10 w-full max-w-7xl mx-auto px-4 md:px-6 lg:px-8 items-center gap-8 xl:gap-12">
      <div className="split-hero-copy retreat-hero-copy w-[55%] shrink-0 text-left py-8">
        {copyColumn}
      </div>

      <div className="split-hero-card-column retreat-hero-calendar-column w-[45%] shrink-0 flex justify-end py-8">
        <div className="split-hero-card-slot retreat-hero-calendar-slot w-full max-w-md">
          {renderCardSlot(isDesktopHero)}
        </div>
      </div>
    </div>
  );
};

export default SplitHeroDesktopLayout;
