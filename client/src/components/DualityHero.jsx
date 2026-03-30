import { useState, useEffect, lazy, Suspense, useRef, useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';
import HeroSeasonToggle from './HeroSeasonToggle';
import { useSeason } from '../context/SeasonContext';
import { useLanguage } from '../context/LanguageContext.jsx';
import { CABIN_MEDIA, VALLEY_MEDIA } from '../config/mediaConfig';
import { localizePath } from '../utils/localizedRoutes';
import { getIsMobileViewport } from '../utils/viewport';

const DualityHeroDesktop = lazy(() => import('./DualityHeroDesktop'));

const CABIN_VIDEOS = CABIN_MEDIA.heroVideo;
const CABIN_STILLS = CABIN_MEDIA.heroPoster;
const VALLEY_VIDEOS = {
  winter: VALLEY_MEDIA.heroVideo.winter,
  summer: VALLEY_MEDIA.altSummerPair.video
};
const VALLEY_STILLS = {
  winter: VALLEY_MEDIA.heroPoster.winter,
  summer: VALLEY_MEDIA.altSummerPair.poster
};

/**
 * One mobile pane: poster JPG always (immediate paint), video layered on top when allowed.
 * Video stays opacity-0 until `playing` so the still never flashes to an empty decoder.
 */
function MobileStackPaneMedia({ side, season, shouldPlayVideo, videoRef, poster, videoSource, altText, isPrimary, mediaStyle }) {
  const [videoRevealed, setVideoRevealed] = useState(false);

  useEffect(() => {
    setVideoRevealed(false);
  }, [season, shouldPlayVideo, side]);

  const setImgFetchPriorityRef = (el) => {
    if (!el) return;
    el.setAttribute('fetchpriority', isPrimary ? 'high' : 'low');
  };

  return (
    <>
      <img
        ref={setImgFetchPriorityRef}
        src={poster}
        alt={altText}
        className="absolute inset-0 z-0 w-full h-full object-cover"
        style={mediaStyle}
        loading={isPrimary ? 'eager' : 'lazy'}
        decoding="async"
      />
      {shouldPlayVideo ? (
        <video
          key={`${side}-${season}`}
          ref={videoRef}
          className={`absolute inset-0 z-[1] w-full h-full object-cover transition-opacity duration-200 motion-reduce:transition-none ${
            videoRevealed ? 'opacity-100' : 'opacity-0'
          }`}
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          poster={poster}
          style={mediaStyle}
          onPlaying={() => setVideoRevealed(true)}
        >
          <source src={videoSource} type="video/mp4" />
        </video>
      ) : null}
    </>
  );
}

/**
 * Stacked dual hero for small / touch viewports.
 * Desktop uses lazy DualityHeroDesktop + HeroPane.
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

    const tryPlay = (el) => {
      if (!el) return;
      const run = () => {
        el.muted = true;
        el.play().catch(() => {});
      };
      if (el.readyState >= 2) run();
      else {
        el.addEventListener('canplay', run, { once: true });
        el.addEventListener('loadeddata', run, { once: true });
      }
    };

    const id = requestAnimationFrame(() => {
      tryPlay(leftVideoRef.current);
      tryPlay(rightVideoRef.current);
    });
    return () => cancelAnimationFrame(id);
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
          <MobileStackPaneMedia
            side="left"
            season={season}
            shouldPlayVideo={shouldPlayVideo}
            videoRef={leftVideoRef}
            poster={CABIN_STILLS[season] ?? CABIN_STILLS.summer}
            videoSource={CABIN_VIDEOS[season] ?? CABIN_VIDEOS.summer}
            altText="Cabin exterior"
            isPrimary
            mediaStyle={leftMediaStyle}
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
          <MobileStackPaneMedia
            side="right"
            season={season}
            shouldPlayVideo={shouldPlayVideo}
            videoRef={rightVideoRef}
            poster={VALLEY_STILLS[season] ?? VALLEY_STILLS.summer}
            videoSource={VALLEY_VIDEOS[season] ?? VALLEY_VIDEOS.summer}
            altText="Valley landscape"
            isPrimary={false}
            mediaStyle={rightMediaStyle}
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
