import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Instagram } from 'lucide-react';
import Seo from '../../components/Seo';
import HeroResponsivePicture from '../../components/HeroResponsivePicture';
import PaidTrafficStaySelector from '../../components/PaidTrafficStaySelector';
import PaidTrafficStaysSheet from '../../components/PaidTrafficStaysSheet';
import BookingCTABand from '../the-valley/sections/BookingCTABand';
import { getValleyHeroResponsive, HERO_LCP_PRELOAD_WIDTH } from '../../config/heroResponsive';
import { INSTAGRAM_URL } from '../../data/gmbLocations';
import useValleyHeroStayItems from '../../hooks/useValleyHeroStayItems';
import { useLocalizedPath } from '../../hooks/useLocalizedPath';
import { buildHreflangAlternates } from '../../utils/localizedRoutes';
import { PAID_TRAFFIC_MOBILE_STICKY_CLEARANCE } from '../../utils/paidTrafficRoutes';
import '../../i18n/ns/seo';
import '../../i18n/ns/valley';
import '../the-valley/the-valley.css';

const PROMO_CODE = 'ENDURO';
const BOOK_PATH = '/stays/a-frame';
const BUYOUT_PATH = '/retreats/the-valley';
const UNIT_BOOKING_SEARCH = `promoCode=${PROMO_CODE}`;
const LCP_PRELOAD_HREF = `/media/hero/valley-summer-night-${HERO_LCP_PRELOAD_WIDTH}w.avif`;
const PROOF_KEYS = ['one', 'two', 'three'];

