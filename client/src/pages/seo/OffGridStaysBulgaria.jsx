import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CABIN_MEDIA } from '../../config/mediaConfig';
import Seo from '../../components/Seo';
import { buildHreflangAlternates } from '../../utils/localizedRoutes';
import { useLocalizedPath } from '../../hooks/useLocalizedPath';
import { useCabinNameToIdMap } from '../../hooks/useCabinNameToIdMap';
import { usePaidTrafficListingSlides } from '../../hooks/usePaidTrafficListingSlides';
import { useBookingSearch } from '../../context/BookingSearchContext';
import PaidTrafficStayCard from '../../components/PaidTrafficStayCard';
import { PAID_TRAFFIC_STAY_META } from '../../data/paidTrafficLandingStays';
import { reviewAPI } from '../../services/api';
import { deriveDisplayName } from '../../utils/nameUtils';
import '../the-valley/the-valley.css';
import '../../i18n/ns/seo';

const OG_IMAGE = CABIN_MEDIA.heroPoster.winter;

const CMP_KEYS = ['bestFor', 'sleeps', 'privacy', 'comfort', 'access'];

function sanitizeReviewText(text = '') {
  return String(text)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .trim();
}

export default function OffGridStaysBulgaria() {
  const { t } = useTranslation('seo');
  const lp = useLocalizedPath();
  const { openModal } = useBookingSearch();
  const { nameToId, primaryCabinId, loading: linksLoading } = useCabinNameToIdMap();
  const { slidesByStayId, firstSlideUrl } = usePaidTrafficListingSlides();
  const staysRef = useRef(null);
  const [reviewSnippets, setReviewSnippets] = useState([]);

  const p = (key, opts) => t(`paidStaysBulgaria.${key}`, opts);

  const scrollToStays = useCallback(() => {
    staysRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const lcpPreloadHref =
    firstSlideUrl || PAID_TRAFFIC_STAY_META[0]?.image || OG_IMAGE;

  const bookingHrefById = useMemo(() => {
    const map = {};
    PAID_TRAFFIC_STAY_META.forEach((stay) => {
      if (stay.linkKind === 'route') {
        map[stay.id] = lp(stay.route);
        return;
      }
      if (stay.linkKind === 'primary') {
        map[stay.id] = primaryCabinId ? lp(`/cabin/${primaryCabinId}`) : null;
        return;
      }
      if (stay.linkKind === 'backend' && stay.backendName) {
        const id = nameToId[stay.backendName.trim().toLowerCase()];
        map[stay.id] = id ? lp(`/cabin/${id}`) : null;
      }
    });
    return map;
  }, [lp, nameToId, primaryCabinId]);

  const detailsHrefById = useMemo(() => {
    const map = {};
    PAID_TRAFFIC_STAY_META.forEach((stay) => {
      if (!stay.detailsPath) return;
      let path = lp(stay.detailsPath);
      if (stay.detailsHash) path += `#${stay.detailsHash}`;
      map[stay.id] = path;
    });
    return map;
  }, [lp]);

  useEffect(() => {
    if (!primaryCabinId) return;
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

  const linksLoaded = !linksLoading;
  const ctaLabels = {
    checkDates: p('cta.checkDates'),
    viewDetails: p('cta.viewDetails'),
    loading: p('cta.loading')
  };

  const reassuranceLines = t('paidStaysBulgaria.reassurance', { returnObjects: true });
  const reassurance =
    Array.isArray(reassuranceLines) && reassuranceLines.length > 0 ? reassuranceLines : [];

  const ratingDisplay = p('card.ratingDisplay');
  const imageBadge = p('card.imageBadge');

  return (
    <>
      <Seo
        title={p('metaTitle')}
        description={p('metaDescription')}
        canonicalPath="/off-grid-stays-bulgaria"
        ogImage={OG_IMAGE}
        hreflangAlternates={buildHreflangAlternates('/off-grid-stays-bulgaria')}
        preloadImages={
          lcpPreloadHref ? [{ href: lcpPreloadHref, fetchPriority: 'high' }] : []
        }
      />

      <div className="valley-page" style={{ backgroundColor: 'var(--valley-canvas)' }}>
        {/* Compact header — no full-bleed image; stays visible immediately below */}
        <header className="border-b border-[rgba(0,0,0,0.08)] bg-[var(--valley-canvas)]">
          <div className="valley-container py-3 md:py-4">
            <p className="valley-label !text-[10px] md:!text-xs !tracking-[0.12em] text-[#717171] mb-1">
              {p('compact.kicker')}
            </p>
            <h1 className="text-lg md:text-xl font-semibold text-[#1a1a1a] tracking-tight leading-snug max-w-2xl">
              {p('compact.title')}
            </h1>
            <p className="valley-caption mt-1 max-w-xl !text-[13px] leading-snug text-[#717171]">
              {p('compact.subline')}
            </p>
          </div>
        </header>

        {/* Listing feed — first screen is accommodations */}
        <section
          ref={staysRef}
          id="stays"
          className="scroll-mt-20 border-t border-[rgba(0,0,0,0.06)]"
          style={{
            paddingTop: 'var(--valley-space-sm)',
            paddingBottom: 'var(--valley-section-padding-mobile)'
          }}
        >
          <div className="valley-container">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 md:gap-x-8 md:gap-y-10">
              {PAID_TRAFFIC_STAY_META.map((stay, index) => {
                const ns = `paidStaysBulgaria.stays.${stay.id}`;
                const title = t(`${ns}.title`);
                const price = t(`${ns}.price`);
                const fitLine = t(`${ns}.fitLine`);
                const specLine = `${p('comparison.labels.sleeps')} ${t(`${ns}.comparison.sleeps`)}`;
                return (
                  <PaidTrafficStayCard
                    key={stay.id}
                    slides={slidesByStayId[stay.id] || []}
                    title={title}
                    price={price}
                    fitLine={fitLine}
                    specLine={specLine}
                    bookingHref={bookingHrefById[stay.id]}
                    detailsHref={detailsHrefById[stay.id]}
                    showDetailsLink={stay.showDetailsLink}
                    linksLoaded={linksLoaded}
                    onAvailabilityFallback={openModal}
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

        {reassurance.length > 0 ? (
          <section className="valley-section">
            <div className="valley-container">
              <div className="border border-[rgba(0,0,0,0.12)] rounded-xl overflow-hidden bg-white">
                <ul className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-[rgba(0,0,0,0.12)]">
                  {reassurance.map((line) => (
                    <li key={line} className="p-5 md:p-6 valley-body text-[#4a4a4a] text-sm md:text-[15px]">
                      {line}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        ) : null}

        <section className="valley-section">
          <div className="valley-container">
            <p className="valley-caption mb-6 max-w-3xl">{p('reviews.caption')}</p>
            {reviewSnippets.length > 0 ? (
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
            ) : null}
          </div>
        </section>

        <section className="valley-section">
          <div className="valley-container">
            <h2 className="valley-h2 mb-2">{p('comparison.title')}</h2>
            <p className="valley-intro mb-8 md:mb-10 max-w-2xl">{p('comparison.hint')}</p>

            <div className="border border-[rgba(0,0,0,0.12)] rounded-xl overflow-hidden bg-white mb-8">
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-[rgba(0,0,0,0.12)]">
                {PAID_TRAFFIC_STAY_META.map((stay) => {
                  const ns = `paidStaysBulgaria.stays.${stay.id}`;
                  const title = t(`${ns}.title`);
                  return (
                    <div key={stay.id} className="p-6 md:p-8">
                      <h3
                        className="text-base md:text-lg font-semibold text-[#1a1a1a] mb-4 tracking-tight"
                        style={{ fontFamily: 'var(--valley-font-primary, Montserrat, sans-serif)' }}
                      >
                        {title}
                      </h3>
                      <div className="space-y-2 valley-body text-[#4a4a4a]">
                        {CMP_KEYS.map((key) => (
                          <div key={key}>
                            <span className="font-semibold text-[#1a1a1a]">
                              {p(`comparison.labels.${key}`)}:{' '}
                            </span>
                            {t(`${ns}.comparison.${key}`)}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <button
              type="button"
              onClick={scrollToStays}
              className="text-[#1a1a1a] font-semibold hover:text-[#81887A] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#81887A] valley-body"
            >
              {p('comparison.ctaBack')}
            </button>
          </div>
        </section>

        <div className="fixed bottom-0 left-0 w-full h-[70px] z-50 bg-stone-900/90 backdrop-blur-md border-t border-white/10 p-4 safe-area-bottom md:hidden flex items-center">
          <button
            type="button"
            onClick={openModal}
            className="w-full bg-[#F1ECE2] text-stone-900 py-3 rounded-none uppercase tracking-[0.2em] text-xs font-bold focus:outline-none focus:ring-2 focus:ring-[#F1ECE2]/50 active:scale-[0.98] transition-all duration-150 touch-manipulation"
          >
            {p('cta.stickyCheckAvailability')}
          </button>
        </div>
      </div>
    </>
  );
}
