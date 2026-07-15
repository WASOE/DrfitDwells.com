import { motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { getSEOAlt, getSEOTitle } from '../../data/imageMetadata';
import HeroSeasonToggle from '../HeroSeasonToggle';

const mediaCoverStyle = {
  minWidth: '100%',
  minHeight: '100%',
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  transform: 'scale(1.2)',
  transformOrigin: 'center center'
};

/**
 * Full-viewport split video hero shell: background media, overlays, chrome, children.
 *
 * @param {object} props
 * @param {import('react').Ref} [props.containerRef]
 * @param {import('react').Ref} [props.heroRef]
 * @param {import('react').Ref} [props.videoRef]
 * @param {boolean} props.shouldPlayVideo
 * @param {string} props.videoSrc
 * @param {string} props.stillSrc
 * @param {string} [props.stillAlt]
 * @param {string} [props.stillTitle]
 * @param {string} [props.videoAriaLabel]
 * @param {string} [props.altitudeBadgeText]
 * @param {string} [props.videoKey] — remount video when season changes
 * @param {import('react').ReactNode} [props.endSlot] — rendered inside section after scroll cue
 * @param {import('react').ReactNode} props.children
 */
const SplitVideoHeroSection = ({
  containerRef,
  heroRef,
  videoRef,
  shouldPlayVideo,
  videoSrc,
  stillSrc,
  stillAlt,
  stillTitle,
  videoAriaLabel,
  videoKey,
  altitudeBadgeText = '1,550m Altitude',
  endSlot = null,
  children
}) => {
  const resolvedStillAlt =
    stillAlt ||
    getSEOAlt(stillSrc) ||
    'The Valley mountain village at 1,550m altitude, Rhodope Mountains, Bulgaria';
  const resolvedStillTitle =
    stillTitle || getSEOTitle(stillSrc) || 'The Valley — private group buyout';
  const resolvedVideoAriaLabel =
    videoAriaLabel ||
    'Video of The Valley mountain village at 1,550m altitude, Rhodope Mountains, Bulgaria';

  return (
    <section
      ref={containerRef}
      className="split-video-hero retreat-hero relative min-h-screen flex items-center justify-center overflow-hidden"
    >
      <motion.div ref={heroRef} className="absolute inset-0">
        {!shouldPlayVideo ? (
          <img
            src={stillSrc}
            alt={resolvedStillAlt}
            title={resolvedStillTitle}
            className="absolute inset-0 w-full h-full object-cover"
            loading="eager"
            fetchPriority="high"
            decoding="async"
            style={mediaCoverStyle}
          />
        ) : (
          <video
            key={videoKey}
            ref={videoRef}
            className="absolute inset-0 w-full h-full object-cover"
            autoPlay
            loop
            muted
            playsInline
            preload="none"
            poster={stillSrc}
            aria-label={resolvedVideoAriaLabel}
            style={mediaCoverStyle}
          >
            <source src={videoSrc} type="video/mp4" />
          </video>
        )}
      </motion.div>

      <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/40 to-black/60" />
      <div
        className="split-hero-scrim retreat-hero-scrim absolute inset-0 pointer-events-none hidden lg:block"
        aria-hidden="true"
      />

      <HeroSeasonToggle />

      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.8, delay: 0.5 }}
        className="absolute top-8 right-4 md:top-12 md:right-12 z-20 hidden md:block"
      >
        <div className="px-4 py-2 bg-white/10 backdrop-blur-md border border-white/20 text-white text-sm md:text-base font-serif tracking-wide">
          {altitudeBadgeText}
        </div>
      </motion.div>

      {children}

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

      {endSlot}
    </section>
  );
};

export default SplitVideoHeroSection;
