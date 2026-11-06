import { useState, useEffect, useRef, Suspense, lazy } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import HeroSeasonToggle from './HeroSeasonToggle';
import { useSeason } from '../context/SeasonContext';
import { useLanguage } from '../context/LanguageContext.jsx';
import { localizePath } from '../utils/localizedRoutes';
import HeroPane from './HeroPane';

const SearchBar = lazy(() => import('./SearchBar'));

export default function DualityHeroDesktop() {
  const { season } = useSeason();
  const [rightPaneVideoOk, setRightPaneVideoOk] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [isLowBandwidth, setIsLowBandwidth] = useState(false);
  const leftVideoRef = useRef(null);
  const rightVideoRef = useRef(null);
  const containerRef = useRef(null);
  const { t } = useTranslation('home');
  const { language } = useLanguage();

  useEffect(() => {
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(() => setRightPaneVideoOk(true), { timeout: 2200 });
      return () => window.cancelIdleCallback(id);
    }
    const t = setTimeout(() => setRightPaneVideoOk(true), 2200);
    return () => clearTimeout(t);
  }, []);

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

  const baseVideoOk = !prefersReducedMotion && !isLowBandwidth;
  const videoAllowedForPane = (side) => {
    if (!baseVideoOk) return false;
    if (side === 'left') return true;
    return rightPaneVideoOk;
  };

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

  useEffect(() => {
    if (!baseVideoOk) return;
    const playVideos = async () => {
      try {
        if (leftVideoRef.current) await leftVideoRef.current.play();
        if (rightVideoRef.current) await rightVideoRef.current.play();
      } catch (error) {
        if (import.meta.env.DEV) console.log('Video autoplay blocked, will play on interaction');
      }
    };
    playVideos();
  }, [baseVideoOk, rightPaneVideoOk, season]);

  return (
    <section ref={containerRef} className="relative w-full overflow-hidden h-screen">
      <h1 className="absolute top-[calc(var(--header-offset,5.5rem)+4.15rem)] left-1/2 z-20 -translate-x-1/2 max-w-xl px-4 text-center text-[11px] sm:text-xs uppercase tracking-[0.22em] text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.65)]">
        {t('hero.kicker')}
      </h1>
      <HeroSeasonToggle position="below-menu" />

      <div className="flex w-full h-full">
        <div className="relative h-full z-10 min-w-0 flex-1 basis-1/2 bg-black overflow-hidden">
          <div className="relative w-full h-full">
            <HeroPane
              side="left"
              season={season}
              useVideo={videoAllowedForPane('left')}
              videoRef={leftVideoRef}
              isPrimary
              mediaStyle={leftMediaStyle}
              sizes="(max-width: 1279px) 50vw, 42vw"
            />
            <div className="absolute inset-0 bg-black/40" />

            <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4">
              <h2 className="font-['Playfair_Display'] text-2xl sm:text-3xl md:text-4xl lg:text-5xl text-white font-semibold tracking-tight leading-tight drop-shadow-2xl">
                {t('hero.leftHeadline')}
              </h2>
              <a
                href={localizePath('/cabin', language)}
                className="mt-5 max-w-xs text-sm md:text-base text-white leading-snug hover:underline underline-offset-4"
              >
                {t('hero.cabinLine')}
              </a>
            </div>
          </div>
        </div>

        <div className="relative h-full z-10 min-w-0 flex-1 basis-1/2 bg-black overflow-hidden">
          <div className="relative w-full h-full">
            <HeroPane
              side="right"
              season={season}
              useVideo={videoAllowedForPane('right')}
              videoRef={rightVideoRef}
              isPrimary={false}
              mediaStyle={rightMediaStyle}
              sizes="(max-width: 1279px) 50vw, 42vw"
            />
            <div className="absolute inset-0 bg-black/20" />

            <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4">
              <h2 className="font-['Playfair_Display'] text-2xl sm:text-3xl md:text-4xl lg:text-5xl text-white font-semibold tracking-tight leading-tight drop-shadow-2xl">
                {t('hero.rightHeadline')}
              </h2>
              <a
                href={localizePath('/valley', language)}
                className="mt-5 max-w-xs text-sm md:text-base text-white leading-snug hover:underline underline-offset-4"
              >
                {t('hero.valleyLine')}
              </a>
            </div>
          </div>
        </div>
      </div>

      <div className="absolute bottom-8 lg:bottom-12 left-1/2 -translate-x-1/2 z-20 w-full max-w-4xl px-4 sm:px-6 pointer-events-auto">
        <motion.div className="bg-[#F6F1E8] border border-[#E6E0D4] shadow-[0_18px_40px_rgba(12,10,9,0.45)] rounded-xl px-4 py-3 sm:px-5 sm:py-3.5">
          <Suspense
            fallback={
              <div
                className="h-12 sm:h-14 w-full rounded-lg bg-[#E7E1D6]"
                aria-hidden
              />
            }
          >
            <SearchBar buttonTheme="hero" />
          </Suspense>
        </motion.div>
      </div>
    </section>
  );
}
