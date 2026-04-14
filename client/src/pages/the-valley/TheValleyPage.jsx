/* 
 * Design System Checklist (from premium retreat/hotel research):
 * 1. ✅ One continuous canvas background (light #fafafa)
 * 2. ✅ Consistent max-width container (1200px)
 * 3. ✅ Fixed vertical rhythm (80px desktop, 48px mobile section padding)
 * 4. ✅ Type scale: Playfair Display italic for headings, system sans for body
 * 5. ✅ Strict alignment and baseline repetition
 * 6. ✅ Consistent image aspect ratios (21:9 editorial, 4:5 portrait, 1:1 square)
 * 7. ✅ Editorial photo treatment: wide bands, portrait cards, square gallery
 * 8. ✅ Surface: translucent rgba(0,0,0,0.03), used sparingly
 * 9. ✅ Borders: 1px, rgba(0,0,0,0.12)
 * 10. ✅ Spacing scale: fixed increments (8px, 16px, 24px, 32px, 48px, 64px, 80px)
 */

import { Suspense, lazy } from 'react';
import '../../i18n/ns/valley';
import { useRef, useEffect, useLayoutEffect, useState } from 'react';
import { useLanguage } from '../../context/LanguageContext.jsx';
import { useSeason } from '../../context/SeasonContext';
import { locations } from '../../data/content';
import { NOISE_TEXTURE } from './data';
import HeroSection from './sections/HeroSection';
import EditorialHookSection from './sections/EditorialHookSection';
import StaysSection from './sections/StaysSection';
import VibeSection from './sections/VibeSection';
import ReviewsSection from './sections/ReviewsSection';
import PracticalDetailsAccordion from './sections/PracticalDetailsAccordion';
import BookingCTABand from './sections/BookingCTABand';
import { GMB_LOCATIONS, CONTACT_PHONE, INSTAGRAM_URL, FACEBOOK_URL } from '../../data/gmbLocations';
import { getSiteUrl } from '../../utils/siteUrl';
import './the-valley.css';
import Seo from '../../components/Seo';
import { buildHreflangAlternates } from '../../utils/localizedRoutes';

const BookingDrawer = lazy(() => import('../../components/BookingDrawer'));

const TheValleyPage = () => {
  const valley = locations.find(loc => loc.id === 'valley');
  const { season } = useSeason();
  const { language } = useLanguage();
  const heroRef = useRef(null);
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const accommodationsRef = useRef(null);
  const galleryRef = useRef(null);
  const trustBadgesRef = useRef(null);
  
  const [shouldLoadMedia, setShouldLoadMedia] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [isLowBandwidth, setIsLowBandwidth] = useState(false);

  // Smooth scroll to section
  const scrollToAccommodations = () => {
    accommodationsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Detect reduced motion preference
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

  // Detect low bandwidth / data saver
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

  // Load hero media when in view. useLayoutEffect so ref is set; fallback for mobile where IO can be unreliable.
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

  // Ensure video plays when component mounts and allowed
  useEffect(() => {
    if (!shouldPlayVideo) return;
    const playVideo = async () => {
      try {
        if (videoRef.current) {
          await videoRef.current.play();
        }
      } catch (error) {
        if (import.meta.env.DEV) console.log('Video autoplay blocked, will play on interaction');
      }
    };
    playVideo();
  }, [shouldPlayVideo, season]);

  if (!valley) {
    return (
      <div className="min-h-screen" style={{ backgroundColor: 'var(--valley-canvas)' }}>
        <div className="flex items-center justify-center min-h-screen">
          <p style={{ color: 'var(--valley-text-body)' }}>Valley information not found.</p>
        </div>
      </div>
    );
  }

  const origin = getSiteUrl();

  const valleyLoc = GMB_LOCATIONS.valley;
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'LodgingBusiness',
    '@id': `${origin}/valley#lodging`,
    name: valleyLoc.businessName,
    description: valleyLoc.description,
    url: valleyLoc.url,
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
    openingHoursSpecification: { '@type': 'OpeningHoursSpecification', dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'], opens: '00:00', closes: '23:59' },
    publisher: { '@id': `${origin}#organization` },
    sameAs: [INSTAGRAM_URL, FACEBOOK_URL]
  };

  const valleyBreadcrumbs = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${origin}/` },
      { '@type': 'ListItem', position: 2, name: 'The Valley', item: `${origin}/valley` }
    ]
  };
  const seoTitle =
    language === 'bg'
      ? 'Каменна къща в планината – The Valley от Drift & Dwells'
      : 'Mountain Stone House Retreat – The Valley by Drift & Dwells';
  const seoDescription =
    language === 'bg'
      ? 'The Valley в Черешово: каменна къща на 1550 м с 360° гледка, A-frame къщи, обща кухня, огнище и Starlink в каменната къща. За почивка и фокусирана работа.'
      : 'Stay at The Valley in Chereshovo—a historic stone house at 1,550m for deep rest and work. A-frame cabins, 360° views, shared kitchen, firepit, Starlink in the stone house.';

  return (
    <>
      <Seo
        title={seoTitle}
        description={seoDescription}
        canonicalPath="/valley"
        hreflangAlternates={buildHreflangAlternates('/valley')}
        ogType="place"
        ogImage="/uploads/Videos/The-Valley-firaplace-video.winter-poster.jpg"
        preloadImages={[season === 'summer'
          ? '/uploads/Videos/The-Valley-firaplace-video-poster.jpg'
          : '/uploads/Videos/The-Valley-firaplace-video.winter-poster.jpg']}
        jsonLd={[structuredData, valleyBreadcrumbs]}
      />
      <div 
        className="valley-page"
        style={{ 
          backgroundColor: 'var(--valley-canvas)',
          minHeight: '100vh'
        }}
      >
        <HeroSection
          containerRef={containerRef}
          heroRef={heroRef}
          videoRef={videoRef}
          shouldPlayVideo={shouldPlayVideo}
          scrollToAccommodations={scrollToAccommodations}
          noiseTexture={NOISE_TEXTURE}
        />

        <EditorialHookSection />

        <StaysSection accommodationsRef={accommodationsRef} />

        <VibeSection galleryRef={galleryRef} />

        <ReviewsSection trustBadgesRef={trustBadgesRef} />

        <PracticalDetailsAccordion />

        <BookingCTABand />

        {/* Mobile Sticky CTA - Same as Home */}
        <Suspense fallback={null}>
          <BookingDrawer />
        </Suspense>
      </div>
    </>
  );
};

export default TheValleyPage;
