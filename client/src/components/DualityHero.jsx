import { useState, useEffect, lazy, Suspense, useRef, useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';
import HeroSeasonToggle from './HeroSeasonToggle';
import { useSeason } from '../context/SeasonContext';
import { useLanguage } from '../context/LanguageContext.jsx';
import { localizePath } from '../utils/localizedRoutes';
import { getIsMobileViewport } from '../utils/viewport';
import HeroPane from './HeroPane';

const DualityHeroDesktop = lazy(() => import('./DualityHeroDesktop'));

/**
 * Stacked dual hero for small / touch viewports.
 * Matches Cabin / TheValley: responsive still first, then video when in view and allowed.
 */
function MobileDualityHeroStack() {
  const { season } = useSeason();
  const { t } = useTranslation('home');
  const { language } = useLanguage();
  const containerRef = useRef(null);
  const leftVideoRef = useRef(null);
  const rightVideoRef = useRef(null);
  const [shouldLoadMedia, setShouldLoadMedia] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [isLowBandwidth, setIsLowBandwidth] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateMotionPreference = (event) => {
      setPrefersReducedMotion(event.matches);
    };
    setPrefersReducedMotion(mediaQuery.matches);
    mediaQuery.addEventListener('change', updateMotionPreference);
    return () => mediaQuery.removeEventListener('change', updateMotionPreference);
  }, []);

  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!connection) return;

    const updateConnectionPreference = () => {
      const lowTypes = ['slow-2g', '2g'];
      setIsLowBandwidth(connection.saveData || lowTypes.includes(connection.effectiveType));
    };

    updateConnectionPreference();
    connection.addEventListener?.('change', updateConnectionPreference);
    return () => connection.removeEventListener?.('change', updateConnectionPreference);
  }, []);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (el) {
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            setShouldLoadMedia(true);
            observer.disconnect();
          }
        },
        { rootMargin: '200px' }
      );
      observer.observe(el);
      const fallback = setTimeout(() => setShouldLoadMedia(true), 200);
      return () => {
        observer.disconnect();
        clearTimeout(fallback);
      };
    }
    const fallback = setTimeout(() => setShouldLoadMedia(true), 200);
    return () => clearTimeout(fallback);
  }, []);

  const shouldPlayVideo = shouldLoadMedia && !prefersReducedMotion && !isLowBandwidth;

  useEffect(() => {
    if (!shouldPlayVideo) return;
    const playVideos = async () => {
      try {
        if (leftVideoRef.current) {
          await leftVideoRef.current.play();
        }
        if (rightVideoRef.current) {
          await rightVideoRef.current.play();
        }
      } catch (error) {
        if (import.meta.env.DEV) console.log('Video autoplay blocked, will play on interaction');
      }
    };
    playVideos();
  }, [shouldPlayVideo, season]);

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

  return (
    <section ref={containerRef} className="relative w-full overflow-hidden flex flex-col h-[100svh]">
      <HeroSeasonToggle position="bottom-center" />

      <div className="relative w-full flex-1 bg-black overflow-hidden border-b border-white/20">
        <div className="relative w-full h-full flex items-center justify-center">
          <HeroPane
            side="left"
            season={season}
            useVideo={shouldPlayVideo}
            videoRef={leftVideoRef}
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
            useVideo={shouldPlayVideo}
            videoRef={rightVideoRef}
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
}

const DualityHero = () => {
  const [isMobile, setIsMobile] = useState(getIsMobileViewport);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768 || 'ontouchstart' in window);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  if (!isMobile) {
    return (
      <Suspense fallback={<section className="relative w-full h-screen bg-black" aria-hidden />}>
        <DualityHeroDesktop />
      </Suspense>
    );
  }

  return <MobileDualityHeroStack />;
};

export default DualityHero;
