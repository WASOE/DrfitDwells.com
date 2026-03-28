import { useState, useEffect, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import HeroSeasonToggle from './HeroSeasonToggle';
import { useSeason } from '../context/SeasonContext';
import { useLanguage } from '../context/LanguageContext.jsx';
import { localizePath } from '../utils/localizedRoutes';
import { getIsMobileViewport } from '../utils/viewport';
import HeroPane from './HeroPane';

const DualityHeroDesktop = lazy(() => import('./DualityHeroDesktop'));

const DualityHero = () => {
  const { season } = useSeason();
  const [isMobile, setIsMobile] = useState(getIsMobileViewport);
  const { t } = useTranslation('home');
  const { language } = useLanguage();

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768 || 'ontouchstart' in window);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const leftMediaStyle = {
    minWidth: '100%',
    minHeight: '100%',
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    objectPosition: 'center 35%',
    transform: 'scale(1.35)',
    transformOrigin: 'center center'
  };
  const rightMediaStyle = {
    minWidth: '100%',
    minHeight: '100%',
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    transform: 'scale(1.1)',
    transformOrigin: 'center center'
  };

  if (!isMobile) {
    return (
      <Suspense fallback={<section className="relative w-full h-screen bg-black" aria-hidden />}>
        <DualityHeroDesktop />
      </Suspense>
    );
  }

  return (
    <section className="relative w-full overflow-hidden flex flex-col h-[100svh]">
      <HeroSeasonToggle position="bottom-center" />

      <div className="relative w-full flex-1 bg-black overflow-hidden border-b border-white/20">
        <div className="relative w-full h-full flex items-center justify-center">
          <HeroPane
            side="left"
            season={season}
            useVideo={false}
            videoRef={undefined}
            isPrimary
            mediaStyle={leftMediaStyle}
            sizes="100vw"
          />
          <div className="absolute inset-0 bg-black/40" />

          <div className="relative z-20 pointer-events-none text-center px-2">
            <h1 className="font-['Playfair_Display'] text-lg sm:text-xl text-white font-semibold tracking-tight leading-tight drop-shadow-2xl whitespace-nowrap">
              {t('hero.leftHeadline')}
            </h1>
            <a
              href={localizePath('/cabin', language)}
              className="inline-flex items-center gap-2 mt-2 text-xs uppercase tracking-widest border-b border-white/50 pb-1 text-white/80 hover:text-white transition-colors pointer-events-auto"
            >
              {t('hero.exploreCabin')}
            </a>
          </div>
        </div>
      </div>

      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-black/50 backdrop-blur text-[10px] text-white px-2 py-1 rounded-full border border-white/20 z-30 pointer-events-none">
        OR
      </div>

      <div className="relative w-full flex-1 bg-black overflow-hidden">
        <div className="relative w-full h-full">
          <HeroPane
            side="right"
            season={season}
            useVideo={false}
            videoRef={undefined}
            isPrimary={false}
            mediaStyle={rightMediaStyle}
            sizes="100vw"
          />
          <div className="absolute inset-0 bg-black/20" />

          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 pointer-events-none text-center px-2">
            <h2 className="font-['Playfair_Display'] text-lg sm:text-xl text-white font-semibold tracking-tight leading-tight drop-shadow-2xl whitespace-nowrap">
              {t('hero.rightHeadline')}
            </h2>
            <a
              href={localizePath('/valley', language)}
              className="inline-flex items-center gap-2 mt-2 text-xs uppercase tracking-widest border-b border-white/50 pb-1 text-white/80 hover:text-white transition-colors pointer-events-auto"
            >
              {t('hero.exploreValley')}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
};

export default DualityHero;