export default function Enduro() {
  const { t } = useTranslation('seo');
  const { t: tv } = useTranslation('valley');
  const lp = useLocalizedPath();
  const navigate = useNavigate();
  const e = (key, opts) => t(`enduro.${key}`, opts);
  const [sheetOpen, setSheetOpen] = useState(false);

  const { units, buyout, listings, buyoutInventory } = useValleyHeroStayItems({
    unitBookingSearch: UNIT_BOOKING_SEARCH
  });

  const bookTo = {
    pathname: lp(BOOK_PATH),
    search: `?${UNIT_BOOKING_SEARCH}`
  };
  const buyoutTo = lp(BUYOUT_PATH);
  const hero = getValleyHeroResponsive('summer');
  const heroAlt = `${e('hero.titleSmall')} ${e('hero.title')}`;

  const selectorLoading =
    listings.status === 'loading' || buyoutInventory.status === 'loading';

  const ctaLabels = useMemo(
    () => ({
      checkAvailability: tv('hero.selector.checkAvailability'),
      viewDetails: ''
    }),
    [tv]
  );

  const selectorItems = useMemo(() => {
    const unitItems = units.map((unit) => ({
      id: unit.id,
      title: unit.title,
      fit: unit.fit,
      sleepsLabel: unit.sleeps || undefined,
      price: unit.fromPrice || undefined,
      thumb: unit.cover?.url,
      thumbAlt: unit.cover?.alt,
      bookingTo: unit.bookingTo
    }));

    return [
      ...unitItems,
      {
        id: buyout.id,
        title: buyout.title,
        price: buyout.fromPriceLabel || undefined,
        promoted: true,
        bookingTo: buyout.bookingTo
      }
    ];
  }, [units, buyout]);

  return (
    <>
      <Seo
        title={e('metaTitle')}
        description={e('metaDescription')}
        canonicalPath="/enduro"
        ogImage={hero.fallbackSrc}
        preloadImages={[{ href: LCP_PRELOAD_HREF, type: 'image/avif', fetchPriority: 'high' }]}
        hreflangAlternates={buildHreflangAlternates('/enduro')}
      />

      <div
        className="valley-page pb-[var(--enduro-sticky-clearance)] md:pb-0"
        style={{
          backgroundColor: 'var(--valley-canvas)',
          minHeight: '100vh',
          '--enduro-sticky-clearance': PAID_TRAFFIC_MOBILE_STICKY_CLEARANCE
        }}
      >
        {/* Conversion hero — same selling shell as paid stays: media + selector */}
        <section className="border-b border-[rgba(0,0,0,0.08)]">
          <div className="valley-container py-5 md:py-8 lg:py-10">
            <div className="grid grid-cols-1 lg:grid-cols-2 lg:gap-10 lg:items-stretch lg:min-h-[560px]">
              <div className="relative overflow-hidden rounded-2xl bg-neutral-900 min-h-[320px] md:min-h-[420px] lg:min-h-full">
                <HeroResponsivePicture
                  avifSrcSet={hero.avifSrcSet}
                  webpSrcSet={hero.webpSrcSet}
                  fallbackSrc={hero.fallbackSrc}
                  width={hero.width}
                  height={hero.height}
                  sizes="(max-width: 1023px) 100vw, 50vw"
                  alt={heroAlt}
                  className="absolute inset-0 h-full w-full object-cover"
                  loading="eager"
                  fetchPriority="high"
                  decoding="async"
                />
                <div
                  className="absolute inset-0"
                  style={{
                    background:
                      'linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.45) 48%, rgba(0,0,0,0.15) 100%)'
                  }}
                />
                <div className="relative flex h-full min-h-[320px] md:min-h-[420px] lg:min-h-full flex-col justify-end p-5 md:p-7 lg:p-9">
                  <p className="font-serif text-[10px] md:text-xs uppercase tracking-[0.2em] text-white/75 mb-2">
                    {e('hero.eyebrow')} · {e('hero.location')}
                  </p>
                  <h1 className="font-['Playfair_Display'] text-3xl md:text-4xl lg:text-5xl font-semibold text-white tracking-tight leading-[1.1] max-w-xl">
                    <span className="block text-sm md:text-base tracking-[0.28em] font-semibold mb-2">
                      {e('hero.titleSmall')}
                    </span>
                    {e('hero.title')}
                  </h1>
                  <p className="mt-3 max-w-md font-serif text-base md:text-lg text-white/90 leading-snug italic">
                    {e('hero.subline')}
                  </p>
                  <p className="mt-4 inline-flex w-fit items-center rounded-full bg-white/15 px-3 py-1.5 text-[11px] md:text-xs font-semibold uppercase tracking-[0.14em] text-white backdrop-blur-sm">
                    {e('promo.offer')} · {e('promo.validity')}
                  </p>
                </div>
              </div>

              <div className="mt-6 lg:mt-0 lg:flex lg:flex-col lg:justify-center">
                <div className="mb-4 flex items-end justify-between gap-3">
                  <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-[#717171]">
                    {tv('hero.selector.label')}
                  </h2>
                  <p className="text-[11px] uppercase tracking-[0.12em] text-[#81887A]">
                    {e('promo.code')}
                  </p>
                </div>

                {selectorLoading ? (
                  <ul className="flex flex-col gap-2" aria-hidden="true">
                    {Array.from({ length: 4 }, (_, i) => (
                      <li key={i} className="h-[72px] rounded-lg bg-neutral-200 animate-pulse" />
                    ))}
                  </ul>
                ) : (
                  <>
                    <div className="lg:hidden">
                      <PaidTrafficStaySelector
                        items={selectorItems}
                        labels={ctaLabels}
                        layout="stack"
                      />
                    </div>
                    <div className="hidden lg:block">
                      <PaidTrafficStaySelector
                        items={selectorItems}
                        labels={ctaLabels}
                        layout="rows"
                      />
                    </div>
                  </>
                )}

                <div className="mt-5 flex flex-col sm:flex-row gap-3">
                  <button
                    type="button"
                    onClick={() => navigate(bookTo)}
                    className="inline-flex flex-1 items-center justify-center bg-[#1a1a1a] text-white px-6 py-3.5 font-semibold uppercase tracking-[0.18em] text-xs hover:bg-[#2a2a2a] transition-colors min-h-[48px]"
                  >
                    {e('cta.primary')}
                  </button>
                  <a
                    href={INSTAGRAM_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex flex-1 items-center justify-center gap-2 border border-[#1a1a1a]/25 text-[#1a1a1a] px-6 py-3.5 font-semibold uppercase tracking-[0.18em] text-xs hover:bg-[#1a1a1a]/5 transition-colors min-h-[48px] no-underline"
                  >
                    <Instagram className="h-4 w-4 shrink-0" aria-hidden="true" />
                    {e('instagram.handle')}
                  </a>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Instagram — primary festival goal, not a footer afterthought */}
        <section className="bg-stone-900 text-white">
          <div className="valley-container py-12 md:py-16 lg:py-20">
            <div className="mx-auto max-w-2xl text-center">
              <p className="font-serif text-xs uppercase tracking-[0.28em] text-white/60 mb-4">
                Instagram
              </p>
              <h2 className="font-['Playfair_Display'] text-3xl md:text-4xl lg:text-5xl font-semibold tracking-tight mb-3">
                {e('instagram.handle')}
              </h2>
              <p className="font-serif text-base md:text-lg text-white/80 mb-8 max-w-lg mx-auto">
                {e('instagram.lead')}
              </p>
              <a
                href={INSTAGRAM_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2.5 bg-[#F1ECE2] text-stone-900 px-10 py-4 font-bold uppercase tracking-[0.2em] text-xs md:text-sm hover:scale-[1.02] active:scale-[0.98] transition-transform min-h-[52px] no-underline shadow-lg"
              >
                <Instagram className="h-5 w-5 shrink-0" aria-hidden="true" />
                {e('instagram.cta')}
              </a>
            </div>
          </div>
        </section>

        <section className="valley-section">
          <div className="valley-container max-w-6xl mx-auto">
            <p className="text-xs uppercase tracking-[0.35em] text-[#81887A] mb-8 md:mb-10 font-serif">
              {e('proof.heading')}
            </p>
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

        <section className="valley-section border-t border-black/8">
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
            <button
              type="button"
              onClick={() => navigate(buyoutTo)}
              className="inline-flex items-center justify-center border border-[#1a1a1a]/30 text-[#1a1a1a] px-10 py-4 font-medium uppercase tracking-wider text-sm hover:bg-[#1a1a1a]/5 transition-colors min-h-[52px]"
            >
              {e('cta.secondary')}
            </button>
          </div>
        </section>

        <BookingCTABand
          primaryLabel={e('cta.primary')}
          secondaryLabel={e('cta.secondary')}
          onPrimaryClick={() => navigate(bookTo)}
          onSecondaryClick={() => navigate(buyoutTo)}
        />

        {/* Mobile sticky: follow + book — festival QR goals */}
        <div className="fixed bottom-0 left-0 w-full z-50 bg-stone-900/95 backdrop-blur-md border-t border-white/10 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden">
          <div className="mx-auto grid max-w-lg grid-cols-2 gap-2">
            <a
              href={INSTAGRAM_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[44px] items-center justify-center gap-1.5 bg-[#F1ECE2] text-stone-900 px-2 py-3 text-[10px] font-bold uppercase tracking-[0.14em] no-underline active:scale-[0.98] transition-transform touch-manipulation"
            >
              <Instagram className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {e('instagram.handle')}
            </a>
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              className="inline-flex min-h-[44px] items-center justify-center bg-white/10 text-white px-2 py-3 text-[10px] font-bold uppercase tracking-[0.14em] border border-white/20 active:scale-[0.98] transition-transform touch-manipulation"
            >
              {e('cta.primary')}
            </button>
          </div>
        </div>

        <PaidTrafficStaysSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          items={selectorItems}
          title={tv('hero.selector.label')}
          ariaLabel={tv('hero.selector.label')}
          closeLabel={t('paidStaysBulgaria.selector.close')}
          labels={ctaLabels}
        />
      </div>
    </>
  );
}
