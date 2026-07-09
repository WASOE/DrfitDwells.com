import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../../../context/LanguageContext.jsx';
import { useSeason } from '../../../context/SeasonContext';
import { locations } from '../../../data/content';
import { NOISE_TEXTURE } from '../../the-valley/data';
import HeroSection from '../../the-valley/sections/HeroSection';
import EditorialHookSection from '../../the-valley/sections/EditorialHookSection';
import ExclusiveUseSection from './ExclusiveUseSection';
import RetreatStaysSection from './RetreatStaysSection';
import VibeSection from '../../the-valley/sections/VibeSection';
import ReviewsSection from '../../the-valley/sections/ReviewsSection';
import LocationRetreatQuotePanel from './LocationRetreatQuotePanel';
import PracticalDetailsAccordion from '../../the-valley/sections/PracticalDetailsAccordion';
import BookingCTABand from '../../the-valley/sections/BookingCTABand';
import StickyBookingBar from '../../../components/StickyBookingBar';
import { GMB_LOCATIONS, CONTACT_PHONE, INSTAGRAM_URL, FACEBOOK_URL } from '../../../data/gmbLocations';
import { getSiteUrl } from '../../../utils/siteUrl';
import '../../the-valley/the-valley.css';
import Seo from '../../../components/Seo';
import { buildHreflangAlternates } from '../../../utils/localizedRoutes';
import '../../../i18n/ns/valley';
import '../../../i18n/ns/booking';

