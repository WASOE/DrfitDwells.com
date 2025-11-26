import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import SearchBar from './SearchBar';
import { Sun } from 'lucide-react';

const DualityHero = () => {
  const [hoveredPane, setHoveredPane] = useState(null); // 'left', 'right', or null
  const [isMobile, setIsMobile] = useState(false);
  const [activePane, setActivePane] = useState(null); // For mobile tap interactions
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

  // Ensure videos play when component mounts
  useEffect(() => {
    const playVideos = async () => {
      try {
        if (leftVideoRef.current) {
          await leftVideoRef.current.play();
        }
        if (rightVideoRef.current) {
          await rightVideoRef.current.play();
        }
      } catch (error) {
        // Autoplay may be blocked, especially on mobile
        // User interaction will be required
        console.log('Video autoplay blocked, will play on interaction');
      }
    };
    playVideos();
  }, []);

  // Track mouse position for desktop hover
  useEffect(() => {
    if (isMobile) return; // Skip mouse tracking on mobile

    const container = containerRef.current;
    if (!container) return;

    const handleMouseMove = (e) => {
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const width = rect.width;
      const threshold = width / 2;

      // Determine which pane based on current mouse position
      // Use a small buffer to prevent flickering at the boundary
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

  // Handle touch/tap for mobile
  const handlePaneTap = (pane) => {
    if (!isMobile) return;
    
    // Toggle: if same pane is tapped, reset; otherwise, set active
    if (activePane === pane) {
      setActivePane(null);
    } else {
      setActivePane(pane);
      // Play video on tap if it wasn't playing
      if (pane === 'left' && leftVideoRef.current) {
        leftVideoRef.current.play().catch(() => {});
      } else if (pane === 'right' && rightVideoRef.current) {
        rightVideoRef.current.play().catch(() => {});
      }
    }
  };

  // Animation variants for panes
  const leftPaneVariants = {
    idle: { width: isMobile ? '50%' : '50%' },
    hovered: { width: isMobile ? '100%' : '70%' },
    notHovered: { width: isMobile ? '0%' : '30%' }
  };

  const rightPaneVariants = {
    idle: { width: isMobile ? '50%' : '50%' },
    hovered: { width: isMobile ? '100%' : '70%' },
    notHovered: { width: isMobile ? '0%' : '30%' }
  };

  // Text animation variants
  const driftTextVariants = {
    idle: { scale: 1, opacity: 1 },
    hovered: { scale: isMobile ? 1.05 : 1.1, opacity: 1 },
    notHovered: { scale: isMobile ? 0.95 : 0.9, opacity: isMobile ? 0.8 : 0.6 }
  };

  const dwellTextVariants = {
    idle: { scale: 1, opacity: 1 },
    hovered: { scale: isMobile ? 1.05 : 1.1, opacity: 1 },
    notHovered: { scale: isMobile ? 0.95 : 0.9, opacity: isMobile ? 0.8 : 0.6 }
  };

  // Get animation state for each pane
  const getLeftPaneState = () => {
    if (isMobile) {
      if (activePane === null) return 'idle';
      return activePane === 'left' ? 'hovered' : 'notHovered';
    }
    if (hoveredPane === null) return 'idle';
    return hoveredPane === 'left' ? 'hovered' : 'notHovered';
  };

  const getRightPaneState = () => {
    if (isMobile) {
      if (activePane === null) return 'idle';
      return activePane === 'right' ? 'hovered' : 'notHovered';
    }
    if (hoveredPane === null) return 'idle';
    return hoveredPane === 'right' ? 'hovered' : 'notHovered';
  };

  // Get text animation state
  const getLeftTextState = () => {
    if (isMobile) {
      if (activePane === null) return 'idle';
      return activePane === 'left' ? 'hovered' : 'notHovered';
    }
    if (hoveredPane === null) return 'idle';
    return hoveredPane === 'left' ? 'hovered' : 'notHovered';
  };

  const getRightTextState = () => {
    if (isMobile) {
      if (activePane === null) return 'idle';
      return activePane === 'right' ? 'hovered' : 'notHovered';
    }
    if (hoveredPane === null) return 'idle';
    return hoveredPane === 'right' ? 'hovered' : 'notHovered';
  };

  return (
    <section 
      ref={containerRef}
      className="relative h-screen w-full flex overflow-hidden"
    >
      {/* Live Atmosphere Widget - Top Right */}
      <div className="absolute top-4 right-4 sm:top-6 sm:right-6 md:right-10 z-30 flex items-center gap-1.5 sm:gap-2 text-[10px] sm:text-xs font-mono uppercase tracking-widest text-white/80 pointer-events-none">
        <Sun className="w-3 h-3 sm:w-4 sm:h-4" />
        <span className="whitespace-nowrap">1,550m • 12°C • {currentTime}</span>
      </div>

      {/* Left Pane - Dark Cabin Interior */}
      <motion.div
        className="absolute left-0 top-0 h-full z-10"
        initial="idle"
        animate={getLeftPaneState()}
        variants={leftPaneVariants}
        transition={{ duration: isMobile ? 0.5 : 0.6, ease: [0.22, 1, 0.36, 1] }}
        onClick={() => handlePaneTap('left')}
        onTouchStart={() => !isMobile && handlePaneTap('left')}
        style={{ cursor: isMobile ? 'pointer' : 'default' }}
      >
        <div className="relative w-full h-full overflow-hidden">
          {/* Video Background */}
          <video
            ref={leftVideoRef}
            className="absolute inset-0 w-full h-full object-cover"
            autoPlay
            loop
            muted
            playsInline
            preload="auto"
          >
            <source src="/uploads/Videos/Dark-fire-cabin.mp4" type="video/mp4" />
          </video>
          <div className="absolute inset-0 bg-black/40" />
          
          {/* "Dwell in the Silence" text overlay */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <motion.h2
              className="font-['Playfair_Display'] text-2xl sm:text-3xl md:text-4xl lg:text-6xl xl:text-7xl text-white font-semibold tracking-tight leading-[1.1] drop-shadow-lg text-center px-2 sm:px-4"
              initial="idle"
              animate={getLeftTextState()}
              variants={dwellTextVariants}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            >
              Dwell in the Silence.
            </motion.h2>
          </div>
        </div>
      </motion.div>

      {/* Right Pane - Sunny Valley Meadow */}
      <motion.div
        className="absolute right-0 top-0 h-full z-10"
        initial="idle"
        animate={getRightPaneState()}
        variants={rightPaneVariants}
        transition={{ duration: isMobile ? 0.5 : 0.6, ease: [0.22, 1, 0.36, 1] }}
        onClick={() => handlePaneTap('right')}
        onTouchStart={() => !isMobile && handlePaneTap('right')}
        style={{ cursor: isMobile ? 'pointer' : 'default' }}
      >
        <div className="relative w-full h-full overflow-hidden">
          {/* Video Background */}
          <video
            ref={rightVideoRef}
            className="absolute inset-0 w-full h-full object-cover"
            autoPlay
            loop
            muted
            playsInline
            preload="auto"
          >
            <source src="/uploads/Videos/Light-aframes.mp4" type="video/mp4" />
          </video>
          <div className="absolute inset-0 bg-black/20" />
          
          {/* "Drift into the Wild" text overlay */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <motion.h2
              className="font-['Playfair_Display'] text-2xl sm:text-3xl md:text-4xl lg:text-6xl xl:text-7xl text-white font-semibold tracking-tight leading-[1.1] drop-shadow-lg text-center px-2 sm:px-4"
              initial="idle"
              animate={getRightTextState()}
              variants={driftTextVariants}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            >
              Drift into the Wild.
            </motion.h2>
          </div>
        </div>
      </motion.div>

      {/* SearchBar - Floating at bottom, centered, spanning both panes */}
      <div className="absolute bottom-4 sm:bottom-6 md:bottom-8 lg:bottom-12 left-1/2 -translate-x-1/2 z-20 w-full max-w-5xl px-3 sm:px-4 md:px-6 pointer-events-auto">
        <motion.div
          className="bg-white/40 border border-white/30 backdrop-blur-md rounded-xl sm:rounded-2xl md:rounded-full p-2.5 sm:p-3 md:p-4 lg:p-6 shadow-[0_20px_50px_rgba(12,26,19,0.2)] transition-all duration-300 hover:bg-white/60 hover:border-white/80"
          whileHover={!isMobile ? { scale: 1.02 } : {}}
          whileTap={isMobile ? { scale: 0.98 } : {}}
          transition={{ type: 'spring', stiffness: 140, damping: 18 }}
        >
          <SearchBar buttonTheme="hero" variant="glass" />
        </motion.div>
      </div>
    </section>
  );
};

export default DualityHero;
