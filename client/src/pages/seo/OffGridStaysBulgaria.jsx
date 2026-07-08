import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CABIN_MEDIA } from '../../config/mediaConfig';
import Seo from '../../components/Seo';
import { buildHreflangAlternates } from '../../utils/localizedRoutes';
import { useCabinNameToIdMap } from '../../hooks/useCabinNameToIdMap';
import { useConsentBannerOpen } from '../../hooks/useConsentBannerOpen';
import { useSiteLanguage } from '../../hooks/useSiteLanguage';
import { usePaidTrafficListingSlides } from '../../hooks/usePaidTrafficListingSlides';
import PaidTrafficStayCard from '../../components/PaidTrafficStayCard';
import PaidTrafficStaySelector from '../../components/PaidTrafficStaySelector';
import PaidTrafficStaysSheet from '../../components/PaidTrafficStaysSheet';
import PaidTrafficTrustStrip from '../../components/PaidTrafficTrustStrip';
import { PAID_TRAFFIC_STAY_META } from '../../data/paidTrafficLandingStays';
import { reviewAPI } from '../../services/api';
import { deriveDisplayName } from '../../utils/nameUtils';
import {
  buildPaidTrafficStayNavTarget,
  PAID_TRAFFIC_BOOKING_HASH,
  PAID_TRAFFIC_MOBILE_STICKY_CLEARANCE
} from '../../utils/paidTrafficRoutes';
import '../the-valley/the-valley.css';
import '../../i18n/ns/seo';

const OG_IMAGE_FALLBACK = CABIN_MEDIA.heroPoster.winter;

function sanitizeReviewText(text = '') {
  return String(text)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .trim();
}

