import { useRef } from 'react';
import { motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { useBookingSearch } from '../../../context/BookingSearchContext';
import { getSEOAlt, getSEOTitle } from '../../../data/imageMetadata';
import { VALLEY_VIDEO, VALLEY_STILL } from '../data';

const HeroSection = ({ 
  containerRef, 
  heroRef, 
  videoRef, 
  shouldPlayVideo, 
  scrollToAccommodations,
  noiseTexture 
}) => {
  const { openModal } = useBookingSearch();

  return (
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
            src={VALLEY_STILL}
            alt={getSEOAlt(VALLEY_STILL) || 'The Valley: A Village Above the Clouds - Mountain village at 1,550m altitude showing A-frames, stone house, and mountain landscape, Chereshovo/Ortsevo, Rhodope Mountains, Bulgaria'}
            title={getSEOTitle(VALLEY_STILL) || 'The Valley - A Village Above the Clouds at 1,550m Altitude'}
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
            ref={videoRef}
            className="absolute inset-0 w-full h-full object-cover"
            autoPlay
            loop
            muted
            playsInline
            preload="metadata"
            poster={VALLEY_STILL}
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
            <source src={VALLEY_VIDEO} type="video/mp4" />
          </video>
        )}
      </motion.div>
      
      {/* Overlay - Improved gradient for readability */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/40 to-black/60" />
      
      {/* 1,550m Altitude Badge - Top Right */}
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.8, delay: 0.5 }}
        className="absolute top-8 right-4 md:top-12 md:right-12 z-20"
      >
        <div className="px-4 py-2 bg-white/10 backdrop-blur-md border border-white/20 text-white text-sm md:text-base font-serif tracking-wide">
          1,550m Altitude
        </div>
      </motion.div>
      
      {/* Content */}
      <div className="relative z-10 text-center px-4 max-w-4xl mx-auto">
        <motion.h1 
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="font-['Playfair_Display'] text-2xl md:text-6xl text-white font-semibold tracking-tight leading-tight drop-shadow-lg mb-4"
        >
          The Valley: A Village Above the Clouds.
        </motion.h1>
          
        <motion.p 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.3 }}
          className="mt-3 text-base md:text-lg text-neutral-400 max-w-2xl mx-auto font-light drop-shadow-sm"
        >
          A private off-grid mountain village with individual cabins, a historic stone house, and shared outdoor spaces in the Rhodope Mountains, Bulgaria.
        </motion.p>
          
        <motion.p 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.35 }}
          className="mt-4 text-sm md:text-base text-neutral-400 max-w-2xl mx-auto font-light drop-shadow-sm"
        >
          Designed for quiet, privacy, and comfort, with reliable heating, hot water, and year-round access.
        </motion.p>
          
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.4 }}
          className="flex flex-col sm:flex-row gap-4 justify-center items-center mt-8 px-4"
        >
          <button
            onClick={openModal}
            className="bg-white text-stone-900 px-6 sm:px-8 py-3 sm:py-4 font-bold uppercase tracking-widest text-xs sm:text-sm hover:scale-105 transition-transform shadow-xl border-none min-h-[44px] touch-manipulation"
          >
            Check availability
          </button>
          <button
            onClick={scrollToAccommodations}
            className="border border-white/30 text-white px-6 sm:px-8 py-3 sm:py-4 font-medium uppercase tracking-widest text-xs sm:text-sm hover:bg-white/10 transition-all backdrop-blur-sm min-h-[44px] touch-manipulation"
          >
            Explore stays
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
            Above the clouds
          </div>
          <div className="px-4 py-2 bg-white/10 backdrop-blur-md border border-white/20 text-white text-xs md:text-sm font-light tracking-wide rounded-full">
            Off-grid comfort
          </div>
          <div className="px-4 py-2 bg-white/10 backdrop-blur-md border border-white/20 text-white text-xs md:text-sm font-light tracking-wide rounded-full">
            Private valley
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
  );
};

export default HeroSection;
