import { motion } from 'framer-motion';
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useListingCoversBySlug } from '../../../hooks/useListingCoversBySlug';
import { useLocalizedPath } from '../../../hooks/useLocalizedPath';
import { getSEOAlt, getSEOTitle } from '../../../data/imageMetadata';
import {
  WINTER_VILLAGE_ACCOMMODATION_SECTION,
  WINTER_VILLAGE_ACCOMMODATIONS
} from '../winterVillageConfig';

export default function WinterVillageAccommodations({ prefersReducedMotion }) {
  const navigate = useNavigate();
  const lp = useLocalizedPath();

  const coverConfigs = useMemo(
    () =>
      WINTER_VILLAGE_ACCOMMODATIONS.map((acc) => ({
        slug: acc.listingSlug,
        fallbackUrl: acc.image,
        alt: acc.name
      })),
    []
  );
  const coversBySlug = useListingCoversBySlug(coverConfigs);

  return (
    <section id="winter-accommodations" className="valley-section">
      <div className="valley-container">
        <h2 className="valley-h2 mb-5 max-w-3xl">{WINTER_VILLAGE_ACCOMMODATION_SECTION.title}</h2>
        <p className="valley-intro mb-12 md:mb-16 max-w-2xl">
          {WINTER_VILLAGE_ACCOMMODATION_SECTION.intro}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-10 lg:gap-12">
          {WINTER_VILLAGE_ACCOMMODATIONS.map((acc, index) => {
            const liveCover = coversBySlug[acc.listingSlug];
            const imageSrc = liveCover?.url || acc.image;
            return (
              <motion.article
                key={acc.id}
                initial={prefersReducedMotion ? false : { opacity: 0, y: 20 }}
                whileInView={prefersReducedMotion ? undefined : { opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.55, delay: index * 0.08 }}
                className="flex flex-col"
              >
                <button
                  type="button"
                  className="relative w-full mb-5 rounded-xl overflow-hidden cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#81887A]"
                  style={{ aspectRatio: '4 / 5', backgroundColor: '#e8e8e8' }}
                  onClick={() => navigate(lp(acc.route))}
                  aria-label={`View ${acc.name} details`}
                >
                  <img
                    src={imageSrc}
                    alt={
                      getSEOAlt(acc.imagePath) ||
                      liveCover?.alt ||
                      `${acc.name} at The Valley`
                    }
                    title={getSEOTitle(acc.imagePath) || `${acc.name} — The Valley`}
                    className="w-full h-full object-cover transition-transform duration-500 hover:scale-105 motion-reduce:transition-none motion-reduce:hover:scale-100"
                    loading="lazy"
                    decoding="async"
                    width={640}
                    height={800}
                  />
                </button>
                <p className="text-sm font-medium text-[#81887A] mb-1">{acc.sleepsLabel}</p>
                <h3 className="font-serif text-2xl md:text-[1.75rem] text-[#1a1a1a] font-semibold mb-2">
                  {acc.name}
                </h3>
                {acc.note ? (
                  <p className="valley-body text-[#4a4a4a] text-sm md:text-base">{acc.note}</p>
                ) : null}
              </motion.article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