export default function OffGridStaysBulgaria() {
  const { t } = useTranslation('seo');
  const { language } = useSiteLanguage();
  const consentBannerOpen = useConsentBannerOpen();
  const { primaryCabinId } = useCabinNameToIdMap();
  const { slidesByStayId, firstSlideUrl } = usePaidTrafficListingSlides();
  const [reviewSnippets, setReviewSnippets] = useState([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pastHero, setPastHero] = useState(false);
  const heroEndRef = useRef(null);

  const p = (key, opts) => t(`paidStaysBulgaria.${key}`, opts);

  const lcpPreloadHref =
    firstSlideUrl || PAID_TRAFFIC_STAY_META[0]?.fallbackImage || OG_IMAGE_FALLBACK;

  const ogImage = firstSlideUrl || PAID_TRAFFIC_STAY_META[0]?.fallbackImage || OG_IMAGE_FALLBACK;
  const heroImage = lcpPreloadHref;

  const bookingToById = useMemo(() => {
    const map = {};
    PAID_TRAFFIC_STAY_META.forEach((stay) => {
      if (stay.route) {
        map[stay.id] = buildPaidTrafficStayNavTarget(stay.route, language, {
          hash: PAID_TRAFFIC_BOOKING_HASH
        });
      }
    });
    return map;
  }, [language]);

  const detailsToById = useMemo(() => {
    const map = {};
    PAID_TRAFFIC_STAY_META.forEach((stay) => {
      if (!stay.showDetailsLink || !stay.route) return;
      map[stay.id] = buildPaidTrafficStayNavTarget(stay.route, language);
    });
    return map;
  }, [language]);

  const ctaLabels = {
    checkAvailability: p('cta.checkAvailability'),
    viewDetails: p('cta.viewDetails')
  };

  const sleepsLabel = p('comparison.labels.sleeps');

  const selectorItems = useMemo(
    () =>
      PAID_TRAFFIC_STAY_META.map((stay) => {
        const slide = slidesByStayId[stay.id]?.[0];
        const sleeps = t(`paidStaysBulgaria.stays.${stay.id}.comparison.sleeps`);
        return {
          id: stay.id,
          title: t(`paidStaysBulgaria.stays.${stay.id}.title`),
          fit: p(`selector.stays.${stay.id}.fit`),
          sleepsLabel: sleeps ? `${sleepsLabel} ${sleeps}` : '',
          price: p(`selector.stays.${stay.id}.price`),
          thumb: slide?.url,
          thumbAlt: slide?.alt,
          bookingTo: bookingToById[stay.id],
          detailsTo: detailsToById[stay.id],
          showDetailsLink: stay.showDetailsLink
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slidesByStayId, bookingToById, detailsToById, language]
  );

  useEffect(() => {
    const el = heroEndRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(
      ([entry]) => {
        setPastHero(!entry.isIntersecting && entry.boundingClientRect.top < 0);
      },
      { threshold: 0 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!primaryCabinId) return undefined;
    let active = true;
    (async () => {
      try {
        const revRes = await reviewAPI.getByCabinId(primaryCabinId, {
          limit: 4,
          sort: 'pinned_first',
          minRating: 2
        });
        if (!active || !revRes?.data?.success) return;
        const data = revRes.data?.data || {};
        const items = (data.items || []).filter(
          (r) => (r?.rating ?? 5) >= 2 && r?.status !== 'hidden'
        );
        setReviewSnippets(items.slice(0, 2));
      } catch {
        if (active) setReviewSnippets([]);
      }
    })();
    return () => {
      active = false;
    };
  }, [primaryCabinId]);

  const ratingDisplay = p('card.ratingDisplay');
  const imageBadge = p('card.imageBadge');
  const stickyVisible = !consentBannerOpen && pastHero;

  return (
    <>
      <Seo
        title={p('metaTitle')}
        description={p('metaDescription')}
        canonicalPath="/off-grid-stays-bulgaria"
        ogImage={ogImage}
        hreflangAlternates={buildHreflangAlternates('/off-grid-stays-bulgaria')}
        preloadImages={
          lcpPreloadHref ? [{ href: lcpPreloadHref, fetchPriority: 'high' }] : []
        }
      />

      <div
        className="valley-page pb-[var(--paid-sticky-clearance)] md:pb-0"
        style={{
          backgroundColor: 'var(--valley-canvas)',
          '--paid-sticky-clearance': PAID_TRAFFIC_MOBILE_STICKY_CLEARANCE
        }}
      >
        {/* Hero: dominant image + overlay copy (left) + visual stay selector (right) */}
        <section className="border-b border-[rgba(0,0,0,0.08)]">
          <div className="valley-container py-4 md:py-8">
            <div className="grid grid-cols-1 lg:grid-cols-2 lg:gap-8 lg:items-stretch lg:min-h-[560px]">
              <div className="relative overflow-hidden rounded-2xl bg-neutral-900 min-h-[300px] md:min-h-[400px] lg:min-h-full">
                {heroImage ? (
                  <img
                    src={heroImage}
                    alt={p('compact.title')}
                    className="absolute inset-0 h-full w-full object-cover"
                    fetchPriority="high"
                    decoding="async"
                  />
                ) : null}
                <div
                  className="absolute inset-0"
                  style={{
                    background:
                      'linear-gradient(to top, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.4) 45%, rgba(0,0,0,0.08) 100%)'
                  }}
                />
                <div className="relative flex h-full flex-col justify-end p-5 md:p-7 lg:p-9">
                  <p className="text-[10px] md:text-xs uppercase tracking-[0.16em] text-white/80 mb-2">
                    {p('compact.kicker')}
                  </p>
                  <h1 className="text-2xl md:text-3xl lg:text-4xl font-semibold text-white tracking-tight leading-tight max-w-xl">
                    {p('compact.title')}
                  </h1>
                  <p className="mt-2 max-w-md text-[13px] md:text-sm text-white/85 leading-snug">
                    {p('compact.subline')}
                  </p>
                  <p className="mt-1.5 max-w-md text-[13px] md:text-sm text-white/90 leading-snug">
                    {p('directBenefit')}
                  </p>
                  <PaidTrafficTrustStrip tone="light" className="mt-3" />
                </div>
              </div>

              <div className="mt-6 lg:mt-0 lg:flex lg:flex-col lg:justify-center">
                <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-[#717171] mb-3">
                  {p('selector.heading')}
                </h2>
                <div className="lg:hidden">
                  <PaidTrafficStaySelector items={selectorItems} labels={ctaLabels} layout="stack" />
                </div>
                <div className="hidden lg:block">
                  <PaidTrafficStaySelector items={selectorItems} labels={ctaLabels} layout="rows" />
                </div>
              </div>
            </div>
          </div>
        </section>

        <div ref={heroEndRef} aria-hidden className="h-px w-full" />

        {/* Detailed emotional cards */}
        <section
          id="stays"
          className="scroll-mt-24 border-t border-[rgba(0,0,0,0.06)]"
          style={{
            paddingTop: 'var(--valley-space-sm)',
            paddingBottom: 'var(--valley-section-padding-mobile)'
          }}
        >
          <div className="valley-container">
            <h2 className="text-xl md:text-2xl font-semibold text-[#1a1a1a] tracking-tight mb-5 md:mb-8">
              {p('exploreTitle')}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 md:gap-x-8 md:gap-y-10">
              {PAID_TRAFFIC_STAY_META.map((stay, index) => {
                const ns = `paidStaysBulgaria.stays.${stay.id}`;
                const title = t(`${ns}.title`);
                const price = p(`selector.stays.${stay.id}.price`);
                const fitLine = t(`${ns}.fitLine`);
                const specLine = `${sleepsLabel} ${t(`${ns}.comparison.sleeps`)}`;
                return (
                  <PaidTrafficStayCard
                    key={stay.id}
                    slides={slidesByStayId[stay.id] || []}
                    title={title}
                    price={price}
                    fitLine={fitLine}
                    specLine={specLine}
                    bookingTo={bookingToById[stay.id]}
                    detailsTo={detailsToById[stay.id]}
                    showDetailsLink={stay.showDetailsLink}
                    labels={ctaLabels}
                    ratingDisplay={ratingDisplay}
                    imageBadge={imageBadge}
                    eagerGallery={index === 0}
                  />
                );
              })}
            </div>
          </div>
        </section>

        {reviewSnippets.length > 0 ? (
          <section className="valley-section">
            <div className="valley-container">
              <p className="valley-caption mb-6 max-w-3xl">{p('reviews.caption')}</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-10">
                {reviewSnippets.map((r) => {
                  const raw = sanitizeReviewText(r.text);
                  const short = raw.length > 120 ? `${raw.slice(0, 120)}…` : raw;
                  return (
                    <figure key={r._id} className="border-t border-[rgba(0,0,0,0.12)] pt-6">
                      <blockquote className="valley-quote mb-3 max-w-xl">&ldquo;{short}&rdquo;</blockquote>
                      <figcaption className="valley-caption">
                        {deriveDisplayName(r)}
                        {r.rating ? <span className="text-[#81887A]"> · {r.rating}/5</span> : null}
                      </figcaption>
                    </figure>
                  );
                })}
              </div>
            </div>
          </section>
        ) : null}

        {stickyVisible ? (
          <div className="fixed bottom-0 left-0 w-full z-50 bg-stone-900/90 backdrop-blur-md border-t border-white/10 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] md:hidden">
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              className="w-full min-h-[44px] bg-[#F1ECE2] text-stone-900 py-3 rounded-none uppercase tracking-[0.2em] text-xs font-bold focus:outline-none focus:ring-2 focus:ring-[#F1ECE2]/50 active:scale-[0.98] transition-all duration-150 touch-manipulation"
            >
              {p('cta.viewFourStays')}
            </button>
          </div>
        ) : null}

        <PaidTrafficStaysSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          items={selectorItems}
          title={p('selector.sheetTitle')}
          ariaLabel={p('selector.sheetAria')}
          closeLabel={p('selector.close')}
          labels={ctaLabels}
        />
      </div>
    </>
  );
}
