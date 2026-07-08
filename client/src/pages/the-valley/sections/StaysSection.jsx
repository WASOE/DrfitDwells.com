import { motion } from 'framer-motion';
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useBookingSearch } from '../../../context/BookingSearchContext';
import { useLocalizedPath } from '../../../hooks/useLocalizedPath';
import { useListingCoversBySlug } from '../../../hooks/useListingCoversBySlug';
import { getSEOAlt, getSEOTitle } from '../../../data/imageMetadata';
import { STAY_CARDS } from '../data';

const StaysSection = ({ accommodationsRef }) => {
  const { openModal } = useBookingSearch();
  const navigate = useNavigate();
  const lp = useLocalizedPath();
  const { t } = useTranslation('valley');

  const cardLinks = useMemo(() => {
    const map = {};
    STAY_CARDS.forEach((card) => {
      if (card.route) {
        map[card.id] = card.route;
      }
    });
    return map;
  }, []);

  const coverConfigs = useMemo(
    () =>
      STAY_CARDS.filter((card) => card.listingSlug).map((card) => ({
        slug: card.listingSlug,
        fallbackUrl: card.fallbackImage,
        alt: card.title
      })),
    []
  );
  const coversBySlug = useListingCoversBySlug(coverConfigs);

  const handleCardAction = (card) => {
    const href = cardLinks[card.id];
    if (href) {
      navigate(lp(href));
    } else {
      openModal();
    }
  };

  return (
    <section 
      ref={accommodationsRef}
      id="accommodations"
      className="valley-section"
      style={{ paddingTop: 0, borderTop: 'none' }}
    >
      <div className="valley-container">
        {/* H2 - Section Title */}
        <h2 className="font-serif text-[#1a1a1a] mb-8 stays-section-title" style={{ fontSize: '48px', fontWeight: 800 }}>
          <style>{`
            @media (max-width: 768px) {
              .stays-section-title {
                font-size: 34px !important;
              }
            }
          `}</style>
          {t('stays.title')}
        </h2>

        {/* Intro Sentence */}
        <p className="font-serif mb-16 max-w-3xl stays-intro" style={{ fontSize: '18px', fontWeight: 500 }}>
          <style>{`
            @media (max-width: 768px) {
              .stays-intro {
                font-size: 16px !important;
              }
            }
          `}</style>
          {t('stays.intro')}
        </p>

        {/* Compare Strip - Aligned Under Intro */}
        <div className="mb-12 border border-[rgba(0,0,0,0.12)] rounded-xl overflow-hidden bg-white">
          <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-[rgba(0,0,0,0.12)]">
            {STAY_CARDS.map((stay, index) => {
              const bullets = t(`stays.cards.${stay.id}.bullets`, { returnObjects: true });
              const bullet0 = Array.isArray(bullets) ? bullets[0] : stay.bullets[0];
              return (
              <div key={index} className="p-6 md:p-8">
                <div className="flex items-baseline justify-between gap-2 mb-4">
                  <h3 className="text-lg font-semibold text-[#1a1a1a]">{t(`stays.cards.${stay.id}.title`)}</h3>
                  {stay.price && <span className="text-sm font-medium text-[#81887A] shrink-0">{stay.price}</span>}
                </div>
                <div className="space-y-2 valley-body text-[#4a4a4a]">
                  <div><strong className="text-[#1a1a1a] font-semibold">{t('stays.labels.sleeps')}</strong> {t(`stays.cards.${stay.id}.sleeps`)}</div>
                  <div>
                    <strong className="text-[#1a1a1a] font-semibold">{t('stays.labels.bestFor')}</strong>{' '}
                    {(() => {
                      let key = 'default';
                      if (stay.id === 'stone-house') key = 'stoneHouse';
                      else if (stay.id === 'a-frames') key = 'aFrames';
                      return t(`stays.bestFor.${key}`);
                    })()}
                  </div>
                  <div><strong className="text-[#1a1a1a] font-semibold">{t('stays.labels.keyFeature')}</strong> {bullet0}</div>
                </div>
              </div>
            );
            })}
          </div>
        </div>

        {/* 3 Stay Cards - Same Baseline, Same Ratios, Same Spacing */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-12">
          {STAY_CARDS.map((card, index) => {
            const slugKey = String(card.listingSlug || '').trim().toLowerCase();
            const liveCover = slugKey ? coversBySlug[slugKey] : null;
            const imageSrc = liveCover?.url || card.fallbackImage;
            return (
            <motion.div
              key={card.id}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: index * 0.1 }}
              className="flex flex-col"
            >
              {/* Image - Consistent Ratio */}
              <div 
                className="relative w-full mb-6 rounded-xl overflow-hidden cursor-pointer"
                style={{ aspectRatio: '4 / 5', backgroundColor: '#e8e8e8' }}
                onClick={() => handleCardAction(card)}
              >
                <img 
                  src={imageSrc}
                  alt={getSEOAlt(card.imagePath) || liveCover?.alt || `${card.title} at The Valley showing comfortable space and mountain views`}
                  title={getSEOTitle(card.imagePath) || `${card.title} - Mountain Retreat at The Valley`}
                  className="w-full h-full object-cover transition-transform duration-500 hover:scale-105"
                  loading="lazy"
                  decoding="async"
                />
              </div>

              {/* Text - Aligned Baseline */}
              <div className="flex-1 flex flex-col">
                {card.price && (
                  <p className="text-sm font-medium text-[#81887A] mb-2">{card.price}</p>
                )}
                <h3 className="font-serif text-[#1a1a1a] mb-3 stay-card-title" style={{ fontSize: '28px', fontWeight: 600 }}>
                  <style>{`
                    @media (max-width: 768px) {
                      .stay-card-title {
                        font-size: 22px !important;
                      }
                    }
                  `}</style>
                  {t(`stays.cards.${card.id}.title`)}
                </h3>
                <p className="font-serif text-[#4a4a4a] mb-5" style={{ fontSize: '13px', fontWeight: 400, opacity: 0.65 }}>
                  {(() => {
                    const b = t(`stays.cards.${card.id}.bullets`, { returnObjects: true });
                    return Array.isArray(b) ? b[0] : card.bullets[0];
                  })()}
                </p>
                
                {/* CTAs */}
                  <div className="flex items-center gap-4 md:gap-6 mt-auto pt-4 border-t border-[rgba(0,0,0,0.12)]">
                  <button
                    onClick={() => handleCardAction(card)}
                    className="text-[#1a1a1a] font-semibold hover:text-[#81887A] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#81887A]"
                  >
                    {t('stays.cta.checkDates')}
                  </button>
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      handleCardAction(card);
                    }}
                    className="text-[#6a6a6a] text-sm hover:text-[#1a1a1a] transition-colors underline underline-offset-4"
                  >
                    {t('stays.cta.viewDetails')}
                  </a>
                </div>
              </div>
            </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default StaysSection;
