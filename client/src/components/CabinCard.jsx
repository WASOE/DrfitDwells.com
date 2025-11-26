import { useEffect, useRef, useState } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import { Volume2, VolumeX, Wifi, WifiOff, Mountain, Car, Zap } from 'lucide-react';

const CabinCard = ({ title, description, image, interiorImage, audioSrc, details, locationId, price, cta }) => {
  const cardRef = useRef(null);
  const { scrollYProgress } = useScroll({
    target: cardRef,
    offset: ['start 80%', 'end 20%']
  });
  const y = useTransform(scrollYProgress, [0, 1], ['-12%', '12%']);

  const audioRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);

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
      className="bg-white/95 rounded-[32px] overflow-hidden border border-[#ded7c8]/70 shadow-[0_25px_70px_rgba(12,26,20,0.18)] transition-all duration-500 hover:shadow-[0_35px_110px_rgba(12,30,22,0.25)]"
      whileHover={{ y: -5 }}
    >
      <div className="relative group">
        <motion.div style={{ y }} className="overflow-hidden rounded-[32px] relative h-64 md:h-[460px]">
          {/* Exterior image */}
          <img
            src={image}
            alt={title}
            className="w-full h-full object-cover transition-opacity duration-700 ease-in-out group-hover:opacity-0"
          />
          {/* Interior reveal */}
          {interiorImage && (
            <img
              src={interiorImage}
              alt={`${title} interior`}
              className="absolute inset-0 w-full h-full object-cover opacity-0 transition-opacity duration-700 ease-in-out group-hover:opacity-100"
              loading="lazy"
              decoding="async"
            />
          )}
          {/* Price Badge */}
          {price && (
            <div className="absolute top-4 left-4 bg-white/90 backdrop-blur px-3 py-1 rounded-full text-xs font-serif text-stone-900 z-20">
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

      <div className="p-6 md:p-10 bg-white/90 backdrop-blur-[1px]">
        <p className="text-xs uppercase tracking-[0.45em] text-gray-500 mb-4">
          Drift & Dwells
        </p>
        {locationId && (
          <p className="text-[10px] md:text-xs font-sans uppercase tracking-[0.2em] text-stone-500 mb-3">
            {locationId === 'cabin' ? 'Solitary • Stoic • Deep Detox' : 'Ethereal • Communal • Light'}
          </p>
        )}
        <h3 className="font-['Playfair_Display'] text-3xl md:text-4xl text-[#1d2a1f] mb-4">
          {title}
        </h3>
        <p className="font-['Merriweather'] text-base md:text-lg text-gray-700 leading-relaxed mb-6">
          {description}
        </p>

        {/* Operational Details Badges */}
        {details && (
          <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-gray-200">
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

        {/* CTA Button */}
        {cta && (
          <div className="mt-6 border-t border-stone-200 pt-4 flex justify-between items-center">
            <button className="text-stone-900 border-b border-stone-900 pb-0.5 hover:text-stone-600 hover:border-stone-600 transition-colors text-sm uppercase tracking-widest">
              {cta}
            </button>
          </div>
        )}
      </div>
    </motion.article>
  );
};

export default CabinCard;

