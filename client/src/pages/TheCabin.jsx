import { useRef, useEffect, useLayoutEffect, useState } from 'react';
import '../i18n/ns/cabin';
import { motion, useInView } from 'framer-motion';
import { Link } from 'react-router-dom';
import { ChevronDown, Plus, Minus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { locations } from '../data/content';
import { useBookingSearch } from '../context/BookingSearchContext';
import { useLanguage } from '../context/LanguageContext.jsx';
import AuthorityStrip from '../components/AuthorityStrip';
import CabinGallerySection from '../components/CabinGallerySection';
import HeroSeasonToggle from '../components/HeroSeasonToggle';
import { useSeason } from '../context/SeasonContext';
import { CABIN_MEDIA } from '../config/mediaConfig';
import LivingNotesSection from '../components/LivingNotesSection';
import GMBContactStrip from '../components/GMBContactStrip';
import { GMB_LOCATIONS, CONTACT_PHONE } from '../data/gmbLocations';
import { getSEOAlt, getSEOTitle } from '../data/imageMetadata';
import Seo from '../components/Seo';
import { buildHreflangAlternates } from '../utils/localizedRoutes';
import { getSiteUrl } from '../utils/siteUrl';

const CABIN_VIDEOS = CABIN_MEDIA.heroVideo;
const CABIN_STILLS = CABIN_MEDIA.heroPoster;
const CABIN_STILL_FALLBACK = '/uploads/The Cabin/011f4645-32ce-4739-ac8e-16a900612ac7.jpeg';
const CABIN_TV_SPOT_VIDEO = '/uploads/The%20Cabin/AQOnA8J6vjthZGYKKRe0qmHusPOEmJT6SYQ5AzqsN-yecDFxGc--Wo-Ey0hwQhAbhXdKPglmKpGyUMygifhrpeTiiKzTosU6UakPU8w.mp4';

const TheCabin = () => {
  const cabin = locations.find(loc => loc.id === 'cabin');
  const { season } = useSeason();
  const { openModal } = useBookingSearch();
  const { language } = useLanguage();
  const heroRef = useRef(null);
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const realityRef = useRef(null);
  const faqRef = useRef(null);
  const [shouldLoadMedia, setShouldLoadMedia] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [isLowBandwidth, setIsLowBandwidth] = useState(false);
  const [openFaqIndex, setOpenFaqIndex] = useState(0); // First FAQ open by default

  const _realityInView = useInView(realityRef, { once: true, margin: '-100px' });
  const faqInView = useInView(faqRef, { once: true, margin: '-100px' });
  const trustBadgesRef = useRef(null);
  const _trustBadgesInView = useInView(trustBadgesRef, { once: true, margin: '-50px' });
  const { t } = useTranslation('cabin');

  // Smooth scroll to section
  const scrollToReality = () => {
    realityRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

  if (!cabin) {
    return (
      <div className="min-h-screen bg-[#1c1917] flex items-center justify-center">
        <p className="text-[#F1ECE2]">Cabin information not found.</p>
      </div>
    );
  }

  // The Reality Cards - text via i18n
  const realityCards = [
    {
      title: t('reality.cards.access.title'),
      body: t('reality.cards.access.body')
    },
    {
      title: t('reality.cards.power.title'),
      body: t('reality.cards.power.body')
    },
    {
      title: t('reality.cards.silence.title'),
      body: t('reality.cards.silence.body')
    },
    {
      title: t('reality.cards.connection.title'),
      body: t('reality.cards.connection.body')
    }
  ];

  // FAQ Questions - from i18n
  const faqQuestionsRaw = t('faq.questions', { returnObjects: true });
  const faqQuestions = (Array.isArray(faqQuestionsRaw) ? faqQuestionsRaw : []).map((faq) => {
    const parts = faq.answerParts || [];
    const answer = (
      <>
        {parts.map((part, i) =>
          part.type === 'p' ? (
            <p key={i} className="mb-4 text-neutral-400 leading-loose">{part.text}</p>
          ) : part.type === 'ul' ? (
            <ul key={i} className="list-disc list-inside space-y-2 mb-4 ml-4 text-neutral-400 leading-loose">
              {(part.items || []).map((item, j) => (
                <li key={j}>{item}</li>
              ))}
            </ul>
          ) : null
        )}
      </>
    );
    return { question: faq.question, answer };
  });

  const toggleFaq = (index) => {
    setOpenFaqIndex(openFaqIndex === index ? null : index);
  };


  // Noise texture SVG data URL
  const noiseTexture = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120' viewBox='0 0 120 120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)' opacity='0.05'/%3E%3C/svg%3E";

  // Grain overlay texture - Enhanced for paper feel
  const grainOverlay = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='grain'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23grain)'/%3E%3C/svg%3E";

  const origin = getSiteUrl();

  const cabinLoc = GMB_LOCATIONS.cabin;
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'LodgingBusiness',
    '@id': `${origin}/cabin#lodging`,
    name: cabinLoc.businessName,
    description: cabinLoc.description,
    url: cabinLoc.url,
    telephone: CONTACT_PHONE,
    image: [`${origin}${CABIN_STILLS.winter}`, `${origin}${CABIN_STILL_FALLBACK}`],
    address: {
      '@type': 'PostalAddress',
      addressCountry: cabinLoc.address.country,
      addressRegion: cabinLoc.address.region,
      addressLocality: cabinLoc.address.locality,
      postalCode: cabinLoc.address.postalCode,
      streetAddress: cabinLoc.address.street || undefined
    },
    geo: {
      '@type': 'GeoCoordinates',
      latitude: cabinLoc.geo.latitude,
      longitude: cabinLoc.geo.longitude
    },
    hasMap: cabinLoc.getMapsUrl(),
    openingHoursSpecification: { '@type': 'OpeningHoursSpecification', dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'], opens: '00:00', closes: '23:59' },
    publisher: { '@id': `${origin}#organization` },
    amenityFeature: [
      { '@type': 'LocationFeatureSpecification', name: 'Off-grid', value: true },
      { '@type': 'LocationFeatureSpecification', name: 'Wood stove heating', value: true },
      { '@type': 'LocationFeatureSpecification', name: 'Spring water', value: true },
      { '@type': 'LocationFeatureSpecification', name: 'No Wi-Fi', value: true }
    ]
  };

  const cabinBreadcrumbs = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${origin}/` },
      { '@type': 'ListItem', position: 2, name: 'The Cabin', item: `${origin}/cabin` }
    ]
  };
  const seoTitle =
    language === 'bg'
      ? 'Рустик къща в Родопи – The Cabin от Drift & Dwells'
      : 'Rustic Cabin in Rhodope Mountains – The Cabin by Drift & Dwells';
  const seoDescription =
    language === 'bg'
      ? 'Глемпинг в Бачево: уютна оф-грид дървена къща за двама с камина и звездно небе. За любители на природата и планинските маршрути.'
      : 'Glamping in Bachevo, Bulgaria: a cosy off-grid wooden cabin for two with a wood stove and clear night skies. For nature lovers and hikers in the Rhodopes.';

  return (
    <>
      <Seo
        title={seoTitle}
        description={seoDescription}
        canonicalPath="/cabin"
        hreflangAlternates={buildHreflangAlternates('/cabin')}
        ogType="place"
        ogImage={CABIN_STILLS.winter}
        preloadImages={[CABIN_STILLS[season] || CABIN_STILLS.winter]}
        jsonLd={[structuredData, cabinBreadcrumbs]}
      />
      <div className="relative min-h-screen bg-[#22201e] text-[#F1ECE2]" style={{ backgroundImage: `url("${noiseTexture}")`, backgroundRepeat: 'repeat' }}>
        {/* Enhanced Grain Overlay - Paper Texture */}
        <div 
          className="fixed inset-0 pointer-events-none opacity-[0.05] z-50"
          style={{
            backgroundImage: `url("${grainOverlay}")`,
            backgroundRepeat: 'repeat'
          }}
        />
        
        {/* Firelight Radial Gradients - Subtle warm spots */}
        <div className="fixed inset-0 pointer-events-none z-40">
          <div className="absolute top-1/4 left-1/4 w-[600px] h-[600px] bg-amber-500/5 rounded-full blur-3xl" />
          <div className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] bg-amber-400/5 rounded-full blur-3xl" />
        </div>
        
        {/* Hero Section */}
      <section 
        ref={containerRef}
        className="relative h-screen flex items-center justify-center overflow-hidden"
      >
        <motion.div
          ref={heroRef}
          className="absolute inset-0"
        >
          {!shouldPlayVideo ? (
            <img
              src={CABIN_STILLS[season]}
              alt={getSEOAlt(CABIN_STILLS[season]) || 'The Cabin (Bucephalus) - Off-grid mountain cabin exterior showing rustic wooden structure in forest setting near Bachevo, Rhodope Mountains, Bulgaria'}
              title={getSEOTitle(CABIN_STILLS[season]) || 'The Cabin - Off-Grid Mountain Retreat in Rhodope Mountains'}
              className="absolute inset-0 w-full h-full object-cover"
              loading="eager"
              fetchPriority="high"
              decoding="async"
              onError={(e) => {
                e.target.src = CABIN_STILL_FALLBACK;
              }}
              style={{
                minWidth: '100%',
                minHeight: '100%',
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                objectPosition: 'center 35%',
                transform: 'scale(1.4)',
                transformOrigin: 'center center'
              }}
            />
          ) : (
            <video
              key={season}
              ref={videoRef}
              className="absolute inset-0 w-full h-full object-cover"
              autoPlay
              loop
              muted
              playsInline
              preload="none"
              poster={CABIN_STILLS[season]}
              aria-label={getSEOAlt(CABIN_STILLS[season]) || 'Video showing The Cabin (Bucephalus) off-grid mountain cabin in forest setting near Bachevo, Rhodope Mountains, Bulgaria'}
              style={{
                minWidth: '100%',
                minHeight: '100%',
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                objectPosition: 'center 35%',
                transform: 'scale(1.4)',
                transformOrigin: 'center center'
              }}
            >
              <source src={CABIN_VIDEOS[season]} type="video/mp4" />
            </video>
          )}
        </motion.div>
        
          {/* Overlay */}
        <div className="absolute inset-0 bg-black/40" />

        <HeroSeasonToggle />
        
        {/* Content */}
        <div className="relative z-10 text-center px-4 max-w-4xl mx-auto">
          <motion.h1 
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
              className="font-['Playfair_Display'] text-5xl md:text-7xl lg:text-8xl text-[#F1ECE2] font-semibold tracking-tight leading-tight drop-shadow-2xl mb-4"
          >
              <span className="sr-only">Off grid cabin in the Rhodope Mountains | Drift & Dwells </span>{t('hero.title')}
          </motion.h1>
            
          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.25 }}
              className="font-serif text-sm md:text-base tracking-[0.2em] uppercase text-[#F1ECE2]/70"
          >
            {t('hero.subtitle')}
          </motion.p>
            
            <motion.p 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.3 }}
              className="mt-3 text-lg md:text-xl text-[#F1ECE2]/90 max-w-2xl mx-auto font-medium drop-shadow-sm"
            >
              {t('hero.body')}
            </motion.p>
            
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.4 }}
              className="flex flex-col sm:flex-row gap-4 justify-center items-center mt-8 px-4"
          >
            <button
              onClick={openModal}
              className="bg-white text-stone-900 px-6 sm:px-8 py-3 sm:py-4 font-bold uppercase tracking-[0.3em] text-xs sm:text-sm hover:scale-105 transition-transform shadow-xl border-none rounded-full min-h-[44px] touch-manipulation"
            >
              {t('hero.ctaPrimary')}
            </button>
            <button
              onClick={scrollToReality}
              className="border border-white/30 text-white px-6 sm:px-8 py-3 sm:py-4 font-medium uppercase tracking-[0.3em] text-xs sm:text-sm hover:bg-white/10 transition-all backdrop-blur-sm rounded-full min-h-[44px] touch-manipulation"
            >
              {t('hero.ctaSecondary')}
            </button>
          </motion.div>
        </div>

        {/* Scroll Indicator */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1, delay: 1.2 }}
          className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-2"
        >
          <motion.div
            animate={{ y: [0, 8, 0] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          >
            <ChevronDown className="w-6 h-6 text-[#F1ECE2]/60" />
          </motion.div>
        </motion.div>
      </section>

      {/* Trust Bar - Social Proof */}
        <section className="relative py-20 md:py-28 bg-[#121212] border-t border-white/10">
        <div className="max-w-7xl mx-auto px-4 md:px-8">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-12 items-center justify-center">
            <img 
              src="/uploads/Icons%20trival/guest+favorite+logo.webp" 
              alt="Guest Favorite" 
                className="h-36 md:h-48 w-auto opacity-90 mx-auto md:mx-0" 
              />
              <div className="text-center md:text-left">
                <p className="font-serif text-base md:text-lg tracking-widest uppercase text-white mb-1">
                  {t('trustBar.awardTitle')}
                </p>
                <p className="text-sm md:text-base text-neutral-400 italic">
                  {t('trustBar.awardSubtitle')}
                </p>
              </div>
              {/* Right Column: Media Feature */}
              <div className="flex flex-col items-center text-center">
                <h3 className="font-serif text-2xl md:text-3xl text-white mb-2">
                  {t('trustBar.featuredTitle')}
                </h3>
                <p className="text-[10px] md:text-xs tracking-[0.2em] text-neutral-400 uppercase">
                  {t('trustBar.featuredSubtitle')}
                </p>
              </div>
            </div>
        </div>
      </section>

        {/* Section: As seen on national TV - medicine commercial spot (non-disruptive, muted loop) */}
        <section className="relative py-16 md:py-24 bg-[#121212] border-t border-white/5">
          <div className="max-w-4xl mx-auto px-4 md:px-6">
            <p className="text-center text-[10px] md:text-xs tracking-[0.25em] text-neutral-500 uppercase mb-6">
              {t('trustBar.tvLabel')}
            </p>
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-50px' }}
              transition={{ duration: 0.6 }}
              className="relative rounded-2xl overflow-hidden border border-white/10 shadow-2xl bg-black"
            >
              <video
                src={CABIN_TV_SPOT_VIDEO}
                className="w-full aspect-video object-cover"
                muted
                loop
                playsInline
                autoPlay
                preload="metadata"
                aria-label="The Cabin featured in a national television commercial"
                title="The Cabin — as seen on national TV"
              />
              <div className="absolute inset-0 pointer-events-none rounded-2xl ring-1 ring-inset ring-white/5" aria-hidden />
            </motion.div>
            <p className="text-center font-serif text-sm text-neutral-500 mt-4 italic">
              {t('trustBar.tvCaption')}
            </p>
          </div>
        </section>

        {/* Section: The Narrative - Intro Copy */}
        <section className="relative py-20 md:py-28 bg-[#121212]">
          <div className="relative max-w-4xl mx-auto px-4 md:px-6">
            <p className="text-base text-neutral-400 leading-loose mb-6">
              {t('narrative.intro1')}
            </p>
            <p className="text-base text-neutral-400 leading-loose">
              {t('narrative.intro2')}
            </p>
            
            {/* Bold Statement */}
            <div className="mt-8">
              <p className="font-serif text-2xl md:text-3xl text-white font-bold tracking-wide mb-6">
                {t('narrative.statement')}
              </p>
              <button
                onClick={scrollToReality}
                className="text-sm uppercase tracking-widest text-neutral-400 hover:text-white transition-colors underline underline-offset-4"
              >
                {t('narrative.readReality')}
              </button>
            </div>
          </div>
        </section>

        {/* Section: The Reality - 2x2 Grid */}
        <section 
          ref={realityRef}
          id="reality"
          className="relative py-24 md:py-32 bg-[#121212]"
        >
          <div className="max-w-4xl mx-auto px-6">
            <h2 className="font-serif text-3xl md:text-4xl text-white mb-16">
              {t('reality.title')}
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-16">
              {/* CARD 1: ACCESS */}
              <div className="group">
                <div className="h-px w-full bg-white/20 mb-6"></div>
                <h3 className="font-serif text-2xl text-white mb-4">{realityCards[0].title}</h3>
                <p className="text-base text-neutral-400 leading-relaxed max-w-sm">
                  {realityCards[0].body}
                </p>
              </div>

              {/* CARD 2: POWER */}
              <div className="group">
                <div className="h-px w-full bg-white/20 mb-6"></div>
                <h3 className="font-serif text-2xl text-white mb-4">{realityCards[1].title}</h3>
                <p className="text-base text-neutral-400 leading-relaxed max-w-sm">
                  {realityCards[1].body}
                </p>
              </div>

              {/* CARD 3: SILENCE */}
              <div className="group">
                <div className="h-px w-full bg-white/20 mb-6"></div>
                <h3 className="font-serif text-2xl text-white mb-4">{realityCards[2].title}</h3>
                <p className="text-base text-neutral-400 leading-relaxed max-w-sm">
                  {realityCards[2].body}
                </p>
              </div>

              {/* CARD 4: CONNECTION */}
              <div className="group">
                <div className="h-px w-full bg-white/20 mb-6"></div>
                <h3 className="font-serif text-2xl text-white mb-4">{realityCards[3].title}</h3>
                <p className="text-base text-neutral-400 leading-relaxed max-w-sm">
                  {realityCards[3].body}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Trust Badges Row - AuthorityStrip Component with Invert Filter */}
        <section 
          ref={trustBadgesRef}
          className="relative"
        >
          <div className="invert">
            <AuthorityStrip />
          </div>
        </section>

        {/* Section: Practical Details */}
        <section className="bg-[#121212] py-12 md:py-24 border-t border-white/5">
          <div className="max-w-3xl mx-auto px-6">
            <h2 className="font-serif text-3xl md:text-4xl text-white text-center mb-12 md:mb-16">
              {t('practical.title')}
            </h2>

            <div className="flex flex-col">
              {/* Item 1 */}
              <div className="flex flex-col md:flex-row md:justify-between md:items-baseline border-b border-white/10 py-6">
                <span className="text-xs font-bold tracking-[0.2em] text-neutral-500 uppercase mb-2 md:mb-0">
                  {t('practical.items.sleeps.label')}
                </span>
                <span className="font-serif text-xl text-white text-left md:text-right">
                  {t('practical.items.sleeps.value')}
                </span>
              </div>

              {/* Item 2 */}
              <div className="flex flex-col md:flex-row md:justify-between md:items-baseline border-b border-white/10 py-6">
                <span className="text-xs font-bold tracking-[0.2em] text-neutral-500 uppercase mb-2 md:mb-0">
                  {t('practical.items.location.label')}
                </span>
                <span className="font-serif text-xl text-white text-left md:text-right">
                  {t('practical.items.location.value')}
                </span>
              </div>

              {/* Item 3 */}
              <div className="flex flex-col md:flex-row md:justify-between md:items-baseline border-b border-white/10 py-6">
                <span className="text-xs font-bold tracking-[0.2em] text-neutral-500 uppercase mb-2 md:mb-0">
                  {t('practical.items.access.label')}
                </span>
                <span className="font-serif text-xl text-white text-left md:text-right">
                  {t('practical.items.access.value')}
                </span>
              </div>

              {/* Item 4 */}
              <div className="flex flex-col md:flex-row md:justify-between md:items-baseline border-b border-white/10 py-6">
                <span className="text-xs font-bold tracking-[0.2em] text-neutral-500 uppercase mb-2 md:mb-0">
                  {t('practical.items.heating.label')}
                </span>
                <span className="font-serif text-xl text-white text-left md:text-right">
                  {t('practical.items.heating.value')}
                </span>
              </div>

              {/* Item 5 */}
              <div className="flex flex-col md:flex-row md:justify-between md:items-baseline border-b border-white/10 py-6">
                <span className="text-xs font-bold tracking-[0.2em] text-neutral-500 uppercase mb-2 md:mb-0">
                  {t('practical.items.water.label')}
                </span>
                <span className="font-serif text-xl text-white text-left md:text-right">
                  {t('practical.items.water.value')}
                </span>
              </div>

              {/* Item 6 */}
              <div className="flex flex-col md:flex-row md:justify-between md:items-baseline border-b border-white/10 py-6">
                <span className="text-xs font-bold tracking-[0.2em] text-neutral-500 uppercase mb-2 md:mb-0">
                  {t('practical.items.check.label')}
                </span>
                <span className="font-serif text-xl text-white text-left md:text-right">
                  {t('practical.items.check.value')}
                </span>
              </div>

              {/* Item 7 */}
              <div className="flex flex-col md:flex-row md:justify-between md:items-baseline border-b border-white/10 py-6">
                <span className="text-xs font-bold tracking-[0.2em] text-neutral-500 uppercase mb-2 md:mb-0">
                  {t('practical.items.pets.label')}
                </span>
                <span className="font-serif text-xl text-white text-left md:text-right">
                  {t('practical.items.pets.value')}
                </span>
              </div>
            </div>

            {/* GMB NAP strip - Get directions & Call */}
            <div className="mt-10 pt-10 border-t border-white/10">
              <GMBContactStrip locationKey="cabin" variant="dark" />
            </div>
          </div>
        </section>

        {/* Section: FAQ - Questions Before You Book */}
      <section 
          ref={faqRef}
          className="py-20 md:py-28 bg-[#121212]"
        >
          <div className="max-w-3xl mx-auto px-4 md:px-6">
            <h2 className="text-center font-serif text-2xl md:text-3xl text-white mb-10">
              {t('faq.title')}
            </h2>
            
            <div className="space-y-0">
              {faqQuestions.map((faq, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 20 }}
                  animate={faqInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
                  transition={{ duration: 0.6, delay: 0.1 + index * 0.1 }}
                  className="py-4"
                >
                  <button
                    onClick={() => toggleFaq(index)}
                    className="w-full flex items-center justify-between text-left hover:text-white transition-colors"
                  >
                    <h3 className="font-serif text-sm md:text-base font-medium text-white pr-4">
                      {faq.question}
                    </h3>
                    <div className="flex-shrink-0">
                      {openFaqIndex === index ? (
                        <Minus className="w-5 h-5 md:w-6 md:h-6 text-neutral-400 stroke-[1.5]" />
                      ) : (
                        <Plus className="w-5 h-5 md:w-6 md:h-6 text-neutral-400 stroke-[1.5]" />
                      )}
                    </div>
                  </button>
                  <motion.div
                    initial={false}
                    animate={{
                      height: openFaqIndex === index ? 'auto' : 0,
                      opacity: openFaqIndex === index ? 1 : 0
                    }}
                    transition={{ duration: 0.3, ease: 'easeInOut' }}
                    className="overflow-hidden"
                  >
                    <div className="text-xs md:text-sm text-neutral-400 leading-loose pt-3 pb-3">
                      {typeof faq.answer === 'string' ? <p>{faq.answer}</p> : faq.answer}
                  </div>
                  </motion.div>
                </motion.div>
              ))}
            </div>
            
            <div className="mt-10 text-center">
              <Link
                to="/cabin/faq"
                className="text-[11px] md:text-xs tracking-[0.2em] uppercase text-neutral-400 hover:text-white underline underline-offset-4"
              >
                {t('faq.link')}
              </Link>
            </div>
        </div>
      </section>

        {/* Section: The Vibe - Gallery with amenities/areas filter and image viewer */}
        <CabinGallerySection openModal={openModal} />

        {/* Section: Living Notes - Real reviews */}
        <LivingNotesSection />
      </div>
    </>
  );
};

export default TheCabin;
