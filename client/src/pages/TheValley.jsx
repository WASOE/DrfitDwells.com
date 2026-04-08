import { useRef, useEffect, useLayoutEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence, useInView } from 'framer-motion';
import { ChevronDown, MapPin, Mountain, Home, Flame, Trees, Sparkles } from 'lucide-react';
import { locations } from '../data/content';
import { useBookingSearch } from '../context/BookingSearchContext';
import AuthorityStrip from '../components/AuthorityStrip';
import HeroSeasonToggle from '../components/HeroSeasonToggle';
import { useSeason } from '../context/SeasonContext';
import { getSEOAlt, getSEOTitle } from '../data/imageMetadata';
import { VALLEY_MEDIA } from '../config/mediaConfig';
import '../i18n/ns/valley';

const VALLEY_VIDEOS = VALLEY_MEDIA.heroVideo;
const VALLEY_STILLS = VALLEY_MEDIA.heroPoster;

const TheValley = () => {
  const { t } = useTranslation('valley');
  const valley = locations.find(loc => loc.id === 'valley');
  const { season } = useSeason();
  const { openModal } = useBookingSearch();
  const heroRef = useRef(null);
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const accommodationsRef = useRef(null);
  const galleryRef = useRef(null);
  const [shouldLoadMedia, setShouldLoadMedia] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [isLowBandwidth, setIsLowBandwidth] = useState(false);
  const [_activeTab, setActiveTab] = useState('drifters');
  const [hoveredHotspot, setHoveredHotspot] = useState(null);
  const [mapImageLoaded, setMapImageLoaded] = useState(false);
  const [mapImageError, setMapImageError] = useState(false);
  const [videoLoaded, setVideoLoaded] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [showImage, setShowImage] = useState(false);
  const [mapImageSize, setMapImageSize] = useState({ w: 0, h: 0 });
  const mapVideoRef = useRef(null);
  const svgRef = useRef(null);


  const _accommodationsInView = useInView(accommodationsRef, { once: true, margin: '-100px' });
  const trustBadgesRef = useRef(null);
  const _trustBadgesInView = useInView(trustBadgesRef, { once: true, margin: '-50px' });
  const aylyakRef = useRef(null);
  const _aylyakInView = useInView(aylyakRef, { once: true, margin: '-200px' });

  // Smooth scroll to section
  const scrollToAccommodations = () => {
    accommodationsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Handle map pin click - scroll to accommodations and activate tab
  const handleMapPinClick = (tabId) => {
    setActiveTab(tabId);
    setTimeout(() => {
      accommodationsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  };

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

  // Ensure video plays when component mounts and allowed
  useEffect(() => {
    if (!shouldPlayVideo) return;
    const playVideo = async () => {
      try {
        if (videoRef.current) {
          await videoRef.current.play();
        }
      } catch (error) {
        if (import.meta.env.DEV) console.log('Video autoplay blocked, will play on interaction');
      }
    };
    playVideo();
  }, [shouldPlayVideo, season]);

  if (!valley) {
    return (
      <div className="min-h-screen bg-[#121212] flex items-center justify-center">
        <p className="text-white">{t('errors.valleyNotFound')}</p>
      </div>
    );
  }

  // Noise texture SVG data URL
  const noiseTexture = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120' viewBox='0 0 120 120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)' opacity='0.05'/%3E%3C/svg%3E";

  // Grain overlay texture
  const grainOverlay = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='grain'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23grain)'/%3E%3C/svg%3E";

  return (
    <>
      <div 
        className="relative text-white valley-theme"
        style={{ 
          background: 'radial-gradient(ellipse at center, #2a2a2a 0%, #1f2328 50%, #1a1e22 100%)',
          backgroundImage: `url("${noiseTexture}")`, 
          backgroundRepeat: 'repeat',
          minHeight: '100vh'
        }}
      >
        {/* Enhanced Grain Overlay */}
        <div 
          className="fixed inset-0 pointer-events-none opacity-[0.02] z-50"
          style={{
            backgroundImage: `url("${grainOverlay}")`,
            backgroundRepeat: 'repeat'
          }}
        />
        
        {/* Forest Dusk Warmth - Subtle green tint */}
        <div className="fixed inset-0 pointer-events-none z-40">
          <div className="absolute top-1/4 left-1/4 w-[600px] h-[600px] bg-[#81887A]/3 rounded-full blur-3xl" />
          <div className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] bg-amber-500/4 rounded-full blur-3xl" />
        </div>
        
        {/* ===========================================
            SECTION 1: HERO - "THE ROOF OF THE BALKANS"
            =========================================== */}
        <section 
          ref={containerRef}
          className="relative h-screen flex items-center justify-center overflow-hidden"
        >
          <motion.div
            ref={heroRef}
            className="absolute inset-0"
          >
            {!shouldPlayVideo ? (
              <img
                src={VALLEY_STILLS[season]}
                alt={getSEOAlt(VALLEY_STILLS[season]) || 'The Valley: A Village Above the Clouds - Mountain village at 1,550m altitude showing A-frames, stone house, and mountain landscape, Chereshovo/Ortsevo, Rhodope Mountains, Bulgaria'}
                title={getSEOTitle(VALLEY_STILLS[season]) || 'The Valley - A Village Above the Clouds at 1,550m Altitude'}
                className="absolute inset-0 w-full h-full object-cover"
                loading="lazy"
                decoding="async"
                style={{
                  minWidth: '100%',
                  minHeight: '100%',
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  transform: 'scale(1.2)',
                  transformOrigin: 'center center'
                }}
              />
            ) : (
              <video
                key={season}
                ref={videoRef}
                className="absolute inset-0 w-full h-full object-cover"
                autoPlay
                loop
                muted
                playsInline
                preload="metadata"
                poster={VALLEY_STILLS[season]}
                aria-label="Video showing The Valley mountain village with fireplace and mountain landscape at 1,550m altitude, Chereshovo/Ortsevo, Rhodope Mountains, Bulgaria"
                style={{
                  minWidth: '100%',
                  minHeight: '100%',
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  transform: 'scale(1.2)',
                  transformOrigin: 'center center'
                }}
              >
                <source src={VALLEY_VIDEOS[season]} type="video/mp4" />
              </video>
            )}
          </motion.div>
          
          {/* Overlay - Improved gradient for readability */}
          <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/40 to-black/60" />

          <HeroSeasonToggle />
          
          {/* 1,550m Altitude Badge - Top Right (hidden on mobile) */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, delay: 0.5 }}
            className="absolute top-8 right-4 md:top-12 md:right-12 z-20 hidden md:block"
          >
            <div className="px-4 py-2 bg-white/10 backdrop-blur-md border border-white/20 text-white text-sm md:text-base font-serif tracking-wide">
              {t('hero.altitudeBadge')}
            </div>
          </motion.div>
          
          {/* Content */}
          <div className="relative z-10 text-center px-4 max-w-4xl mx-auto">
            <motion.h1 
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.2 }}
              className="font-serif italic font-thin text-5xl md:text-7xl lg:text-8xl text-white tracking-tight leading-tight drop-shadow-[0_4px_12px_rgba(0,0,0,0.8)] mb-4"
            >
              {t('hero.heroTitle')}
            </motion.h1>
              
            <motion.p 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.3 }}
              className="mt-3 text-base md:text-lg text-neutral-400 max-w-2xl mx-auto font-light drop-shadow-sm"
            >
              {t('hero.heroLead')}
            </motion.p>
              
            <motion.p 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.35 }}
              className="mt-4 text-sm md:text-base text-neutral-400 max-w-2xl mx-auto font-light drop-shadow-sm"
            >
              {t('hero.body2')}
            </motion.p>
              
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.4 }}
              className="flex flex-col sm:flex-row gap-4 justify-center items-center mt-8 px-4"
            >
              <button
                onClick={openModal}
                className="bg-white text-stone-900 px-6 sm:px-8 py-3 sm:py-4 font-bold uppercase tracking-[0.3em] text-xs sm:text-sm hover:scale-105 transition-transform shadow-xl border-none rounded-full min-h-[44px] touch-manipulation"
              >
                {t('hero.ctaPrimary')}
              </button>
              <button
                onClick={scrollToAccommodations}
                className="border border-white/30 text-white px-6 sm:px-8 py-3 sm:py-4 font-medium uppercase tracking-[0.3em] text-xs sm:text-sm hover:bg-white/10 transition-all backdrop-blur-sm rounded-full min-h-[44px] touch-manipulation"
              >
                {t('hero.ctaSecondary')}
              </button>
              <button
                onClick={() => {
                  const mapSection = document.querySelector('[id*="lay"], [id*="map"]') || document.querySelector('section:nth-of-type(3)');
                  mapSection?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
                className="border border-white/30 text-white px-6 sm:px-8 py-3 sm:py-4 font-medium uppercase tracking-[0.3em] text-xs sm:text-sm hover:bg-white/10 transition-all backdrop-blur-sm rounded-full min-h-[44px] touch-manipulation"
              >
                {t('hero.ctaExploreLayout')}
              </button>
            </motion.div>
            
            {/* Trust Chips */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.6 }}
              className="flex flex-wrap justify-center gap-3 mt-8 px-4"
            >
              <div className="px-4 py-2 bg-white/10 backdrop-blur-md border border-white/20 text-white text-xs md:text-sm font-light tracking-wide rounded-full">
                {t('hero.chipAboveClouds')}
              </div>
              <div className="px-4 py-2 bg-white/10 backdrop-blur-md border border-white/20 text-white text-xs md:text-sm font-light tracking-wide rounded-full">
                {t('hero.chipOffGridComfort')}
              </div>
              <div className="px-4 py-2 bg-white/10 backdrop-blur-md border border-white/20 text-white text-xs md:text-sm font-light tracking-wide rounded-full">
                {t('hero.chipPrivateValley')}
              </div>
            </motion.div>
          </div>

          {/* Scroll Indicator */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1, delay: 1.2 }}
            className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-2"
          >
            <motion.div
              animate={{ y: [0, 8, 0] }}
              transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
            >
              <ChevronDown className="w-6 h-6 text-white/60" />
            </motion.div>
          </motion.div>
        </section>

        {/* ===========================================
            SECTION 2: STORY + HIGHLIGHTS
            =========================================== */}
        <section className="relative py-24 md:py-32 border-t border-white/5">
          <div className="max-w-7xl mx-auto px-4 md:px-6">
            {/* Lighter surface panel card */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8 }}
              className="bg-[#2f2f2f] border border-white/15 rounded-2xl p-8 md:p-12 lg:p-16 shadow-xl"
            >
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 md:gap-12">
                {/* Left: Story */}
                <div className="flex flex-col justify-center">
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
                    transition={{ duration: 0.8 }}
                    className="text-lg md:text-xl text-neutral-100 leading-relaxed font-serif max-w-[65ch]"
                    style={{ lineHeight: '1.75' }}
            >
                    {t('editorial.storyLong')}
            </motion.p>
                </div>

                {/* Right: Highlights */}
                <div className="flex flex-col justify-center">
                  <div className="space-y-6">
                    {/* Altitude and views */}
                    <motion.div
                      initial={{ opacity: 0, x: 20 }}
                      whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
                      transition={{ duration: 0.6, delay: 0.1 }}
                      className="flex items-start gap-4"
                    >
                      <div className="flex-shrink-0 mt-1">
                        <Mountain className="w-6 h-6 text-[#81887A]" strokeWidth={1.5} />
                      </div>
                      <div>
                        <h3 className="text-base md:text-lg font-medium text-white mb-1">{t('editorial.highlights.altitude.title')}</h3>
                        <p className="text-sm md:text-base text-neutral-300 leading-relaxed">{t('editorial.highlights.altitude.text')}</p>
                      </div>
                    </motion.div>

                    {/* Fire, hot tub, stargazing */}
                    <motion.div
                      initial={{ opacity: 0, x: 20 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      viewport={{ once: true }}
                      transition={{ duration: 0.6, delay: 0.2 }}
                      className="flex items-start gap-4"
            >
                      <div className="flex-shrink-0 mt-1">
                        <Flame className="w-6 h-6 text-[#81887A]" strokeWidth={1.5} />
                      </div>
                      <div>
                        <h3 className="text-base md:text-lg font-medium text-white mb-1">{t('editorial.highlights.fire.title')}</h3>
                        <p className="text-sm md:text-base text-neutral-300 leading-relaxed">{t('editorial.highlights.fire.text')}</p>
                      </div>
                    </motion.div>

                    {/* Adventure base */}
                    <motion.div
                      initial={{ opacity: 0, x: 20 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      viewport={{ once: true }}
                      transition={{ duration: 0.6, delay: 0.3 }}
                      className="flex items-start gap-4"
                    >
                      <div className="flex-shrink-0 mt-1">
                        <Trees className="w-6 h-6 text-[#81887A]" strokeWidth={1.5} />
                      </div>
                      <div>
                        <h3 className="text-base md:text-lg font-medium text-white mb-1">{t('editorial.highlights.adventure.title')}</h3>
                        <p className="text-sm md:text-base text-neutral-300 leading-relaxed">{t('editorial.highlights.adventure.text')}</p>
                      </div>
                    </motion.div>

                    {/* Quiet, privacy, nature */}
                    <motion.div
                      initial={{ opacity: 0, x: 20 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      viewport={{ once: true }}
                      transition={{ duration: 0.6, delay: 0.4 }}
                      className="flex items-start gap-4"
                    >
                      <div className="flex-shrink-0 mt-1">
                        <Sparkles className="w-6 h-6 text-[#81887A]" strokeWidth={1.5} />
                      </div>
                      <div>
                        <h3 className="text-base md:text-lg font-medium text-white mb-1">{t('editorial.highlights.quiet.title')}</h3>
                        <p className="text-sm md:text-base text-neutral-300 leading-relaxed">{t('editorial.highlights.quiet.text')}</p>
                      </div>
                    </motion.div>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </section>

        {/* ===========================================
            SECTION 3A: THE VILLAGE MAP
            (Interactive Image Interface - Lay of the Land)
            =========================================== */}
        <section 
          className="relative pt-12 md:pt-16 pb-24 md:pb-32 border-t border-white/5"
        >
          <div className="max-w-7xl mx-auto px-4 md:px-6">
            <div className="text-center mb-12 md:mb-16">
              <h2 className="font-serif italic font-thin text-5xl md:text-7xl text-neutral-200 mb-4">
                {t('map.title')}
              </h2>
              <p className="text-sm md:text-base text-neutral-300 uppercase tracking-widest">
                {t('map.subtitle')}
              </p>
            </div>

            {/* Map Container with Video and SVG Overlay - Framed Card */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8 }}
              className="relative w-full max-w-7xl mx-auto mb-12 md:mb-16"
            >
              <div className="bg-[#2f2f2f] border border-white/15 rounded-2xl p-4 md:p-6 shadow-xl">
                <div className="relative w-full rounded-xl overflow-hidden bg-[#1f2328]">
                {/* Image dimensions: 2752 x 1536 pixels */}
                {mapImageSize.w === 0 && (
                  <img
                    src="/uploads/Content%20website/SKy-view-Aframe.jpg"
                    alt={getSEOAlt('/uploads/Content website/SKy-view-Aframe.jpg') || 'Aerial drone view of The Valley showing multiple A-frame cabins, village layout, paths, and mountain landscape at 1,550m altitude, Rhodope Mountains, Bulgaria'}
                    title={getSEOTitle('/uploads/Content website/SKy-view-Aframe.jpg') || 'Aerial View of The Valley - A-Frame Village Layout'}
                    className="hidden"
                    onLoad={(e) => {
                      const img = e.currentTarget;
                      // Verify dimensions match: should be 2752 x 1536
                      setMapImageSize({ w: img.naturalWidth, h: img.naturalHeight });
                      setMapImageLoaded(true);
                    }}
                    onError={(e) => {
                      const src = e.target.src;
                      const basePath = '/uploads/Content%20website/SKy-view-Aframe';
                      const extensions = ['.jpg', '.jpeg', '.png', '.avif', '.webp'];
                      const currentExt = extensions.find(ext => src.includes(ext)) || '.jpg';
                      const currentIndex = extensions.indexOf(currentExt);
                      
                      if (currentIndex < extensions.length - 1) {
                        e.target.src = basePath + extensions[currentIndex + 1];
                      } else {
                        setMapImageError(true);
                      }
                    }}
                  />
                )}
                
                {/* Video - Autoplay when available */}
                {!videoError && !showImage && (
                  <video
                    ref={mapVideoRef}
                    src="/uploads/Videos/The-Valley-From-the-Sky.mp4"
                    poster="/uploads/Content%20website/SKy-view-Aframe.jpg"
                    className="w-full h-auto block rounded-xl"
                    autoPlay
                    muted
                    playsInline
                    onLoadedData={() => {
                      setVideoLoaded(true);
                    }}
                    onError={() => {
                      setVideoError(true);
                      setShowImage(true);
                    }}
                    onEnded={() => {
                      setShowImage(true);
                    }}
                  />
                )}
                
                {/* Single SVG with embedded image and pins - Shows after video or as fallback */}
                {mapImageSize.w > 0 && mapImageSize.h > 0 && (showImage || !videoLoaded || videoError) && !mapImageError && (
                  <svg
                    ref={svgRef}
                    viewBox={`0 0 ${mapImageSize.w} ${mapImageSize.h}`}
                    className="w-full h-auto block rounded-xl"
                    preserveAspectRatio="xMidYMid meet"
                  >
                    {/* Embedded raster map image */}
                    <image
                      href="/uploads/Content%20website/SKy-view-Aframe.jpg"
                      x="0"
                      y="0"
                      width={mapImageSize.w}
                      height={mapImageSize.h}
                      preserveAspectRatio="none"
                    />
                    
                    {/* Interactive Pins */}
                    {[
                      { id: 'drifters', x: 644, y: 804, label: 'The Drifters', subtitle: '13 Geometric Cocoons', tabId: 'drifters' },
                      { id: 'swing', x: 1205, y: 60, label: 'Panoramic Swing', subtitle: 'Overlook the valley', tabId: null },
                      { id: 'fire', x: 1679, y: 527, label: 'Fireplace', subtitle: 'Gather around the fire', tabId: null },
                      { id: 'stone', x: 1701, y: 764, label: 'The Stone House', subtitle: 'Starlink & Community', tabId: 'stone' },
                      { id: 'lux', x: 2353, y: 1360, label: 'Lux Cabin', subtitle: 'Secluded Vantage Point', tabId: 'lux' },
                    ].map((pin) => (
                      <g 
                        key={pin.id}
                        className="hidden md:block cursor-pointer"
                        onMouseEnter={() => setHoveredHotspot(pin.id)}
                        onMouseLeave={() => setHoveredHotspot(null)}
                        onClick={() => {
                          if (pin.tabId) {
                            handleMapPinClick(pin.tabId);
                          }
                        }}
                      >
                        {/* Pulsing Beacon Circle */}
                        <circle
                          cx={pin.x}
                          cy={pin.y}
                          r="8"
                          fill="white"
                        />
                        <circle
                          cx={pin.x}
                          cy={pin.y}
                          r="8"
                          fill="white"
                          opacity="0.75"
                        >
                          <animate
                            attributeName="r"
                            values="8;16;8"
                            dur="2s"
                            repeatCount="indefinite"
                          />
                          <animate
                            attributeName="opacity"
                            values="0.75;0;0.75"
                            dur="2s"
                            repeatCount="indefinite"
                          />
                        </circle>
                      </g>
                    ))}
                  </svg>
                )}
                
                {/* Tooltip Cards - Positioned absolutely relative to container */}
                {mapImageSize.w > 0 && mapImageSize.h > 0 && (mapImageLoaded || showImage) && !mapImageError && (
                  <div className="hidden md:block absolute inset-0 pointer-events-none">
                    <AnimatePresence>
                      {hoveredHotspot === 'drifters' && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.8, y: 10 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.8, y: 10 }}
                          transition={{ duration: 0.2 }}
                          className="absolute z-30 pointer-events-none"
                          style={{
                            left: `${(644 / mapImageSize.w) * 100}%`,
                            top: `${(804 / mapImageSize.h) * 100}%`,
                            transform: 'translate(-50%, calc(-100% - 20px))'
                          }}
                        >
                          <div className="bg-black/80 backdrop-blur-md border border-white/20 rounded-lg p-4 shadow-2xl w-64">
                            <h3 className="font-serif italic font-light text-xl text-neutral-400 mb-2">{t('map.hotspots.drifters.title')}</h3>
                            <p className="text-sm text-neutral-400 leading-relaxed">
                              {t('map.hotspots.drifters.body')}
                            </p>
                          </div>
                          <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 w-0 h-0 border-l-8 border-r-8 border-t-8 border-transparent border-t-black/80" />
                        </motion.div>
                      )}
                      {hoveredHotspot === 'swing' && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.8, y: 10 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.8, y: 10 }}
                          transition={{ duration: 0.2 }}
                          className="absolute z-30 pointer-events-none"
                          style={{
                            left: `${(1205 / mapImageSize.w) * 100}%`,
                            top: `${(60 / mapImageSize.h) * 100}%`,
                            transform: 'translate(-50%, calc(-100% - 20px))'
                          }}
                        >
                          <div className="bg-black/80 backdrop-blur-md border border-white/20 rounded-lg p-4 shadow-2xl w-64">
                            <h3 className="font-serif italic font-light text-xl text-neutral-400 mb-2">{t('map.hotspots.swing.title')}</h3>
                            <p className="text-sm text-neutral-400 leading-relaxed">
                              {t('map.hotspots.swing.body')}
                            </p>
                          </div>
                          <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 w-0 h-0 border-l-8 border-r-8 border-t-8 border-transparent border-t-black/80" />
                        </motion.div>
                      )}
                      {hoveredHotspot === 'fire' && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.8, y: 10 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.8, y: 10 }}
                          transition={{ duration: 0.2 }}
                          className="absolute z-30 pointer-events-none"
                          style={{
                            left: `${(1679 / mapImageSize.w) * 100}%`,
                            top: `${(527 / mapImageSize.h) * 100}%`,
                            transform: 'translate(-50%, calc(-100% - 20px))'
                          }}
                        >
                          <div className="bg-black/80 backdrop-blur-md border border-white/20 rounded-lg p-4 shadow-2xl w-64">
                            <h3 className="font-serif italic font-light text-xl text-neutral-400 mb-2">{t('map.hotspots.fire.title')}</h3>
                            <p className="text-sm text-neutral-400 leading-relaxed">
                              {t('map.hotspots.fire.body')}
                            </p>
                          </div>
                          <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 w-0 h-0 border-l-8 border-r-8 border-t-8 border-transparent border-t-black/80" />
                        </motion.div>
                      )}
                      {hoveredHotspot === 'stone' && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.8, y: 10 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.8, y: 10 }}
                          transition={{ duration: 0.2 }}
                          className="absolute z-30 pointer-events-none"
                          style={{
                            left: `${(1701 / mapImageSize.w) * 100}%`,
                            top: `${(764 / mapImageSize.h) * 100}%`,
                            transform: 'translate(-50%, calc(-100% - 20px))'
                          }}
                        >
                          <div className="bg-black/80 backdrop-blur-md border border-white/20 rounded-lg p-4 shadow-2xl w-64">
                            <h3 className="font-serif italic font-light text-xl text-neutral-400 mb-2">{t('map.hotspots.stone.title')}</h3>
                            <p className="text-sm text-neutral-400 leading-relaxed">
                              {t('map.hotspots.stone.body')}
                            </p>
                          </div>
                          <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 w-0 h-0 border-l-8 border-r-8 border-t-8 border-transparent border-t-black/80" />
                        </motion.div>
                      )}
                      {hoveredHotspot === 'lux' && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.8, y: 10 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.8, y: 10 }}
                          transition={{ duration: 0.2 }}
                          className="absolute z-30 pointer-events-none"
                          style={{
                            left: `${(2353 / mapImageSize.w) * 100}%`,
                            top: `${(1360 / mapImageSize.h) * 100}%`,
                            transform: 'translate(-50%, calc(-100% - 20px))'
                          }}
                        >
                          <div className="bg-black/80 backdrop-blur-md border border-white/20 rounded-lg p-4 shadow-2xl w-64">
                            <h3 className="font-serif italic font-light text-xl text-neutral-400 mb-2">{t('map.hotspots.lux.title')}</h3>
                            <p className="text-sm text-neutral-400 leading-relaxed">
                              {t('map.hotspots.lux.body')}
                            </p>
                          </div>
                          <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 w-0 h-0 border-l-8 border-r-8 border-t-8 border-transparent border-t-black/80" />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}
              </div>
                {/* Caption */}
                <p className="mt-4 text-sm md:text-base text-neutral-300 text-center font-serif italic">
                  {t('map.aerialCaption')}
                </p>
            </div>
            </motion.div>
            
            {/* Location Callout Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-12 max-w-7xl mx-auto">
              {/* Stone House Callout */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
                transition={{ duration: 0.6, delay: 0.1 }}
                className="bg-[#2f2f2f] border border-white/15 rounded-xl p-6 shadow-lg hover:border-[#81887A]/40 transition-colors"
            >
                <h3 className="font-serif italic font-thin text-2xl md:text-3xl text-white mb-4">{t('stays.cards.stone-house.title')}</h3>
                <div className="space-y-2 text-neutral-300">
                  <p className="text-base font-medium">{t('stays.labels.sleeps')} {t('stays.cards.stone-house.sleeps')}</p>
                  <p className="text-sm text-neutral-400">{t('stays.labels.bestFor')} {t('stays.bestFor.stoneHouse')}</p>
                  <p className="text-sm text-neutral-300 pt-2 border-t border-white/10">{(t('stays.cards.stone-house.bullets', { returnObjects: true }) || [])[0]}</p>
                </div>
            </motion.div>

              {/* A-Frames Callout */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: 0.2 }}
                className="bg-[#2f2f2f] border border-white/15 rounded-xl p-6 shadow-lg hover:border-[#81887A]/40 transition-colors"
              >
                <h3 className="font-serif italic font-thin text-2xl md:text-3xl text-white mb-4">{t('stays.cards.a-frames.title')}</h3>
                <div className="space-y-2 text-neutral-300">
                  <p className="text-base font-medium">{t('stays.labels.sleeps')} {t('stays.cards.a-frames.sleeps')}</p>
                  <p className="text-sm text-neutral-400">{t('stays.labels.bestFor')} {t('stays.bestFor.aFrames')}</p>
                  <p className="text-sm text-neutral-300 pt-2 border-t border-white/10">{(t('stays.cards.a-frames.bullets', { returnObjects: true }) || [])[0]}</p>
                </div>
              </motion.div>

              {/* Luxury Cabin Callout */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: 0.3 }}
                className="bg-[#2f2f2f] border border-white/15 rounded-xl p-6 shadow-lg hover:border-[#81887A]/40 transition-colors"
              >
                <h3 className="font-serif italic font-thin text-2xl md:text-3xl text-white mb-4">{t('stays.cards.luxury-cabin.title')}</h3>
                <div className="space-y-2 text-neutral-300">
                  <p className="text-base font-medium">{t('stays.labels.sleeps')} {t('stays.cards.luxury-cabin.sleeps')}</p>
                  <p className="text-sm text-neutral-400">{t('stays.labels.bestFor')} {t('stays.bestFor.default')}</p>
                  <p className="text-sm text-neutral-300 pt-2 border-t border-white/10">{(t('stays.cards.luxury-cabin.bullets', { returnObjects: true }) || [])[0]}</p>
                </div>
              </motion.div>
            </div>
          </div>
        </section>

        {/* ===========================================
            SECTION 3B: ACCOMMODATION PORTALS (Premium Stay Cards)
            =========================================== */}
        <section 
          ref={accommodationsRef}
          id="accommodations"
          className="relative py-24 md:py-32 border-t border-white/5"
        >
          <div className="max-w-7xl mx-auto px-4 md:px-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-12">
              {/* Premium Stay Card 1: Luxury Cabin */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6 }}
                className="bg-[#2f2f2f] border border-white/15 rounded-2xl overflow-hidden shadow-xl group hover:shadow-2xl transition-all duration-300 hover:-translate-y-1 focus-within:ring-2 focus-within:ring-[#81887A] focus-within:ring-offset-2 focus-within:ring-offset-[#2f2f2f]"
                tabIndex={0}
              >
                {/* Large Image */}
                <div className="relative h-64 md:h-80 overflow-hidden bg-[#1f2328]">
                  <img 
                    src="/uploads/The%20Valley/WhatsApp%20Image%202025-12-03%20at%204.36.14%20PM.jpeg"
                    alt={getSEOAlt('/uploads/The Valley/WhatsApp Image 2025-12-03 at 4.36.14 PM.jpeg') || 'Luxury cabin interior at The Valley showing modern plywood walls and large windows at 1,550m altitude, Rhodope Mountains, Bulgaria'}
                    title={getSEOTitle('/uploads/The Valley/WhatsApp Image 2025-12-03 at 4.36.14 PM.jpeg') || 'Luxury Cabin Interior - Modern Plywood Design with Large Windows'}
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110 group-hover:brightness-110"
                    loading="lazy"
                    decoding="async"
                  />
                </div>
                
                {/* Content */}
                <div className="p-6 md:p-8">
                  <h3 className="font-serif italic font-thin text-2xl md:text-3xl text-white mb-2">{t('stays.cards.luxury-cabin.title')}</h3>
                  <p className="text-sm md:text-base text-neutral-300 mb-4">{t('stays.labels.sleeps')} {t('stays.cards.luxury-cabin.sleeps')}</p>
                  
                  {/* 3 Bullet Highlights */}
                  <ul className="space-y-2 mb-6">
                    {(t('stays.cards.luxury-cabin.bullets', { returnObjects: true }) || []).map((line) => (
                      <li key={line} className="flex items-start gap-2 text-sm text-neutral-300">
                        <span className="text-[#81887A] mt-1">•</span>
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>

                  {/* CTAs */}
                  <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-white/10">
                    <button
                      onClick={openModal}
                      className="bg-[#81887A] text-white px-6 py-3 font-medium uppercase tracking-wider text-xs sm:text-sm rounded-lg hover:bg-[#6d7366] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#81887A] focus-visible:ring-offset-2 focus-visible:ring-offset-[#2f2f2f]"
                    >
                      {t('stays.cta.checkDates')}
                    </button>
                    <button
                      onClick={openModal}
                      className="border border-white/20 text-white px-6 py-3 font-medium uppercase tracking-wider text-xs sm:text-sm rounded-lg hover:bg-white/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#2f2f2f]"
                    >
                      {t('stays.cta.viewDetails')}
                    </button>
                  </div>
                </div>
              </motion.div>

              {/* Premium Stay Card 2: Stone House */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: 0.1 }}
                className="bg-[#2f2f2f] border border-white/15 rounded-2xl overflow-hidden shadow-xl group hover:shadow-2xl transition-all duration-300 hover:-translate-y-1 focus-within:ring-2 focus-within:ring-[#81887A] focus-within:ring-offset-2 focus-within:ring-offset-[#2f2f2f]"
                tabIndex={0}
              >
                {/* Large Image */}
                <div className="relative h-64 md:h-80 overflow-hidden bg-[#1f2328]">
                  <img 
                    src="/uploads/The%20Valley/WhatsApp%20Image%202025-10-17%20at%2010.20.23%20AM%20(1).jpeg"
                    alt={getSEOAlt('/uploads/The Valley/WhatsApp Image 2025-10-17 at 10.20.23 AM (1).jpeg') || 'Stone House front exterior at The Valley showing stone and wood construction, blue roof with solar panels, and wooden deck at 1,550m altitude, Rhodope Mountains, Bulgaria'}
                    title={getSEOTitle('/uploads/The Valley/WhatsApp Image 2025-10-17 at 10.20.23 AM (1).jpeg') || 'Stone House Front Exterior - Historic Mountain Accommodation at The Valley'}
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110 group-hover:brightness-110"
                    loading="lazy"
                    decoding="async"
                  />
                </div>
                
                {/* Content */}
                <div className="p-6 md:p-8">
                  <h3 className="font-serif italic font-thin text-2xl md:text-3xl text-white mb-2">{t('stays.cards.stone-house.title')}</h3>
                  <p className="text-sm md:text-base text-neutral-300 mb-4">{t('stays.labels.sleeps')} {t('stays.cards.stone-house.sleeps')}</p>
                  
                  {/* 3 Bullet Highlights */}
                  <ul className="space-y-2 mb-6">
                    {(t('stays.cards.stone-house.bullets', { returnObjects: true }) || []).map((line) => (
                      <li key={line} className="flex items-start gap-2 text-sm text-neutral-300">
                        <span className="text-[#81887A] mt-1">•</span>
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>

                  {/* CTAs */}
                  <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-white/10">
                    <button
                      onClick={openModal}
                      className="bg-[#81887A] text-white px-6 py-3 font-medium uppercase tracking-wider text-xs sm:text-sm rounded-lg hover:bg-[#6d7366] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#81887A] focus-visible:ring-offset-2 focus-visible:ring-offset-[#2f2f2f]"
                    >
                      {t('stays.cta.checkDates')}
                    </button>
                    <button
                      onClick={openModal}
                      className="border border-white/20 text-white px-6 py-3 font-medium uppercase tracking-wider text-xs sm:text-sm rounded-lg hover:bg-white/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#2f2f2f]"
                    >
                      {t('stays.cta.viewDetails')}
                    </button>
                  </div>
                </div>
              </motion.div>

              {/* Premium Stay Card 3: A-Frames */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: 0.2 }}
                className="bg-[#2f2f2f] border border-white/15 rounded-2xl overflow-hidden shadow-xl group hover:shadow-2xl transition-all duration-300 hover:-translate-y-1 focus-within:ring-2 focus-within:ring-[#81887A] focus-within:ring-offset-2 focus-within:ring-offset-[#2f2f2f]"
                tabIndex={0}
              >
                {/* Large Image */}
                <div className="relative h-64 md:h-80 overflow-hidden bg-[#1f2328]">
                  <img 
                    src="/uploads/Content%20website/SKy-view-Aframe.jpg"
                    alt={getSEOAlt('/uploads/Content website/SKy-view-Aframe.jpg') || 'Aerial drone view of The Valley showing multiple A-frame cabins, village layout, paths, and mountain landscape at 1,550m altitude, Rhodope Mountains, Bulgaria'}
                    title={getSEOTitle('/uploads/Content website/SKy-view-Aframe.jpg') || 'Aerial View of The Valley - A-Frame Village Layout from Above'}
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110 group-hover:brightness-110"
                    loading="lazy"
                    decoding="async"
                  />
                </div>
                
                {/* Content */}
                <div className="p-6 md:p-8">
                  <h3 className="font-serif italic font-thin text-2xl md:text-3xl text-white mb-2">{t('stays.cards.a-frames.title')}</h3>
                  <p className="text-sm md:text-base text-neutral-300 mb-4">{t('stays.labels.sleeps')} {t('stays.cards.a-frames.sleeps')}</p>
                  
                  {/* 3 Bullet Highlights */}
                  <ul className="space-y-2 mb-6">
                    {(t('stays.cards.a-frames.bullets', { returnObjects: true }) || []).map((line) => (
                      <li key={line} className="flex items-start gap-2 text-sm text-neutral-300">
                        <span className="text-[#81887A] mt-1">•</span>
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>

                  {/* CTAs */}
                  <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-white/10">
                    <button
                      onClick={openModal}
                      className="bg-[#81887A] text-white px-6 py-3 font-medium uppercase tracking-wider text-xs sm:text-sm rounded-lg hover:bg-[#6d7366] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#81887A] focus-visible:ring-offset-2 focus-visible:ring-offset-[#2f2f2f]"
                    >
                      {t('stays.cta.checkDates')}
                    </button>
                    <button
                      onClick={openModal}
                      className="border border-white/20 text-white px-6 py-3 font-medium uppercase tracking-wider text-xs sm:text-sm rounded-lg hover:bg-white/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#2f2f2f]"
                    >
                      {t('stays.cta.viewDetails')}
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          </div>
        </section>

        {/* ===========================================
            SECTION 3C: THE KINETIC GALLERY
            (Parallax Masonry Grid - The Vibe)
            =========================================== */}
        <section 
          ref={galleryRef}
          className="relative py-24 md:py-32 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-[#1a1a1a] via-[#121212] to-[#0d0d0d] border-t border-white/5 overflow-hidden"
        >
          <div className="max-w-7xl mx-auto px-4 md:px-6">
            <div className="text-center mb-16">
              <h2 className="font-serif italic font-thin text-5xl md:text-7xl text-neutral-400 mb-4">
                {t('vibe.title')}
              </h2>
              <p className="text-sm text-neutral-400 uppercase tracking-widest">
                {t('vibe.galleryEyebrow')}
              </p>
            </div>

            {/* Airbnb-Style Hero Grid Layout */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8 max-w-7xl mx-auto">
              {/* Large Hero Image - Left Side (50% width) - Panoramic Valley View */}
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.8 }}
                className="relative h-[60vh] md:h-[80vh] overflow-hidden rounded-xl group cursor-pointer"
                onClick={openModal}
                aria-label={getSEOAlt('/uploads/The Valley/WhatsApp Image 2025-10-17 at 10.20.23 AM.jpeg') || 'Panoramic landscape view of The Valley mountain village showing Stone House, A-frame cabins, and forest backdrop at 1,550m altitude, Rhodope Mountains, Bulgaria'}
              >
                <div 
                  className="absolute inset-0 bg-cover bg-center transition-transform duration-700 group-hover:scale-110"
                  style={{
                    backgroundImage: 'url(/uploads/The%20Valley/WhatsApp%20Image%202025-10-17%20at%2010.20.23%20AM.jpeg)',
                  }}
                  role="img"
                  aria-label={getSEOAlt('/uploads/The Valley/WhatsApp Image 2025-10-17 at 10.20.23 AM.jpeg') || 'Panoramic landscape view of The Valley mountain village showing Stone House, A-frame cabins, and forest backdrop at 1,550m altitude, Rhodope Mountains, Bulgaria'}
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors duration-300" />
              </motion.div>

              {/* 2x2 Grid - Right Side (50% width) */}
              <div className="grid grid-cols-2 gap-4 md:gap-6 h-[60vh] md:h-[80vh]">
                {/* Top Left - A-Frame exterior with porch */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.6, delay: 0.1 }}
                  className="relative overflow-hidden rounded-xl group cursor-pointer"
                  onClick={openModal}
                  aria-label={getSEOAlt('/uploads/The Valley/1760891856097-tkq4ums108j-WhatsApp-Image-2025-10-14-at-2.05.18-PM.jpeg') || 'A-frame cabin exterior with front porch and mountain landscape at The Valley, 1,550m altitude, Rhodope Mountains, Bulgaria'}
                >
                  <div 
                    className="absolute inset-0 bg-cover bg-center transition-transform duration-700 group-hover:scale-110"
                    style={{
                      backgroundImage: 'url(/uploads/The%20Valley/1760891856097-tkq4ums108j-WhatsApp-Image-2025-10-14-at-2.05.18-PM.jpeg)',
                    }}
                    role="img"
                    aria-label={getSEOAlt('/uploads/The Valley/1760891856097-tkq4ums108j-WhatsApp-Image-2025-10-14-at-2.05.18-PM.jpeg') || 'A-frame cabin exterior with front porch and mountain landscape at The Valley, 1,550m altitude, Rhodope Mountains, Bulgaria'}
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors duration-300" />
                </motion.div>

                {/* Top Right - Communal fireside lounge interior */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.6, delay: 0.2 }}
                  className="relative overflow-hidden rounded-xl group cursor-pointer"
                  onClick={openModal}
                  aria-label={getSEOAlt('/uploads/Content website/drift-dwells-bulgaria-fireside-lounge.avif') || 'Communal fireside lounge interior at The Valley Stone House showing fireplace, comfortable seating, and cozy gathering space for guests, Rhodope Mountains'}
                >
                  <div 
                    className="absolute inset-0 bg-cover bg-center transition-transform duration-700 group-hover:scale-110"
                    style={{
                      backgroundImage: 'url(/uploads/Content%20website/drift-dwells-bulgaria-fireside-lounge.avif)',
                    }}
                    role="img"
                    aria-label={getSEOAlt('/uploads/Content website/drift-dwells-bulgaria-fireside-lounge.avif') || 'Communal fireside lounge interior at The Valley Stone House showing fireplace, comfortable seating, and cozy gathering space for guests, Rhodope Mountains'}
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors duration-300" />
                </motion.div>

                {/* Bottom Left - River/nature scene */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.6, delay: 0.3 }}
                  className="relative overflow-hidden rounded-xl group cursor-pointer"
                  onClick={openModal}
                  aria-label={getSEOAlt('/uploads/Content website/drift-dwells-bulgaria-river-letters.avif') || 'River scene in The Valley showing natural stream, rocks, and mountain landscape at 1,550m altitude, Rhodope Mountains, Bulgaria'}
                >
                  <div 
                    className="absolute inset-0 bg-cover bg-center transition-transform duration-700 group-hover:scale-110"
                    style={{
                      backgroundImage: 'url(/uploads/Content%20website/drift-dwells-bulgaria-river-letters.avif)',
                    }}
                    role="img"
                    aria-label={getSEOAlt('/uploads/Content website/drift-dwells-bulgaria-river-letters.avif') || 'River scene in The Valley showing natural stream, rocks, and mountain landscape at 1,550m altitude, Rhodope Mountains, Bulgaria'}
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors duration-300" />
                </motion.div>

                {/* Bottom Right - A-Frame cabin with sunset */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.6, delay: 0.4 }}
                  className="relative overflow-hidden rounded-xl group cursor-pointer"
                  onClick={openModal}
                  aria-label={getSEOAlt('/uploads/The Valley/WhatsApp Image 2025-10-17 at 10.20.24 AM (6).jpeg') || 'A-frame cabin exterior at sunset at The Valley showing triangular structure, trees, and warm evening light at 1,550m altitude, Rhodope Mountains, Bulgaria'}
                >
                  <div 
                    className="absolute inset-0 bg-cover bg-center transition-transform duration-700 group-hover:scale-110"
                    style={{
                      backgroundImage: 'url(/uploads/The%20Valley/WhatsApp%20Image%202025-10-17%20at%2010.20.24%20AM%20(6).jpeg)',
                    }}
                    role="img"
                    aria-label={getSEOAlt('/uploads/The Valley/WhatsApp Image 2025-10-17 at 10.20.24 AM (6).jpeg') || 'A-frame cabin exterior at sunset at The Valley showing triangular structure, trees, and warm evening light at 1,550m altitude, Rhodope Mountains, Bulgaria'}
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors duration-300" />
                </motion.div>
              </div>
            </div>
          </div>
        </section>

        {/* ===========================================
            SECTION 4: THE AYLYAK DEFINITION
            (Cinematic Definition - Luxury Dictionary Entry)
            =========================================== */}
        <section 
          ref={aylyakRef}
          className="relative py-32 md:py-48 lg:py-64 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-[#1a1a1a] via-[#121212] to-[#0d0d0d] border-t border-white/5"
        >
          <div className="relative max-w-4xl mx-auto px-4 md:px-6 flex items-center justify-center min-h-[70vh] md:min-h-[80vh]">
            {/* Cinematic Definition - No Borders, Vast Negative Space */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 1, ease: [0.25, 0.1, 0.25, 1] }}
              className="text-center space-y-6 md:space-y-8"
            >
              {/* Word - Large, elegant serif, lowercase */}
              <motion.div
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.8, delay: 0.2 }}
              >
                <h2 className="font-serif italic font-light text-6xl md:text-7xl lg:text-8xl xl:text-9xl text-neutral-300 leading-none tracking-tight">
                  aylyak
                </h2>
              </motion.div>
              
              {/* Pronunciation & Part of Speech - Small, italic, grey */}
              <motion.div
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.8, delay: 0.4 }}
                className="flex items-center justify-center gap-2 md:gap-3 text-neutral-500"
              >
                <span className="text-sm md:text-base lg:text-lg font-serif italic">
                  {t('aylyakBlock.pronunciation')}
                </span>
                <span className="text-neutral-600">•</span>
                <span className="text-sm md:text-base lg:text-lg font-serif italic">
                  {t('aylyakBlock.partOfSpeech')}
                </span>
              </motion.div>
              
              {/* Definition - Elegant, poetic */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.8, delay: 0.6 }}
                className="pt-4 md:pt-6 max-w-2xl mx-auto"
              >
                <p className="text-base md:text-lg lg:text-xl text-neutral-400 leading-relaxed font-serif">
                  A deliberate refusal to be rushed. The art of not worrying.
                </p>
              </motion.div>
            </motion.div>
          </div>
          
          {/* Subtle Clarification - Very minimal */}
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8, delay: 0.8 }}
            className="mt-16 md:mt-24 text-center max-w-2xl mx-auto px-4"
          >
            <p className="text-xs md:text-sm text-neutral-500 leading-relaxed font-serif italic">
              {t('aylyakBlock.wifiNote')}
            </p>
          </motion.div>
        </section>

        {/* Trust Badges Row - AuthorityStrip Component with Invert Filter */}
        <section 
          ref={trustBadgesRef}
          className="relative"
        >
          <div className="invert">
            <AuthorityStrip />
          </div>
          <div className="text-center py-6 bg-white">
            <p className="text-sm md:text-base text-neutral-600 font-serif">
              {t('trust.guestRatingsBlurb')}
            </p>
          </div>
        </section>

        {/* ===========================================
            SECTION 5: THE SPECIFICATION SHEET
            (Luxury Menu Layout - Unit Details Table)
            =========================================== */}
        <section className="bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-[#1a1a1a] via-[#121212] to-[#0d0d0d] py-12 md:py-24 border-t border-white/5">
          <div className="max-w-4xl mx-auto px-6">
            <h2 className="font-serif italic font-thin text-5xl md:text-7xl text-neutral-400 text-center mb-12 md:mb-16">
              {t('practical.title')}
            </h2>

            <div className="flex flex-col space-y-4">
              <div className="flex items-start gap-4 md:gap-6">
                <MapPin className="w-5 h-5 text-neutral-500 mt-1 flex-shrink-0" />
                <p className="font-serif text-base md:text-lg text-neutral-400 leading-relaxed">{t('practical.items.access.title')}</p>
              </div>

              <div className="flex items-start gap-4 md:gap-6">
                <Home className="w-5 h-5 text-neutral-500 mt-1 flex-shrink-0" />
                <p className="font-serif text-base md:text-lg text-neutral-400 leading-relaxed">{t('practical.items.amenities.title')}</p>
              </div>

              <div className="flex items-start gap-4 md:gap-6">
                <Mountain className="w-5 h-5 text-neutral-500 mt-1 flex-shrink-0" />
                <p className="font-serif text-base md:text-lg text-neutral-400 leading-relaxed">{t('practical.items.water.title')}</p>
              </div>

              <div className="flex items-start gap-4 md:gap-6">
                <Mountain className="w-5 h-5 text-neutral-500 mt-1 flex-shrink-0" />
                <p className="font-serif text-base md:text-lg text-neutral-400 leading-relaxed">{t('practical.items.winter.title')}</p>
              </div>

              <div className="flex items-start gap-4 md:gap-6">
                <Home className="w-5 h-5 text-neutral-500 mt-1 flex-shrink-0" />
                <p className="font-serif text-base md:text-lg text-neutral-400 leading-relaxed">{t('practical.items.support.title')}</p>
              </div>

              <div className="mt-8 pt-6 border-t border-white/10">
                <p className="font-serif text-base md:text-lg text-neutral-400 leading-relaxed">
                  {t('practical.sheetClosing')}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Section: Sunrise CTA */}
        <section className="relative min-h-screen flex items-center justify-center overflow-hidden bg-gradient-to-br from-[#FDF8F0] via-[#F9F4E8] to-[#F5EFE0]">
          {/* Subtle background pattern/texture */}
          <div 
            className="absolute inset-0 opacity-5"
            style={{
              backgroundImage: `url("${noiseTexture}")`,
              backgroundRepeat: 'repeat'
            }}
          />
          
          {/* Optional: Subtle sun flare gradient overlay */}
          <div className="absolute top-0 right-0 w-1/2 h-1/2 bg-gradient-to-br from-amber-200/20 via-amber-100/10 to-transparent rounded-full blur-3xl" />
          
          <div className="relative z-10 text-center px-4 max-w-4xl mx-auto py-24 md:py-32">
            <motion.h2
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8 }}
              className="font-serif italic font-thin text-4xl md:text-5xl lg:text-6xl text-stone-900 mb-6"
            >
              {t('closing.chooseTitle')}
            </motion.h2>
            <motion.button
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8, delay: 0.2 }}
              onClick={openModal}
              className="mt-8 bg-stone-900 text-[#FDF8F0] px-8 sm:px-12 py-4 sm:py-5 font-bold uppercase tracking-widest text-xs sm:text-sm hover:scale-105 transition-transform shadow-2xl border-none min-h-[44px] touch-manipulation"
            >
              {t('hero.ctaPrimary')}
            </motion.button>
          </div>
        </section>

      </div>
    </>
  );
};

export default TheValley;
