import { lazy, Suspense } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useBookingSearch } from '../../../context/BookingSearchContext';
import { useSeason } from '../../../context/SeasonContext';
import { getSEOAlt, getSEOTitle } from '../../../data/imageMetadata';
import SplitVideoHeroSection from '../../../components/hero/SplitVideoHeroSection';
import SplitHeroDesktopLayout from '../../../components/hero/SplitHeroDesktopLayout';
import HeroBookingCardShell from '../../../components/hero/HeroBookingCardShell';
import { ValleyHeroStayListSkeleton } from '../ValleyHeroStayList';
import { VALLEY_VIDEOS, VALLEY_STILLS } from '../data';
import '../../../i18n/ns/valley';

const ValleyHeroStayList = lazy(() => import('../ValleyHeroStayList'));

function ValleyHeroStayListCardFallback() {
  const { t } = useTranslation('valley');

  return (
    <HeroBookingCardShell>
      <div className="valley-hero-stay-list w-full max-w-md">
        <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-[#717171] mb-3">
          {t('hero.selector.label')}
        </p>
        <ValleyHeroStayListSkeleton />
      </div>
    </HeroBookingCardShell>
  );
}

/**
 * /valley browse hero — copy left, stay selector card right on desktop.
 * Optional `copy` / `stayListProps` let campaign pages reuse the same shell.
 */
const ValleyBrowseHeroSection = ({
  containerRef,
  heroRef,
  videoRef,
  shouldPlayVideo,
  scrollToAccommodations,
  primaryAction = null,
  secondaryAction = null,
  copy = null,
  stayListProps = null,
  forceStill = false
}) => {
  const { openModal } = useBookingSearch();
  const { season } = useSeason();
  const { t } = useTranslation('valley');

  const resolvedPrimary = primaryAction || {
    label: t('hero.ctaPrimary'),
    onClick: openModal
  };
  const resolvedSecondary = secondaryAction || {
    label: t('hero.ctaSecondary'),
    onClick: scrollToAccommodations
  };

  const microLabel = copy?.microLabel ?? t('hero.microLabel');
  const mobileTitle = copy?.mobileTitle ?? t('hero.title');
  const mobileSubtitle = copy?.mobileSubtitle ?? t('hero.subtitle');
  const mobileBody1 = copy?.mobileBody1 ?? t('hero.body1');
  const mobileBody2 = copy?.mobileBody2 ?? t('hero.body2');
  const desktopHeadline = copy?.desktopHeadline ?? t('hero.browse.headline');
  const desktopSubline = copy?.desktopSubline ?? t('hero.browse.subline');
  const desktopExploreLabel = copy?.desktopExploreLabel ?? t('hero.browse.ctaExploreStays');
  const showMobileBodies = copy?.hideMobileBodies !== true;
  const playVideo = forceStill ? false : shouldPlayVideo;

  return (
    <SplitVideoHeroSection
      containerRef={containerRef}
      heroRef={heroRef}
      videoRef={videoRef}
      shouldPlayVideo={playVideo}
      videoSrc={VALLEY_VIDEOS[season]}
      stillSrc={VALLEY_STILLS[season]}
      stillAlt={
        getSEOAlt(VALLEY_STILLS[season]) ||
        'The Valley: A Village Above the Clouds - Mountain village at 1,550m altitude showing A-frames, stone house, and mountain landscape, Chereshovo/Ortsevo, Rhodope Mountains, Bulgaria'
      }
      stillTitle={
        getSEOTitle(VALLEY_STILLS[season]) || 'The Valley - A Village Above the Clouds at 1,550m Altitude'
      }
      videoKey={season}
      altitudeBadgeText={t('hero.altitudeBadge')}
      videoAriaLabel="Video showing The Valley mountain village with fireplace and mountain landscape at 1,550m altitude, Chereshovo/Ortsevo, Rhodope Mountains, Bulgaria"
    >
      {/* Mobile / tablet: preserve existing centered browse hero */}
      <div className="relative z-10 text-center px-4 max-w-4xl mx-auto lg:hidden w-full">
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="font-serif text-xs md:text-sm tracking-[0.2em] uppercase text-white/70 mb-4 drop-shadow-sm"
        >
          {microLabel}
        </motion.p>

        <motion.h1
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.3 }}
          className="font-['Playfair_Display'] text-5xl md:text-7xl text-white font-semibold tracking-tight leading-tight drop-shadow-2xl mb-3"
        >
          {mobileTitle}
        </motion.h1>

        {mobileSubtitle ? (
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.35 }}
            className="font-serif text-xl md:text-2xl text-white/95 font-normal tracking-tight mb-6 drop-shadow-sm"
          >
            {mobileSubtitle}
          </motion.h2>
        ) : null}

        {showMobileBodies ? (
          <>
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.4 }}
              className="text-base md:text-lg text-white/90 max-w-2xl mx-auto font-serif leading-relaxed drop-shadow-sm mb-3"
            >
              {mobileBody1}
            </motion.p>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.45 }}
              className="text-base md:text-lg text-white/90 max-w-2xl mx-auto font-serif leading-relaxed drop-shadow-sm mb-8"
            >
              {mobileBody2}
            </motion.p>
          </>
        ) : (
          <div className="mb-8" />
        )}

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.5 }}
          className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-8 px-4"
        >
          <button
            type="button"
            onClick={resolvedPrimary.onClick}
            className="bg-white text-stone-900 px-6 sm:px-8 py-3 sm:py-4 font-bold uppercase tracking-[0.3em] text-xs sm:text-sm hover:scale-105 transition-transform shadow-xl border-none rounded-full min-h-[44px] touch-manipulation"
          >
            {resolvedPrimary.label}
          </button>
          <button
            type="button"
            onClick={resolvedSecondary.onClick}
            className="border border-white/30 text-white px-6 sm:px-8 py-3 sm:py-4 font-medium uppercase tracking-[0.3em] text-xs sm:text-sm hover:bg-white/10 transition-all backdrop-blur-sm rounded-full min-h-[44px] touch-manipulation"
          >
            {resolvedSecondary.label}
          </button>
        </motion.div>
      </div>

      <SplitHeroDesktopLayout
        copyColumn={
          <>
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.2 }}
              className="font-serif text-sm tracking-[0.2em] uppercase text-white/70 mb-4 drop-shadow-sm"
            >
              {microLabel}
            </motion.p>

            <motion.h1
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.3 }}
              className="font-['Playfair_Display'] text-5xl xl:text-6xl 2xl:text-7xl text-white font-semibold tracking-tight leading-tight drop-shadow-2xl mb-5 max-w-2xl"
            >
              {desktopHeadline}
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.38 }}
              className="text-base md:text-lg text-white/90 max-w-2xl font-serif leading-relaxed drop-shadow-sm mb-8"
            >
              {desktopSubline}
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.5 }}
              className="flex justify-start items-center mb-4"
            >
              <button
                type="button"
                onClick={resolvedSecondary.onClick}
                className="border border-white/30 text-white px-8 py-4 font-medium uppercase tracking-[0.3em] text-sm hover:bg-white/10 transition-all backdrop-blur-sm rounded-full min-h-[44px] touch-manipulation"
              >
                {desktopExploreLabel}
              </button>
            </motion.div>
          </>
        }
        renderCardSlot={(isDesktopHero) =>
          isDesktopHero ? (
            <Suspense fallback={<ValleyHeroStayListCardFallback />}>
              <HeroBookingCardShell>
                <ValleyHeroStayList {...(stayListProps || {})} />
              </HeroBookingCardShell>
            </Suspense>
          ) : (
            <ValleyHeroStayListCardFallback />
          )
        }
      />
    </SplitVideoHeroSection>
  );
};

export default ValleyBrowseHeroSection;
