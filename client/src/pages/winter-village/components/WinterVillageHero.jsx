import { motion } from 'framer-motion';
import { HERO_LCP_PRELOAD_WIDTH, getValleyHeroResponsive } from '../../../config/heroResponsive';
import { WINTER_VILLAGE_HERO } from '../winterVillageConfig';
import WinterVillageCinematicMedia from './WinterVillageCinematicMedia';

export const WINTER_VILLAGE_HERO_PRELOAD = `/media/hero/valley-winter-${HERO_LCP_PRELOAD_WIDTH}w.avif`;

export default function WinterVillageHero({ onExplorePackages, prefersReducedMotion }) {
  const hero = getValleyHeroResponsive('winter');
  const motionProps = prefersReducedMotion
    ? { initial: false, animate: { opacity: 1 }, transition: { duration: 0 } }
    : {};

  return (
    <section className="wv-hero" aria-label="The Valley Winter Village">
      <WinterVillageCinematicMedia
        videoSrc={WINTER_VILLAGE_HERO.videoSrc}
        posterSrc={WINTER_VILLAGE_HERO.posterSrc}
        picture={hero}
        alt="The Valley in winter — snow, cabins and mountain silence"
        overlayClassName="wv-hero-overlay"
        prefersReducedMotion={prefersReducedMotion}
        eager
        objectPosition="center 42%"
      />

      <div className="wv-hero-copy">
        <motion.p
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.12 }}
          {...motionProps}
          className="wv-kicker wv-kicker--light"
        >
          {WINTER_VILLAGE_HERO.eyebrow}
        </motion.p>

        <motion.h1
          initial={{ opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.85, delay: 0.22 }}
          {...motionProps}
          className="wv-display"
        >
          {WINTER_VILLAGE_HERO.headline}
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.34 }}
          {...motionProps}
          className="wv-lede"
        >
          {WINTER_VILLAGE_HERO.copy}
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.44 }}
          {...motionProps}
          className="wv-hero-actions"
        >
          <button type="button" className="wv-btn wv-btn--light" onClick={onExplorePackages}>
            {WINTER_VILLAGE_HERO.primaryCta}
          </button>
          <p className="wv-hero-secondary">{WINTER_VILLAGE_HERO.secondaryLine}</p>
        </motion.div>
      </div>
    </section>
  );
}
