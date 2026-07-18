import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Seo from '../../components/Seo';
import ValleyBrowseHeroSection from '../the-valley/sections/ValleyBrowseHeroSection';
import BookingCTABand from '../the-valley/sections/BookingCTABand';
import { useSeason } from '../../context/SeasonContext';
import { INSTAGRAM_URL } from '../../data/gmbLocations';
import { useLocalizedPath } from '../../hooks/useLocalizedPath';
import { buildHreflangAlternates } from '../../utils/localizedRoutes';
import { VALLEY_STILLS } from '../the-valley/data';
import '../../i18n/ns/seo';
import '../the-valley/the-valley.css';

const BookingDrawer = lazy(() => import('../../components/BookingDrawer'));

const PROMO_CODE = 'ENDURO';
const BOOK_PATH = '/stays/a-frame';
const BUYOUT_PATH = '/retreats/the-valley';
const UNIT_BOOKING_SEARCH = `promoCode=${PROMO_CODE}`;
const PROOF_KEYS = ['one', 'two', 'three'];

export default function Enduro() {
  const { t } = useTranslation('seo');
  const { season } = useSeason();
  const lp = useLocalizedPath();
  const navigate = useNavigate();
  const e = (key, opts) => t(`enduro.${key}`, opts);

  const containerRef = useRef(null);
  const heroRef = useRef(null);
  const videoRef = useRef(null);
  const proofRef = useRef(null);

  const [shouldLoadMedia, setShouldLoadMedia] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [isLowBandwidth, setIsLowBandwidth] = useState(false);

  const bookTo = {
    pathname: lp(BOOK_PATH),
    search: `?${UNIT_BOOKING_SEARCH}`
  };
  const buyoutTo = lp(BUYOUT_PATH);
  const stillSrc = VALLEY_STILLS[season] || VALLEY_STILLS.summer;

  const scrollToProof = useCallback(() => {
    proofRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = (event) => setPrefersReducedMotion(event.matches);
    setPrefersReducedMotion(mediaQuery.matches);
    mediaQuery.addEventListener('change', update);
    return () => mediaQuery.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (typeof navigator === 'undefined') return undefined;
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!connection) return undefined;
    const update = () => {
      const lowTypes = ['slow-2g', '2g'];
      setIsLowBandwidth(connection.saveData || lowTypes.includes(connection.effectiveType));
    };
    update();
    connection.addEventListener?.('change', update);
    return () => connection.removeEventListener?.('change', update);
  }, []);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (el) {
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            setShouldLoadMedia(true);
            observer.disconnect();
          }
        },
        { rootMargin: '200px' }
      );
      observer.observe(el);
      const fallback = setTimeout(() => setShouldLoadMedia(true), 200);
      return () => {
        observer.disconnect();
        clearTimeout(fallback);
      };
    }
    const fallback = setTimeout(() => setShouldLoadMedia(true), 200);
    return () => clearTimeout(fallback);
  }, []);

  const shouldPlayVideo = shouldLoadMedia && !prefersReducedMotion && !isLowBandwidth;

  const heroTitle = `${e('hero.titleSmall')} ${e('hero.title')}`;

  return (
    <>
      <Seo
        title={e('metaTitle')}
        description={e('metaDescription')}
        canonicalPath="/enduro"
        ogImage={stillSrc}
        hreflangAlternates={buildHreflangAlternates('/enduro')}
      />

      <div
        className="valley-page"
        style={{
          backgroundColor: 'var(--valley-canvas)',
          minHeight: '100vh'
        }}
      >
        <div className="retreat-page">
          <ValleyBrowseHeroSection
            containerRef={containerRef}
            heroRef={heroRef}
            videoRef={videoRef}
            shouldPlayVideo={shouldPlayVideo}
            scrollToAccommodations={scrollToProof}
            forceStill
            copy={{
              microLabel: e('hero.location'),
              mobileTitle: heroTitle,
              mobileSubtitle: e('hero.subline'),
              hideMobileBodies: true,
              desktopHeadline: heroTitle,
              desktopSubline: e('hero.subline'),
              desktopExploreLabel: e('instagram.handle')
            }}
            primaryAction={{
              label: e('cta.primary'),
              onClick: () => navigate(bookTo)
            }}
            secondaryAction={{
              label: e('instagram.handle'),
              onClick: () => window.open(INSTAGRAM_URL, '_blank', 'noopener,noreferrer')
            }}
            stayListProps={{ unitBookingSearch: UNIT_BOOKING_SEARCH }}
          />
        </div>

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

        <section ref={proofRef} className="valley-section">
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
            <button
              type="button"
              onClick={() => navigate(buyoutTo)}
              className="inline-flex items-center justify-center border border-[#1a1a1a]/30 text-[#1a1a1a] px-10 py-4 font-medium uppercase tracking-wider text-sm hover:bg-[#1a1a1a]/5 transition-colors min-h-[52px]"
            >
              {e('cta.secondary')}
            </button>
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

        <Suspense fallback={null}>
          <BookingDrawer />
        </Suspense>
      </div>
    </>
  );
}