const TheValleyRetreatPage = () => {
  const valley = locations.find((loc) => loc.id === 'valley');
  const { season } = useSeason();
  const { language } = useLanguage();
  const { t: tb } = useTranslation('booking');
  const { t: tv } = useTranslation('valley');

  const containerRef = useRef(null);
  const heroRef = useRef(null);
  const videoRef = useRef(null);
  const accommodationsRef = useRef(null);
  const galleryRef = useRef(null);
  const trustBadgesRef = useRef(null);
  const quotePanelRef = useRef(null);

  const [shouldLoadMedia, setShouldLoadMedia] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [isLowBandwidth, setIsLowBandwidth] = useState(false);
  const [quote, setQuote] = useState(null);

  const scrollToAccommodations = useCallback(() => {
    accommodationsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const scrollToQuotePanel = useCallback(() => {
    quotePanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateMotionPreference = (event) => {
      setPrefersReducedMotion(event.matches);
    };
    setPrefersReducedMotion(mediaQuery.matches);
    mediaQuery.addEventListener('change', updateMotionPreference);
    return () => mediaQuery.removeEventListener('change', updateMotionPreference);
  }, []);

  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!connection) return;

    const updateConnectionPreference = () => {
      const lowTypes = ['slow-2g', '2g'];
      setIsLowBandwidth(connection.saveData || lowTypes.includes(connection.effectiveType));
    };

    updateConnectionPreference();
    connection.addEventListener?.('change', updateConnectionPreference);
    return () => connection.removeEventListener?.('change', updateConnectionPreference);
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

  useEffect(() => {
    if (!shouldPlayVideo) return;
    const playVideo = async () => {
      try {
        if (videoRef.current) {
          await videoRef.current.play();
        }
      } catch {
        // autoplay blocked
      }
    };
    playVideo();
  }, [shouldPlayVideo, season]);

  if (!valley) {
    return (
      <div className="min-h-screen" style={{ backgroundColor: 'var(--valley-canvas)' }}>
        <div className="flex items-center justify-center min-h-screen">
          <p style={{ color: 'var(--valley-text-body)' }}>{tv('errors.valleyNotFound')}</p>
        </div>
      </div>
    );
  }

  const origin = getSiteUrl();
  const valleyLoc = GMB_LOCATIONS.valley;
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'LodgingBusiness',
    '@id': `${origin}/retreats/the-valley#lodging`,
    name: `${valleyLoc.businessName} — Private Retreat`,
    description: tv('retreat.seo.description'),
    url: `${origin}/retreats/the-valley`,
    telephone: CONTACT_PHONE,
    image: [`${origin}/uploads/Videos/The-Valley-firaplace-video.winter-poster.jpg`],
    address: {
      '@type': 'PostalAddress',
      addressCountry: valleyLoc.address.country,
      addressRegion: valleyLoc.address.region,
      addressLocality: valleyLoc.address.locality,
      postalCode: valleyLoc.address.postalCode,
      streetAddress: valleyLoc.address.street || undefined
    },
    geo: {
      '@type': 'GeoCoordinates',
      latitude: valleyLoc.geo.latitude,
      longitude: valleyLoc.geo.longitude
    },
    hasMap: valleyLoc.getMapsUrl(),
    publisher: { '@id': `${origin}#organization` },
    sameAs: [INSTAGRAM_URL, FACEBOOK_URL]
  };

  const breadcrumbs = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${origin}/` },
      { '@type': 'ListItem', position: 2, name: 'The Valley', item: `${origin}/valley` },
      { '@type': 'ListItem', position: 3, name: 'Private Retreat', item: `${origin}/retreats/the-valley` }
    ]
  };

  const showStickyBar = quote?.available === true;

  return (
    <>
      <Seo
        title={tv('retreat.seo.title')}
        description={tv('retreat.seo.description')}
        canonicalPath="/retreats/the-valley"
        hreflangAlternates={buildHreflangAlternates('/retreats/the-valley')}
        ogType="place"
        ogImage="/uploads/Videos/The-Valley-firaplace-video.winter-poster.jpg"
        preloadImages={[
          season === 'summer'
            ? '/uploads/Videos/The-Valley-firaplace-video-poster.jpg'
            : '/uploads/Videos/The-Valley-firaplace-video.winter-poster.jpg'
        ]}
        jsonLd={[structuredData, breadcrumbs]}
      />
      <div
        className="valley-page"
        style={{
          backgroundColor: 'var(--valley-canvas)',
          minHeight: '100vh',
          paddingBottom: showStickyBar ? '5.5rem' : undefined
        }}
      >
        <HeroSection
          containerRef={containerRef}
          heroRef={heroRef}
          videoRef={videoRef}
          shouldPlayVideo={shouldPlayVideo}
          scrollToAccommodations={scrollToAccommodations}
          noiseTexture={NOISE_TEXTURE}
          primaryAction={{
            label: tb('cta.checkAvailability'),
            onClick: scrollToQuotePanel
          }}
          secondaryAction={{
            label: tv('retreat.hero.whatsIncluded'),
            onClick: scrollToAccommodations
          }}
        />

        <EditorialHookSection />

        <ExclusiveUseSection />

        <RetreatStaysSection
          accommodationsRef={accommodationsRef}
          includedTargets={quote?.includedTargets}
        />

        <VibeSection galleryRef={galleryRef} />

        <ReviewsSection trustBadgesRef={trustBadgesRef} />

        <section className="valley-section" aria-labelledby="retreat-booking-heading">
          <div className="valley-container max-w-xl mx-auto">
            <h2 id="retreat-booking-heading" className="sr-only">
              {tv('retreat.quote.panelTitle')}
            </h2>
            <LocationRetreatQuotePanel panelRef={quotePanelRef} onQuoteChange={setQuote} />
          </div>
        </section>

        <PracticalDetailsAccordion />

        <BookingCTABand
          onPrimaryClick={scrollToQuotePanel}
          primaryLabel={tb('cta.checkAvailability')}
        />

        {showStickyBar && (
          <StickyBookingBar
            className="lg:hidden"
            label={tb('details.stickyGrandTotal', {
              amount: Number(quote.totalPrice).toLocaleString()
            })}
            subLabel={tb('modal.nights', { count: quote.nights })}
            buttonLabel={tb('details.continueToPaymentShort')}
            onButtonClick={scrollToQuotePanel}
          />
        )}
      </div>
    </>
  );
};

export default TheValleyRetreatPage;
