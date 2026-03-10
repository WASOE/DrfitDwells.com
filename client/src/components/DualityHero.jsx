import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import SearchBar from './SearchBar';
import HeroSeasonToggle from './HeroSeasonToggle';
import { useSeason } from '../context/SeasonContext';
import { CABIN_MEDIA, VALLEY_MEDIA } from '../config/mediaConfig';

// Cabin hero media comes directly from canonical config:
// - winter video -> winter poster
// - summer video -> summer poster
const CABIN_VIDEOS = CABIN_MEDIA.heroVideo;
const CABIN_STILLS = CABIN_MEDIA.heroPoster;

// On the home hero we intentionally use a cinematic night-stars pair
// for the valley summer pane, while keeping the firaplace winter pair.
const VALLEY_VIDEOS = {
  winter: VALLEY_MEDIA.heroVideo.winter,
  summer: VALLEY_MEDIA.altSummerPair.video
};
const VALLEY_STILLS = {
  winter: VALLEY_MEDIA.heroPoster.winter,
  summer: VALLEY_MEDIA.altSummerPair.poster
};

const DualityHero = () => {
  const { season } = useSeason();
  const [hoveredPane, setHoveredPane] = useState(null); // 'left', 'right', or null
  const [isMobile, setIsMobile] = useState(false);
  const [shouldLoadMedia, setShouldLoadMedia] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [isLowBandwidth, setIsLowBandwidth] = useState(false);
  const leftVideoRef = useRef(null);
  const rightVideoRef = useRef(null);
  const containerRef = useRef(null);
  const { t } = useTranslation('home');

  // Detect mobile device
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768 || 'ontouchstart' in window);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Detect reduced motion preference
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

  // Detect low bandwidth / data saver
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

  // Load hero media when in view. useLayoutEffect so ref is set; fallback for mobile where IO can be unreliable.
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

  const renderMediaLayer = (side) => {
    const isLeft = side === 'left';
    const videoRef = isLeft ? leftVideoRef : rightVideoRef;
    const videoSource = isLeft ? CABIN_VIDEOS[season] : VALLEY_VIDEOS[season];
    const poster = isLeft ? CABIN_STILLS[season] : VALLEY_STILLS[season];
    const altText = isLeft ? 'Cabin exterior' : 'Valley landscape';

    // Left (cabin) pane is the primary hero on both mobile and desktop.
    const isPrimary = isLeft;

    // Cabin (left) video has letterboxing/black at top – anchor lower to crop it out, zoom in to fill
    const mediaStyle = isLeft
      ? {
          minWidth: '100%',
          minHeight: '100%',
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          objectPosition: 'center 35%',
          transform: 'scale(1.35)',
          transformOrigin: 'center center'
        }
      : {
          minWidth: '100%',
          minHeight: '100%',
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: 'scale(1.1)',
          transformOrigin: 'center center'
        };

    if (!shouldPlayVideo) {
      return (
        <img
          src={poster}
          alt={altText}
          className="absolute inset-0 w-full h-full object-cover"
          style={mediaStyle}
          loading={isPrimary ? 'eager' : 'lazy'}
          fetchpriority={isPrimary ? 'high' : 'auto'}
          decoding="async"
        />
      );
    }

    return (
      <video
        key={`${side}-${season}`}
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover"
        autoPlay
        loop
        muted
        playsInline
        preload="none"
        poster={poster}
        style={mediaStyle}
      >
        <source src={videoSource} type="video/mp4" />
      </video>
    );
  };

  // Ensure videos play when component mounts and allowed
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

  // Track mouse position for desktop hover
  useEffect(() => {
    if (isMobile) return; 

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
  }, [isMobile]);

  // Animation variants for panes - desktop only
  const leftPaneVariants = {
    idle: { width: '50%' },
    hovered: { width: '70%' },
    notHovered: { width: '30%' }
  };

  const rightPaneVariants = {
    idle: { width: '50%' },
    hovered: { width: '70%' },
    notHovered: { width: '30%' }
  };

  // Text animation variants - commit to choice: fade out non-active side
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

  // Get animation state for each pane
  const getLeftPaneState = () => {
    if (isMobile) return 'idle';
    if (hoveredPane === null) return 'idle';
    return hoveredPane === 'left' ? 'hovered' : 'notHovered';
  };

  const getRightPaneState = () => {
    if (isMobile) return 'idle';
    if (hoveredPane === null) return 'idle';
    return hoveredPane === 'right' ? 'hovered' : 'notHovered';
  };

  // Get text animation state
  const getLeftTextState = () => {
    if (isMobile) return 'idle';
    if (hoveredPane === null) return 'idle';
    return hoveredPane === 'left' ? 'hovered' : 'notHovered';
  };

  const getRightTextState = () => {
    if (isMobile) return 'idle';
    if (hoveredPane === null) return 'idle';
    return hoveredPane === 'right' ? 'hovered' : 'notHovered';
  };

  return (
    <section 
      ref={containerRef}
      className={`relative w-full overflow-hidden ${isMobile ? 'flex flex-col h-[100svh]' : 'h-screen'}`}
    >
      <HeroSeasonToggle position={isMobile ? 'bottom-center' : 'below-menu'} />

      {/* Mobile Layout: Flexible Split View */}
      {isMobile ? (
        <>
          {/* Top Pane - Cabin - flex-1 */}
          <div className="relative w-full flex-1 bg-black overflow-hidden border-b border-white/20">
            <div className="relative w-full h-full flex items-center justify-center">
                {renderMediaLayer('left')}
              <div className="absolute inset-0 bg-black/40" />
              
              {/* Text centered in top pane - one line, smaller so both EN and BG fit */}
              <div className="relative z-20 pointer-events-none text-center px-2">
                <h2 className="font-['Playfair_Display'] text-lg sm:text-xl text-white font-semibold tracking-tight leading-tight drop-shadow-2xl whitespace-nowrap">
                  {t('hero.leftHeadline')}
                </h2>
                <a
                  href="/cabin"
                  className="inline-flex items-center gap-2 mt-2 text-xs uppercase tracking-widest border-b border-white/50 pb-1 text-white/80 hover:text-white transition-colors pointer-events-auto"
                >
                  {t('hero.exploreCabin')}
                </a>
              </div>
            </div>
          </div>

          {/* 'OR' Badge - Centered between panes */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-black/50 backdrop-blur text-[10px] text-white px-2 py-1 rounded-full border border-white/20 z-30 pointer-events-none">
            OR
          </div>

          {/* Bottom Pane - Valley - flex-1 */}
          <div className="relative w-full flex-1 bg-black overflow-hidden">
            <div className="relative w-full h-full">
                {renderMediaLayer('right')}
              <div className="absolute inset-0 bg-black/20" />
              
              {/* Text centered in bottom pane - one line, smaller so both EN and BG fit */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 pointer-events-none text-center px-2">
                <h2 className="font-['Playfair_Display'] text-lg sm:text-xl text-white font-semibold tracking-tight leading-tight drop-shadow-2xl whitespace-nowrap">
                  {t('hero.rightHeadline')}
                </h2>
                <a
                  href="/valley"
                  className="inline-flex items-center gap-2 mt-2 text-xs uppercase tracking-widest border-b border-white/50 pb-1 text-white/80 hover:text-white transition-colors pointer-events-auto"
                >
                  {t('hero.exploreValley')}
                </a>
              </div>
            </div>
          </div>
        </>
      ) : (
        <>
          {/* Desktop Layout */}
          <motion.div
            className="absolute left-0 top-0 h-full z-10 bg-black overflow-hidden"
            initial="idle"
            animate={getLeftPaneState()}
            variants={leftPaneVariants}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="relative w-full h-full">
              {renderMediaLayer('left')}
              <div className="absolute inset-0 bg-black/40" />

              <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4">
                <motion.h2
                  className="font-['Playfair_Display'] text-2xl sm:text-3xl md:text-4xl lg:text-5xl text-white font-semibold tracking-tight leading-tight drop-shadow-2xl"
                  initial="idle"
                  animate={getLeftTextState()}
                  variants={dwellTextVariants}
                  transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                >
                  {t('hero.leftHeadline')}
                </motion.h2>
                <motion.a
                  href="/cabin"
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
          </motion.div>

          <motion.div
            className="absolute right-0 top-0 h-full z-10 bg-black overflow-hidden"
            initial="idle"
            animate={getRightPaneState()}
            variants={rightPaneVariants}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="relative w-full h-full">
                {renderMediaLayer('right')}
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
                    href="/valley"
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
          </motion.div>

          <div className="absolute bottom-8 lg:bottom-12 left-1/2 -translate-x-1/2 z-20 w-full max-w-4xl px-4 sm:px-6 pointer-events-auto">
            <motion.div
              className="bg-white/[0.07] border border-white/20 backdrop-blur-sm rounded-xl px-4 py-3 sm:px-5 sm:py-3.5 transition-colors duration-300 hover:bg-white/[0.09] hover:border-white/30"
            >
              <SearchBar buttonTheme="hero" variant="glass" />
            </motion.div>
          </div>
        </>
      )}
    </section>
  );
};

export default DualityHero;
