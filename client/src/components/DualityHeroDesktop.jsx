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
  const [hoveredPane, setHoveredPane] = useState(null);
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

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleMouseMove = (e) => {
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const width = rect.width;
      const threshold = width / 2;

      if (x < threshold - 10) {
        setHoveredPane('left');
      } else if (x > threshold + 10) {
        setHoveredPane('right');
      }
    };

    const handleMouseLeave = () => {
      setHoveredPane(null);
    };

    container.addEventListener('mousemove', handleMouseMove);
    container.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      container.removeEventListener('mousemove', handleMouseMove);
      container.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, []);

  const leftFlex = hoveredPane === 'left' ? 7 : hoveredPane === 'right' ? 3 : 5;
  const rightFlex = hoveredPane === 'right' ? 7 : hoveredPane === 'left' ? 3 : 5;

  const driftTextVariants = {
    idle: { opacity: 1, y: 0 },
    hovered: { opacity: 1, y: 0 },
    notHovered: { opacity: 0, y: -12, pointerEvents: 'none' }
  };

  const dwellTextVariants = {
    idle: { opacity: 1, y: 0 },
    hovered: { opacity: 1, y: 0 },
    notHovered: { opacity: 0, y: -12, pointerEvents: 'none' }
  };

  const getLeftTextState = () => {
    if (hoveredPane === null) return 'idle';
    return hoveredPane === 'left' ? 'hovered' : 'notHovered';
  };

  const getRightTextState = () => {
    if (hoveredPane === null) return 'idle';
    return hoveredPane === 'right' ? 'hovered' : 'notHovered';
  };

  return (
    <section ref={containerRef} className="relative w-full overflow-hidden h-screen">
      <HeroSeasonToggle position="below-menu" />

      <div className="flex w-full h-full">
        <div
          className="relative h-full z-10 bg-black overflow-hidden"
          style={{ flex: leftFlex, transition: 'flex 0.6s cubic-bezier(0.22,1,0.36,1)' }}
        >
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
              <motion.h1
                className="font-['Playfair_Display'] text-2xl sm:text-3xl md:text-4xl lg:text-5xl text-white font-semibold tracking-tight leading-tight drop-shadow-2xl"
                initial="idle"
                animate={getLeftTextState()}
                variants={dwellTextVariants}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              >
                {t('hero.leftHeadline')}
              </motion.h1>
              <motion.a
                href={localizePath('/cabin', language)}
                initial="idle"
                animate={getLeftTextState()}
                variants={dwellTextVariants}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                className="inline-flex items-center gap-2 mt-6 text-xs uppercase tracking-widest border-b border-white/50 pb-1 text-white/80 hover:text-white transition-colors"
              >
                {t('hero.exploreCabin')}
              </motion.a>
            </div>
          </div>
        </div>

        <div
          className="relative h-full z-10 bg-black overflow-hidden"
          style={{ flex: rightFlex, transition: 'flex 0.6s cubic-bezier(0.22,1,0.36,1)' }}
        >
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
              <motion.h2
                className="font-['Playfair_Display'] text-2xl sm:text-3xl md:text-4xl lg:text-5xl text-white font-semibold tracking-tight leading-tight drop-shadow-2xl whitespace-nowrap"
                initial="idle"
                animate={getRightTextState()}
                variants={driftTextVariants}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              >
                {t('hero.rightHeadline')}
              </motion.h2>
              <motion.a
                href={localizePath('/valley', language)}
                initial="idle"
                animate={getRightTextState()}
                variants={driftTextVariants}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                className="inline-flex items-center gap-2 mt-6 text-xs uppercase tracking-widest border-b border-white/50 pb-1 text-white/80 hover:text-white transition-colors"
              >
                {t('hero.exploreValley')}
              </motion.a>
            </div>
          </div>
        </div>
      </div>

      <div className="absolute bottom-8 lg:bottom-12 left-1/2 -translate-x-1/2 z-20 w-full max-w-4xl px-4 sm:px-6 pointer-events-auto">
        <motion.div className="bg-white/[0.07] border border-white/20 backdrop-blur-sm rounded-xl px-4 py-3 sm:px-5 sm:py-3.5 transition-colors duration-300 hover:bg-white/[0.09] hover:border-white/30">
          <Suspense
            fallback={
              <div
                className="h-12 sm:h-14 w-full rounded-lg bg-white/[0.06] border border-white/10"
                aria-hidden
              />
            }
          >
            <SearchBar buttonTheme="hero" variant="glass" />
          </Suspense>
        </motion.div>
      </div>
    </section>
  );
}
