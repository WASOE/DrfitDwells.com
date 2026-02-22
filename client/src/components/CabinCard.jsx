import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, useScroll, useTransform } from 'framer-motion';
import { Volume2, VolumeX, Wifi, WifiOff, Mountain, Car, Zap } from 'lucide-react';

const CabinCard = ({ title, description, image, interiorImage, audioSrc, details, locationId, price, cta, videoSrc, videoPoster }) => {
  const navigate = useNavigate();
  const cardRef = useRef(null);
  const videoRef = useRef(null);
  const { scrollYProgress } = useScroll({
    target: cardRef,
    offset: ['start 80%', 'end 20%']
  });
  const y = useTransform(scrollYProgress, [0, 1], ['-12%', '12%']);

  const audioRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const [shouldLoadVideo, setShouldLoadVideo] = useState(false);
  const [videoLoaded, setVideoLoaded] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  const handleCtaClick = () => {
    if (locationId === 'cabin') {
      navigate('/cabin');
    } else if (locationId === 'valley') {
      navigate('/valley');
    }
  };

  // Detect reduced motion preference
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(mediaQuery.matches);
    
    const handleChange = (e) => setPrefersReducedMotion(e.matches);
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  // Lazy load video when card comes into view
  useEffect(() => {
    if (!videoSrc || prefersReducedMotion) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setShouldLoadVideo(true);
            observer.disconnect();
          }
        });
      },
      { rootMargin: '50px' } // Start loading slightly before card is visible
    );

    if (cardRef.current) {
      observer.observe(cardRef.current);
    }

    return () => observer.disconnect();
  }, [videoSrc, prefersReducedMotion]);

  // Handle video loaded event and errors
  useEffect(() => {
    if (!videoRef.current || !shouldLoadVideo) return;

    const video = videoRef.current;
    const handleLoadedData = () => {
      setVideoLoaded(true);
      // Auto-play video when loaded (muted and looped)
      video.play().catch((err) => {
        console.log('Video autoplay prevented:', err);
      });
    };

    const handleError = () => {
      console.warn('Video failed to load, falling back to static image');
      setVideoError(true);
    };

    video.addEventListener('loadeddata', handleLoadedData);
    video.addEventListener('error', handleError);
    return () => {
      video.removeEventListener('loadeddata', handleLoadedData);
      video.removeEventListener('error', handleError);
    };
  }, [shouldLoadVideo]);

  useEffect(() => {
    audioRef.current = new Audio(audioSrc);
    audioRef.current.loop = true;
    audioRef.current.volume = 0.65;

    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, [audioSrc]);

  const toggleAudio = async () => {
    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
      return;
    }

    try {
      setIsLoadingAudio(true);
      await audioRef.current.play();
      setIsPlaying(true);
    } catch (error) {
      console.error('Unable to start audio preview', error);
    } finally {
      setIsLoadingAudio(false);
    }
  };

  return (
    <motion.article
      ref={cardRef}
      className="bg-white/95 rounded-[32px] overflow-hidden border border-[#ded7c8]/70 shadow-2xl shadow-[0_25px_70px_rgba(12,26,20,0.18)] transition-all duration-500 hover:shadow-[0_35px_110px_rgba(12,30,22,0.25)] w-full m-0 h-full flex flex-col"
      style={{ margin: 0 }}
      whileHover={{ y: -5 }}
    >
      <div className="relative group">
        <motion.div style={{ y }} className="overflow-hidden rounded-t-[32px] relative h-56 md:h-[340px] bg-transparent" style={{ overflow: 'hidden' }}>
          {/* Video with lazy loading - show poster first, then video */}
          {videoSrc && !prefersReducedMotion && !videoError ? (
            <>
              {/* Poster image (shown before video loads) */}
              {videoPoster && !videoLoaded && (
                <img
                  src={videoPoster}
                  alt={title}
                  className="absolute inset-0 w-full h-full object-cover transition-opacity duration-700 ease-in-out"
                  style={{ 
                    objectFit: 'cover', 
                    width: '100%', 
                    height: '100%',
                    objectPosition: 'center',
                    transform: 'scale(1.4)',
                    transformOrigin: 'center center'
                  }}
                  loading="lazy"
                  decoding="async"
                />
              )}
              {/* Video element - only load when shouldLoadVideo is true */}
              {shouldLoadVideo && (
                <video
                  ref={videoRef}
                  src={videoSrc}
                  className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-700 ease-in-out ${
                    videoLoaded ? 'opacity-100' : 'opacity-0'
                  }`}
                  style={{ 
                    objectFit: 'cover', 
                    width: '100%', 
                    height: '100%',
                    objectPosition: 'center',
                    transform: 'scale(1.4)',
                    transformOrigin: 'center center'
                  }}
                  autoPlay
                  loop
                  muted
                  playsInline
                  preload="metadata"
                  poster={videoPoster}
                />
              )}
              {/* Fallback to static image if video not loaded yet and no poster */}
              {!shouldLoadVideo && !videoPoster && image && (
                <img
                  src={image}
                  alt={title}
                  className="absolute inset-0 w-full h-full object-cover"
                  style={{ 
                    objectFit: 'cover', 
                    width: '100%', 
                    height: '100%',
                    objectPosition: 'center'
                  }}
                  loading="lazy"
                  decoding="async"
                />
              )}
            </>
          ) : (
            <>
              {/* Exterior image (fallback when no video or reduced motion) */}
              <img
                src={image}
                alt={title}
                className="absolute inset-0 w-full h-full object-cover transition-opacity duration-700 ease-in-out group-hover:opacity-0"
                style={{ 
                  objectFit: 'cover', 
                  width: '100%', 
                  height: '100%',
                  objectPosition: 'center'
                }}
              />
              {/* Interior reveal */}
              {interiorImage && (
                <img
                  src={interiorImage}
                  alt={`${title} interior`}
                  className="absolute inset-0 w-full h-full object-cover opacity-0 transition-opacity duration-700 ease-in-out group-hover:opacity-100"
                  style={{ 
                    objectFit: 'cover', 
                    width: '100%', 
                    height: '100%',
                    objectPosition: 'center'
                  }}
                  loading="lazy"
                  decoding="async"
                />
              )}
            </>
          )}
          {/* Price Badge */}
          {price && (
            <div className="absolute top-4 left-4 bg-white/95 backdrop-blur px-3 py-1.5 rounded-full text-xs font-serif text-stone-900 z-20 border border-stone-200/50">
              {price}
            </div>
          )}
        </motion.div>

        <button
          type="button"
          onClick={toggleAudio}
          disabled={isLoadingAudio}
          className={`absolute top-4 right-4 sm:top-6 sm:right-6 h-12 w-12 sm:h-14 sm:w-14 rounded-full bg-white/80 backdrop-blur-lg border border-white/60 shadow-lg flex items-center justify-center transition-transform duration-300 active:scale-95 touch-manipulation ${
            isPlaying ? 'scale-105' : ''
          }`}
          aria-label={isPlaying ? 'Stop audio' : 'Play audio'}
        >
          {isPlaying && (
            <motion.span
              className="absolute inset-0 rounded-full border border-[#1f3d2b]/40"
              initial={{ scale: 0.9, opacity: 0.6 }}
              animate={{ scale: 1.35, opacity: 0 }}
              transition={{
                duration: 1.6,
                repeat: Infinity,
                ease: 'easeOut'
              }}
            />
          )}
          {isPlaying ? (
            <Volume2 className="text-[#1f3d2b] w-5 h-5 sm:w-6 sm:h-6" />
          ) : (
            <VolumeX className="text-[#1f3d2b] w-5 h-5 sm:w-6 sm:h-6" />
          )}
        </button>
      </div>

      <div className="p-5 pb-6 md:p-7 md:pb-7 bg-white/90 backdrop-blur-[1px] flex-1 flex flex-col">
        <p className="text-xs uppercase tracking-[0.45em] text-gray-500 mb-3">
          Drift & Dwells
        </p>
        {locationId && (
          <p className="text-[10px] md:text-xs font-sans uppercase tracking-[0.2em] text-stone-500 mb-2">
            {locationId === 'cabin' ? 'Solitary • Stoic • Deep Detox' : 'Ethereal • Communal • Light'}
          </p>
        )}
        <h3 className="font-['Playfair_Display'] text-2xl md:text-3xl text-[#1d2a1f] mb-3">
          {title}
        </h3>
        <p className="font-['Merriweather'] text-sm md:text-base text-gray-700 leading-relaxed mb-4">
          {description}
        </p>

        {/* Operational Details Badges */}
        {details && (
          <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-gray-200">
            {details.altitude && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-stone-100 rounded-full text-xs text-stone-700">
                <Mountain className="w-3.5 h-3.5" />
                <span>{details.altitude}</span>
              </div>
            )}
            {details.access && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-stone-100 rounded-full text-xs text-stone-700">
                <Car className="w-3.5 h-3.5" />
                <span className="max-w-[140px] truncate">{details.access}</span>
              </div>
            )}
            {details.power && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-stone-100 rounded-full text-xs text-stone-700">
                <Zap className="w-3.5 h-3.5" />
                <span className="max-w-[140px] truncate">{details.power}</span>
              </div>
            )}
            {details.wifi === "No WiFi" ? (
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 rounded-full text-xs text-amber-700 border border-amber-200">
                <WifiOff className="w-3.5 h-3.5" />
                <span>Off-Grid</span>
              </div>
            ) : details.wifi === "Starlink Available" ? (
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 rounded-full text-xs text-blue-700 border border-blue-200">
                <Wifi className="w-3.5 h-3.5" />
                <span>Starlink</span>
              </div>
            ) : null}
          </div>
        )}

        {/* CTA Button - Thumb-friendly on mobile */}
        {cta && (
          <div className="mt-4 border-t border-stone-200 pt-3">
            <button 
              onClick={handleCtaClick}
              className="w-full md:w-auto py-2 md:py-0 text-stone-900 border-b border-stone-900 pb-0.5 md:pb-0.5 hover:text-stone-600 hover:border-stone-600 transition-colors text-xs md:text-sm uppercase tracking-widest touch-manipulation"
            >
              {cta}
            </button>
          </div>
        )}
      </div>
    </motion.article>
  );
};

export default CabinCard;
