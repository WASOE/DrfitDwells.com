import { useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import Seo from '../../components/Seo';
import SplitVideoHeroSection from '../../components/hero/SplitVideoHeroSection';
import BookingCTABand from '../the-valley/sections/BookingCTABand';
import { useSeason } from '../../context/SeasonContext';
import { INSTAGRAM_URL } from '../../data/gmbLocations';
import { useLocalizedPath } from '../../hooks/useLocalizedPath';
import { buildHreflangAlternates } from '../../utils/localizedRoutes';
import { VALLEY_STILLS, VALLEY_VIDEOS } from '../the-valley/data';
import '../../i18n/ns/seo';
import '../the-valley/the-valley.css';

const PROMO_CODE = 'ENDURO';
const BOOK_PATH = '/stays/a-frame';
const BUYOUT_PATH = '/retreats/the-valley';
const PROOF_KEYS = ['one', 'two', 'three'];

const heroCtaClass =
  'inline-flex items-center justify-center bg-white text-stone-900 px-6 sm:px-8 py-3 sm:py-4 font-bold uppercase tracking-[0.3em] text-xs sm:text-sm hover:scale-105 transition-transform shadow-xl border-none rounded-full min-h-[44px] touch-manipulation no-underline';
const heroSecondaryClass =
  'inline-flex items-center justify-center border border-white/30 text-white px-6 sm:px-8 py-3 sm:py-4 font-medium uppercase tracking-[0.3em] text-xs sm:text-sm hover:bg-white/10 transition-all backdrop-blur-sm rounded-full min-h-[44px] touch-manipulation no-underline';

export default function Enduro() {
  const { t } = useTranslation('seo');
  const { season } = useSeason();
  const lp = useLocalizedPath();
  const navigate = useNavigate();
  const containerRef = useRef(null);
  const heroRef = useRef(null);
  const e = (key, opts) => t(`enduro.${key}`, opts);
  const bookTo = {
    pathname: lp(BOOK_PATH),
    search: `?promoCode=${PROMO_CODE}`
  };
  const buyoutTo = lp(BUYOUT_PATH);
  const stillSrc = VALLEY_STILLS[season] || VALLEY_STILLS.summer;

  return (
    <>
      <Seo
        title={e('metaTitle')}
        description={e('metaDescription')}
        canonicalPath="/enduro"
        ogImage={stillSrc}
        hreflangAlternates={buildHreflangAlternates('/enduro')}
      />

      <div className="valley-page">
        <SplitVideoHeroSection
          containerRef={containerRef}
          heroRef={heroRef}
          shouldPlayVideo={false}
          videoSrc={VALLEY_VIDEOS[season] || VALLEY_VIDEOS.summer}
          stillSrc={stillSrc}
          videoKey={season}
        >
          <div className="relative z-10 text-center px-4 max-w-4xl mx-auto w-full">
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.2 }}
              className="font-serif text-xs md:text-sm tracking-[0.2em] uppercase text-white/70 mb-2 drop-shadow-sm"
            >
              {e('hero.eyebrow')}
            </motion.p>
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.25 }}
              className="font-serif text-xs md:text-sm tracking-[0.2em] uppercase text-white/70 mb-4 drop-shadow-sm"
            >
              {e('hero.location')}
            </motion.p>

            <motion.h1
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.3 }}
              className="font-['Playfair_Display'] text-4xl sm:text-5xl md:text-6xl lg:text-7xl text-white font-semibold tracking-tight leading-tight drop-shadow-2xl mb-5 max-w-3xl mx-auto"
            >
              <span className="block text-sm sm:text-base tracking-[0.35em] font-semibold mb-2">
                {e('hero.titleSmall')}
              </span>
              {e('hero.title')}
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.38 }}
              className="text-base md:text-lg text-white/95 max-w-2xl font-serif leading-relaxed drop-shadow-sm mb-8 mx-auto"
            >
              {e('hero.subline')}
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.5 }}
              className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-8 px-4"
            >
              <Link to={bookTo} className={heroCtaClass}>
                {e('cta.primary')}
              </Link>
              <a
                href={INSTAGRAM_URL}
                target="_blank"
                rel="noopener noreferrer"
                className={heroSecondaryClass}
              >
                {e('instagram.handle')}
              </a>
            </motion.div>
          </div>
        </SplitVideoHeroSection>

        <section className="valley-section retreat-section-first">
          <div className="valley-container max-w-3xl mx-auto text-center">
            <p className="text-xs uppercase tracking-[0.35em] text-[#81887A] mb-3 font-serif">
              {e('promo.code')}
            </p>
            <h2 className="font-serif text-[#1a1a1a] mb-3 text-2xl md:text-3xl font-semibold leading-tight">
              {e('promo.offer')}
            </h2>
            <p className="valley-intro text-[#4a4a4a] mb-0">{e('promo.validity')}</p>
          </div>
        </section>

        <section className="valley-section">
          <div className="valley-container max-w-6xl mx-auto">
            <div className="max-w-3xl mb-10 md:mb-12">
              <p className="text-xs uppercase tracking-[0.35em] text-[#81887A] mb-4 font-serif">
                {e('proof.heading')}
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-10">
              {PROOF_KEYS.map((key) => (
                <div key={key} className="border-t border-black/10 pt-5">
                  <h3 className="font-serif text-[#1a1a1a] text-xl md:text-2xl font-semibold mb-3">
                    {e(`proof.${key}.title`)}
                  </h3>
                  <p className="font-serif text-base text-[#4a4a4a] leading-relaxed mb-0">
                    {e(`proof.${key}.body`)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="valley-section">
          <div className="valley-container max-w-3xl">
            <p className="text-xs uppercase tracking-[0.35em] text-[#81887A] mb-4 font-serif">
              {e('crew.eyebrow')}
            </p>
            <h2 className="font-serif text-[#1a1a1a] mb-4 text-3xl md:text-4xl lg:text-5xl font-semibold leading-tight">
              <span className="block">{e('crew.titleLine1')}</span>
              <span className="block">{e('crew.titleLine2')}</span>
            </h2>
            <p className="valley-intro text-[#4a4a4a] mb-4">{e('crew.body')}</p>
            <p className="font-serif text-base md:text-lg text-[#4a4a4a] italic mb-8">
              {e('crew.hook')}
            </p>
            <Link
              to={buyoutTo}
              className="inline-flex items-center justify-center border border-[#1a1a1a]/30 text-[#1a1a1a] px-10 py-4 font-medium uppercase tracking-wider text-sm hover:bg-[#1a1a1a]/5 transition-colors min-h-[52px] no-underline"
            >
              {e('cta.secondary')}
            </Link>
          </div>
        </section>

        <section className="valley-section">
          <div className="valley-container max-w-3xl mx-auto text-center">
            <p className="valley-intro text-[#4a4a4a] mb-3">{e('instagram.lead')}</p>
            <p className="font-serif text-2xl md:text-3xl text-[#1a1a1a] font-semibold mb-8">
              {e('instagram.handle')}
            </p>
            <a
              href={INSTAGRAM_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center bg-[#1a1a1a] text-white px-12 py-4 font-semibold uppercase tracking-wider text-sm hover:bg-[#2a2a2a] transition-colors min-h-[52px] shadow-lg no-underline"
            >
              {e('instagram.cta')}
            </a>
          </div>
        </section>

        <BookingCTABand
          primaryLabel={e('cta.primary')}
          secondaryLabel={e('cta.secondary')}
          onPrimaryClick={() => navigate(bookTo)}
          onSecondaryClick={() => navigate(buyoutTo)}
        />
      </div>
    </>
  );
}
