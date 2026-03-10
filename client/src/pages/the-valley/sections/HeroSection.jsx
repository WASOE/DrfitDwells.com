import { motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useBookingSearch } from '../../../context/BookingSearchContext';
import { useSeason } from '../../../context/SeasonContext';
import { getSEOAlt, getSEOTitle } from '../../../data/imageMetadata';
import HeroSeasonToggle from '../../../components/HeroSeasonToggle';
import { VALLEY_VIDEOS, VALLEY_STILLS } from '../data';

const HeroSection = ({ 
  containerRef, 
  heroRef, 
  videoRef, 
  shouldPlayVideo, 
  scrollToAccommodations,
  noiseTexture: _noiseTexture 
}) => {
  const { openModal } = useBookingSearch();
  const { season } = useSeason();
  const { t } = useTranslation('valley');

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
            src={VALLEY_STILLS[season]}
            alt={getSEOAlt(VALLEY_STILLS[season]) || 'The Valley: A Village Above the Clouds - Mountain village at 1,550m altitude showing A-frames, stone house, and mountain landscape, Chereshovo/Ortsevo, Rhodope Mountains, Bulgaria'}
            title={getSEOTitle(VALLEY_STILLS[season]) || 'The Valley - A Village Above the Clouds at 1,550m Altitude'}
            className="absolute inset-0 w-full h-full object-cover"
            loading="eager"
            fetchpriority="high"
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
            preload="none"
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
          1,550m Altitude
        </div>
      </motion.div>
      
      {/* Content */}
      <div className="relative z-10 text-center px-4 max-w-4xl mx-auto">
        {/* Micro label */}
        <motion.p 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="font-serif text-xs md:text-sm tracking-[0.2em] uppercase text-white/70 mb-4 drop-shadow-sm"
        >
          {t('hero.microLabel')}
        </motion.p>

        {/* Main headline */}
        <motion.h1 
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.3 }}
          className="font-['Playfair_Display'] text-5xl md:text-7xl lg:text-8xl text-white font-semibold tracking-tight leading-tight drop-shadow-2xl mb-3"
        >
          {t('hero.title')}
        </motion.h1>
          
        {/* Subtitle */}
        <motion.h2 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.35 }}
          className="font-serif text-xl md:text-2xl lg:text-3xl text-white/95 font-normal tracking-tight mb-6 drop-shadow-sm"
        >
          {t('hero.subtitle')}
        </motion.h2>
          
        {/* Body copy - Line 1 */}
        <motion.p 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.4 }}
          className="text-base md:text-lg text-white/90 max-w-2xl mx-auto font-serif leading-relaxed drop-shadow-sm mb-3"
        >
          {t('hero.body1')}
        </motion.p>
          
        {/* Body copy - Line 2 */}
        <motion.p 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.45 }}
          className="text-base md:text-lg text-white/90 max-w-2xl mx-auto font-serif leading-relaxed drop-shadow-sm mb-8"
        >
          {t('hero.body2')}
        </motion.p>
          
        {/* CTAs */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.5 }}
          className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-8 px-4"
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
