import { motion } from 'framer-motion';
import HeroResponsivePicture from '../../../components/HeroResponsivePicture';
import { HERO_LCP_PRELOAD_WIDTH, getValleyHeroResponsive } from '../../../config/heroResponsive';
import { WINTER_VILLAGE_HERO } from '../winterVillageConfig';

export const WINTER_VILLAGE_HERO_PRELOAD = `/media/hero/valley-winter-${HERO_LCP_PRELOAD_WIDTH}w.avif`;

export default function WinterVillageHero({ onExplorePackages, prefersReducedMotion }) {
  const hero = getValleyHeroResponsive('winter');
  const motionProps = prefersReducedMotion
    ? { initial: false, animate: { opacity: 1 }, transition: { duration: 0 } }
    : {};

  return (
    <section
      className="relative min-h-[100svh] flex items-end md:items-center justify-center overflow-hidden"
      aria-label="The Valley Winter Village"
    >
      <div className="absolute inset-0">
        <HeroResponsivePicture
          avifSrcSet={hero.avifSrcSet}
          webpSrcSet={hero.webpSrcSet}
          fallbackSrc={hero.fallbackSrc}
          width={hero.width}
          height={hero.height}
          sizes="100vw"
          alt="The Valley in winter — Rhodope Mountains, Bulgaria"
          className="absolute inset-0 h-full w-full object-cover"
          style={{
            minWidth: '100%',
            minHeight: '100%',
            objectFit: 'cover',
            transform: prefersReducedMotion ? 'none' : 'scale(1.12)',
            transformOrigin: 'center center'
          }}
          loading="eager"
          fetchPriority="high"
          decoding="async"
        />
      </div>

      <div className="absolute inset-0 bg-gradient-to-b from-black/35 via-black/45 to-black/70" />

      <div className="relative z-10 w-full valley-container pb-16 pt-28 md:py-24 lg:py-28 text-center md:text-left">
        <div className="max-w-3xl mx-auto md:mx-0">
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.15 }}
            {...motionProps}
            className="font-serif text-xs md:text-sm tracking-[0.2em] uppercase text-white/75 mb-4"
          >
            {WINTER_VILLAGE_HERO.seasonLabel}
            <span className="mx-2 text-white/40" aria-hidden="true">
              ·
            </span>
            {WINTER_VILLAGE_HERO.locationLabel}
          </motion.p>

          <motion.h1
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.25 }}
            {...motionProps}
            className="font-['Playfair_Display'] text-4xl sm:text-5xl md:text-6xl lg:text-7xl text-white font-semibold tracking-tight leading-[1.08] mb-5 drop-shadow-lg"
          >
            {WINTER_VILLAGE_HERO.headline}
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.35 }}
            {...motionProps}
            className="font-serif text-base md:text-xl text-white/92 leading-relaxed max-w-2xl mx-auto md:mx-0 mb-8"
          >
            {WINTER_VILLAGE_HERO.copy}
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.45 }}
            {...motionProps}
            className="flex flex-col sm:flex-row items-center md:items-start gap-4"
          >
            <button
              type="button"
              onClick={onExplorePackages}
              className="inline-flex items-center justify-center bg-white text-[#1a1a1a] px-10 py-4 font-semibold uppercase tracking-[0.18em] text-xs md:text-sm hover:bg-white/90 transition-colors min-h-[52px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black/40"
            >
              {WINTER_VILLAGE_HERO.primaryCta}
            </button>
          </motion.div>

          <p className="wv-preview-notice md:mx-0">{WINTER_VILLAGE_HERO.previewNotice}</p>
        </div>
      </div>
    </section>
  );
}
