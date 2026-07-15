import { lazy, Suspense, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useSeason } from '../../../context/SeasonContext';
import SplitVideoHeroSection from '../../../components/hero/SplitVideoHeroSection';
import SplitHeroDesktopLayout from '../../../components/hero/SplitHeroDesktopLayout';
import HeroCardCalendarFallback from '../../../components/hero/HeroCardCalendarFallback';
import { VALLEY_VIDEOS, VALLEY_STILLS } from '../../the-valley/data';
import '../../../i18n/ns/valley';

const RetreatBookingCalendar = lazy(() => import('./RetreatBookingCalendar'));
const RetreatBookingSheet = lazy(() => import('./RetreatBookingSheet'));

function formatEuroAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '';
  return amount.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function HeroInventoryLines({ capacityLine, fromPriceLine, inventoryLoading, centered = true }) {
  const alignClass = centered ? 'mx-auto' : '';

  if (inventoryLoading) {
    return (
      <div className={`space-y-3 mb-8 max-w-xl ${alignClass}`} aria-hidden="true">
        <div className="h-5 bg-white/20 rounded-full w-64 animate-pulse" />
        <div className="h-5 bg-white/20 rounded-full w-72 animate-pulse" />
      </div>
    );
  }

  return (
    <>
      {capacityLine && (
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.38 }}
          className={`text-base md:text-lg text-white/95 max-w-2xl font-serif leading-relaxed drop-shadow-sm mb-3 ${alignClass}`}
        >
          {capacityLine}
        </motion.p>
      )}
      {fromPriceLine && (
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.42 }}
          className={`text-base md:text-lg text-white font-semibold max-w-2xl font-serif leading-relaxed drop-shadow-sm mb-8 ${alignClass}`}
        >
          {fromPriceLine}
        </motion.p>
      )}
    </>
  );
}

const RetreatHeroSection = ({
  containerRef,
  heroRef,
  videoRef,
  shouldPlayVideo,
  scrollToAccommodations,
  scrollToQuotePanel: _scrollToQuotePanel,
  inventory,
  inventoryLoading
}) => {
  const { season } = useSeason();
  const { t } = useTranslation('valley');
  const { t: tb } = useTranslation('booking');
  const [bookingSheetOpen, setBookingSheetOpen] = useState(false);
  const [bookingSheetMounted, setBookingSheetMounted] = useState(false);
  const checkAvailabilityRef = useRef(null);

  const openMobileBookingSheet = () => {
    setBookingSheetMounted(true);
    setBookingSheetOpen(true);
  };

  const closeMobileBookingSheet = () => {
    setBookingSheetOpen(false);
  };

  const capacityLine =
    inventory && !inventoryLoading
      ? t('retreat.hero.capacity', {
          sleeps: inventory.totalSleeps,
          buildings: inventory.buildingCount
        })
      : null;

  const fromPriceLine =
    inventory?.fromPrice && !inventoryLoading
      ? t('retreat.hero.fromPrice', {
          nightly: formatEuroAmount(inventory.fromPrice.nightlyTotal),
          nights: inventory.fromPrice.nights
        })
      : null;

  return (
    <SplitVideoHeroSection
      containerRef={containerRef}
      heroRef={heroRef}
      videoRef={videoRef}
      shouldPlayVideo={shouldPlayVideo}
      videoSrc={VALLEY_VIDEOS[season]}
      stillSrc={VALLEY_STILLS[season]}
      videoKey={season}
      endSlot={
        bookingSheetMounted ? (
          <Suspense fallback={null}>
            <RetreatBookingSheet
              open={bookingSheetOpen}
              onClose={closeMobileBookingSheet}
              inventory={inventory}
              triggerRef={checkAvailabilityRef}
            />
          </Suspense>
        ) : null
      }
    >
        {/* Mobile / tablet: unchanged centered hero */}
        <div className="relative z-10 text-center px-4 max-w-4xl mx-auto lg:hidden w-full">
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="font-serif text-xs md:text-sm tracking-[0.2em] uppercase text-white/70 mb-4 drop-shadow-sm"
          >
            {t('retreat.hero.eyebrow')}
          </motion.p>

          <motion.h1
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.3 }}
            className="font-['Playfair_Display'] text-4xl sm:text-5xl md:text-6xl lg:text-7xl text-white font-semibold tracking-tight leading-tight drop-shadow-2xl mb-5 max-w-3xl mx-auto"
          >
            {t('retreat.hero.title')}
          </motion.h1>

          <HeroInventoryLines
            capacityLine={capacityLine}
            fromPriceLine={fromPriceLine}
            inventoryLoading={inventoryLoading}
            centered
          />

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.5 }}
            className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-8 px-4"
          >
            <button
              ref={checkAvailabilityRef}
              type="button"
              onClick={openMobileBookingSheet}
              className="bg-white text-stone-900 px-6 sm:px-8 py-3 sm:py-4 font-bold uppercase tracking-[0.3em] text-xs sm:text-sm hover:scale-105 transition-transform shadow-xl border-none rounded-full min-h-[44px] touch-manipulation"
            >
              {tb('cta.checkAvailability')}
            </button>
            <button
              type="button"
              onClick={scrollToAccommodations}
              className="border border-white/30 text-white px-6 sm:px-8 py-3 sm:py-4 font-medium uppercase tracking-[0.3em] text-xs sm:text-sm hover:bg-white/10 transition-all backdrop-blur-sm rounded-full min-h-[44px] touch-manipulation"
            >
              {t('retreat.hero.whatsIncluded')}
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
                {t('retreat.hero.eyebrow')}
              </motion.p>

              <motion.h1
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.3 }}
                className="font-['Playfair_Display'] text-5xl xl:text-6xl 2xl:text-7xl text-white font-semibold tracking-tight leading-tight drop-shadow-2xl mb-5 max-w-2xl"
              >
                {t('retreat.hero.title')}
              </motion.h1>

              <HeroInventoryLines
                capacityLine={capacityLine}
                fromPriceLine={fromPriceLine}
                inventoryLoading={inventoryLoading}
                centered={false}
              />

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.5 }}
                className="flex justify-start items-center mb-4"
              >
                <button
                  type="button"
                  onClick={scrollToAccommodations}
                  className="border border-white/30 text-white px-8 py-4 font-medium uppercase tracking-[0.3em] text-sm hover:bg-white/10 transition-all backdrop-blur-sm rounded-full min-h-[44px] touch-manipulation"
                >
                  {t('retreat.hero.whatsIncluded')}
                </button>
              </motion.div>
            </>
          }
          renderCardSlot={(isDesktopHero) =>
            isDesktopHero ? (
              <Suspense fallback={<HeroCardCalendarFallback />}>
                <RetreatBookingCalendar variant="hero-card" slug="the-valley" inventory={inventory} />
              </Suspense>
            ) : (
              <HeroCardCalendarFallback />
            )
          }
        />
      </SplitVideoHeroSection>
  );
};

export default RetreatHeroSection;
