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
import { useRef, useEffect, useState } from 'react';
import { useInView } from 'framer-motion';
import { locations } from '../../data/content';
import { NOISE_TEXTURE, GRAIN_OVERLAY } from './data';
import HeroSection from './sections/HeroSection';
import EditorialHookSection from './sections/EditorialHookSection';
import StaysSection from './sections/StaysSection';
import VibeSection from './sections/VibeSection';
import ReviewsSection from './sections/ReviewsSection';
import PracticalDetailsAccordion from './sections/PracticalDetailsAccordion';
import BookingCTABand from './sections/BookingCTABand';
import './the-valley.css';

const BookingDrawer = lazy(() => import('../../components/BookingDrawer'));

const TheValleyPage = () => {
  const valley = locations.find(loc => loc.id === 'valley');
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

  // Lazy-load media only when hero is near viewport
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShouldLoadMedia(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(containerRef.current);
    return () => observer.disconnect();
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
        console.log('Video autoplay blocked, will play on interaction');
      }
    };
    playVideo();
  }, [shouldPlayVideo]);

  if (!valley) {
    return (
      <div className="min-h-screen" style={{ backgroundColor: 'var(--valley-canvas)' }}>
        <div className="flex items-center justify-center min-h-screen">
          <p style={{ color: 'var(--valley-text-body)' }}>Valley information not found.</p>
        </div>
      </div>
    );
  }

  return (
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
  );
};

export default TheValleyPage;
