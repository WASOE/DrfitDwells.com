import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Sun } from 'lucide-react';
import SearchBar from './SearchBar';

const CABIN_VIDEO = '/uploads/Videos/Dark-fire-cabin.mp4';
const VALLEY_VIDEO = '/uploads/Videos/Light-aframes.mp4';
const CABIN_STILL = '/uploads/Videos/Dark-fire-cabin-poster.jpg';
const VALLEY_STILL = '/uploads/Videos/Light-aframes-poster.jpg';

const DualityHero = () => {
  const [hoveredPane, setHoveredPane] = useState(null); // 'left', 'right', or null
  const [isMobile, setIsMobile] = useState(false);
  const [shouldLoadMedia, setShouldLoadMedia] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [isLowBandwidth, setIsLowBandwidth] = useState(false);
  const leftVideoRef = useRef(null);
  const rightVideoRef = useRef(null);
  const containerRef = useRef(null);

  // Detect mobile device
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768 || 'ontouchstart' in window);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Get current time
  const getCurrentTime = () => {
    const now = new Date();
    return now.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: true 
    });
  };

  const [currentTime, setCurrentTime] = useState(getCurrentTime());

  // Update time every minute
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(getCurrentTime());
    }, 60000);
    return () => clearInterval(interval);
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

  // Lazy-load media only when hero is near viewport
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShouldLoadMedia(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const shouldPlayVideo = shouldLoadMedia && !prefersReducedMotion && !isLowBandwidth;

  const renderMediaLayer = (side) => {
    const isLeft = side === 'left';
    const videoRef = isLeft ? leftVideoRef : rightVideoRef;
    const videoSource = isLeft ? CABIN_VIDEO : VALLEY_VIDEO;
    const poster = isLeft ? CABIN_STILL : VALLEY_STILL;
    const altText = isLeft ? 'Cabin exterior' : 'Valley landscape';

    if (!shouldPlayVideo) {
      return (
        <img
          src={poster}
          alt={altText}
          className="absolute inset-0 w-full h-full object-cover"
          loading="lazy"
          decoding="async"
        />
      );
    }

    return (
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover"
        autoPlay
        loop
        muted
        playsInline
        preload="metadata"
        poster={poster}
        style={{
          minWidth: '100%',
          minHeight: '100%',
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: 'scale(1.1)',
          transformOrigin: 'center center'
        }}
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
        console.log('Video autoplay blocked, will play on interaction');
      }
    };
    playVideos();
  }, [shouldPlayVideo]);

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

  // Text animation variants
  const driftTextVariants = {
    idle: { scale: 1, opacity: 1 },
    hovered: { scale: 1.1, opacity: 1 },
    notHovered: { scale: 0.9, opacity: 0.6 }
  };

  const dwellTextVariants = {
    idle: { scale: 1, opacity: 1 },
    hovered: { scale: 1.1, opacity: 1 },
    notHovered: { scale: 0.9, opacity: 0.6 }
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
      className={`relative w-full overflow-hidden ${isMobile ? 'flex flex-col h-[100dvh]' : 'h-screen'}`}
    >
      {/* Live Atmosphere Widget - Hidden on mobile */}
      <div className="hidden md:flex absolute top-6 right-10 z-30 items-center gap-2 text-xs font-mono uppercase tracking-widest text-white/80 pointer-events-none">
        <Sun className="w-4 h-4" />
        <span className="whitespace-nowrap">1,550m • 12°C • {currentTime}</span>
      </div>

      {/* Mobile Layout: Flexible Split View */}
      {isMobile ? (
        <>
          {/* Top Pane - Cabin - flex-1 */}
          <div className="relative w-full flex-1 bg-black overflow-hidden border-b border-white/20">
            <div className="relative w-full h-full flex items-center justify-center">
                {renderMediaLayer('left')}
              <div className="absolute inset-0 bg-black/40" />
              
              {/* Text centered in top pane */}
              <div className="relative z-20 pointer-events-none text-center">
                <h2 className="font-['Playfair_Display'] text-2xl md:text-6xl text-white font-semibold tracking-tight leading-tight drop-shadow-lg px-4 whitespace-nowrap">
                  Dwell in the Silence.
                </h2>
                <a
                  href="/search?location=cabin"
                  className="inline-flex items-center gap-2 mt-2 text-xs uppercase tracking-widest border-b border-white/50 pb-1 text-white/80 hover:text-white transition-colors pointer-events-auto"
                >
                  Explore The Cabin
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
              
              {/* Text centered in bottom pane */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 pointer-events-none text-center">
                <h2 className="font-['Playfair_Display'] text-2xl md:text-6xl text-white font-semibold tracking-tight leading-tight drop-shadow-lg px-4 whitespace-nowrap">
                  Drift into the Wild.
                </h2>
                <a
                  href="/search?location=valley"
                  className="inline-flex items-center gap-2 mt-2 text-xs uppercase tracking-widest border-b border-white/50 pb-1 text-white/80 hover:text-white transition-colors pointer-events-auto"
                >
                  Explore The Valley
                </a>
              </div>
            </div>
          </div>

          {/* Spacer - Reserves space for Booking Bar */}
          <div className="h-[70px] w-full flex-none md:hidden" />
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
                    className="font-['Playfair_Display'] text-4xl lg:text-6xl xl:text-7xl text-white font-semibold tracking-tight leading-[1.1] drop-shadow-lg"
                    initial="idle"
                    animate={getLeftTextState()}
                    variants={dwellTextVariants}
                    transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                  >
                    Dwell in the Silence.
                  </motion.h2>
                  <a
                    href="/search?location=cabin"
                    className="inline-flex items-center gap-2 mt-6 text-xs uppercase tracking-widest border-b border-white/50 pb-1 text-white/80 hover:text-white transition-colors"
                  >
                    Explore The Cabin
                  </a>
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
                    className="font-['Playfair_Display'] text-4xl lg:text-6xl xl:text-7xl text-white font-semibold tracking-tight leading-[1.1] drop-shadow-lg"
                    initial="idle"
                    animate={getRightTextState()}
                    variants={driftTextVariants}
                    transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                  >
                    Drift into the Wild.
                  </motion.h2>
                  <a
                    href="/search?location=valley"
                    className="inline-flex items-center gap-2 mt-6 text-xs uppercase tracking-widest border-b border-white/50 pb-1 text-white/80 hover:text-white transition-colors"
                  >
                    Explore The Valley
                  </a>
              </div>
            </div>
          </motion.div>

          <div className="absolute bottom-8 lg:bottom-12 left-1/2 -translate-x-1/2 z-20 w-full max-w-5xl px-6 pointer-events-auto">
            <motion.div
              className="bg-white/40 border border-white/30 backdrop-blur-md rounded-full p-4 lg:p-6 shadow-[0_20px_50px_rgba(12,26,19,0.2)] transition-all duration-300 hover:bg-white/60 hover:border-white/80"
              whileHover={{ scale: 1.02 }}
              transition={{ type: 'spring', stiffness: 140, damping: 18 }}
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
