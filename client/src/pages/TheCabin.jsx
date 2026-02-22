import { useRef, useEffect, useState } from 'react';
import { motion, useInView } from 'framer-motion';
import { Link } from 'react-router-dom';
import { ChevronDown, Plus, Minus } from 'lucide-react';
import { locations } from '../data/content';
import { useBookingSearch } from '../context/BookingSearchContext';
import AuthorityStrip from '../components/AuthorityStrip';
import { getSEOAlt, getSEOTitle } from '../data/imageMetadata';

const CABIN_VIDEO = '/uploads/Videos/The-cabin-header.mp4';
const CABIN_STILL = '/uploads/Videos/The-cabin-header-poster.jpg';
const CABIN_STILL_FALLBACK = '/uploads/The Cabin/011f4645-32ce-4739-ac8e-16a900612ac7.jpeg';

const TheCabin = () => {
  const cabin = locations.find(loc => loc.id === 'cabin');
  const { openModal } = useBookingSearch();
  const heroRef = useRef(null);
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const realityRef = useRef(null);
  const faqRef = useRef(null);
  const [shouldLoadMedia, setShouldLoadMedia] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [isLowBandwidth, setIsLowBandwidth] = useState(false);
  const [openFaqIndex, setOpenFaqIndex] = useState(0); // First FAQ open by default

  const realityInView = useInView(realityRef, { once: true, margin: '-100px' });
  const faqInView = useInView(faqRef, { once: true, margin: '-100px' });
  const trustBadgesRef = useRef(null);
  const trustBadgesInView = useInView(trustBadgesRef, { once: true, margin: '-50px' });

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

  if (!cabin) {
    return (
      <div className="min-h-screen bg-[#1c1917] flex items-center justify-center">
        <p className="text-[#F1ECE2]">Cabin information not found.</p>
      </div>
    );
  }

  // The Reality Cards - Brutal Filter Statements
  const realityCards = [
    {
      title: 'Access',
      statement: 'High clearance recommended. Normal cars can reach the cabin but expect a rough forest road.',
      explanation: 'Drive slowly over bumps and stones, especially after rain.'
    },
    {
      title: 'Power',
      statement: 'Off grid solar only. No hair dryers. No AC.',
      explanation: 'Power is limited and must be used with care.'
    },
    {
      title: 'Silence',
      statement: 'No neighbors. No road noise.',
      explanation: 'Nights are very dark and very quiet.'
    },
    {
      title: 'Connection',
      statement: 'No wifi. Only emergency Starlink if needed.',
      explanation: 'You cannot work remotely from here.'
    }
  ];

  // FAQ Questions - Filter Questions
  const faqQuestions = [
    {
      question: 'How do I get to the cabin and what is the road like?',
      answer: (
        <>
          <p className="mb-4 text-neutral-400 leading-loose">The cabin is reached by a rough forest road. High clearance is recommended, though normal cars can reach it if driven very slowly.</p>
          <ul className="list-disc list-inside space-y-2 mb-4 ml-4 text-neutral-400 leading-loose">
            <li>Winter: Snow and ice make the road challenging. Allow extra time and drive with extreme caution.</li>
            <li>Spring: Mud after rain makes the road slippery and slow going.</li>
            <li>Summer: Dry conditions are easiest, but dust can be heavy and the road remains rough.</li>
          </ul>
          <p className="text-neutral-400 leading-loose">The drive from the main road to the cabin typically takes 15-20 minutes depending on conditions and vehicle.</p>
        </>
      )
    },
    {
      question: 'What should I expect with electricity and charging?',
      answer: (
        <>
          <p className="mb-4 text-neutral-400 leading-loose">There are no normal power outlets in the cabin.</p>
          <ul className="list-disc list-inside space-y-2 ml-4 text-neutral-400 leading-loose">
            <li>A small solar system provides power for lights only.</li>
            <li>You must bring your own power banks or battery packs to charge phones and devices.</li>
            <li>No kettles, hair dryers, or high-consumption devices can be used.</li>
            <li>The solar system cannot support appliances beyond basic lighting.</li>
          </ul>
        </>
      )
    },
    {
      question: 'How does water and bathing work?',
      answer: (
        <>
          <p className="mb-4 text-neutral-400 leading-loose">Drinking water comes from a spring source. You collect water using containers or taps provided at the cabin.</p>
          <ul className="list-disc list-inside space-y-2 mb-4 ml-4 text-neutral-400 leading-loose">
            <li>Warm water for washing is prepared manually, typically using a basin system heated on the wood stove.</li>
            <li>In winter, water freezes more easily and the system works slower. Allow extra time for water preparation.</li>
            <li>This is a manual, hands-on process that requires effort and patience.</li>
          </ul>
        </>
      )
    },
    {
      question: 'How is the cabin heated, especially in winter?',
      answer: (
        <>
          <p className="mb-4 text-neutral-400 leading-loose">The main heat source is a wood stove. You must light and maintain the fire yourself throughout your stay.</p>
          <ul className="list-disc list-inside space-y-2 ml-4 text-neutral-400 leading-loose">
            <li>Firewood is provided, but you are responsible for keeping the fire going.</li>
            <li>You must be comfortable using and monitoring a wood stove safely.</li>
            <li>Nights can be very cold, especially in winter. Bring proper warm clothing and layers regardless of season.</li>
            <li>The cabin can get cold if the fire is not maintained consistently.</li>
          </ul>
        </>
      )
    },
    {
      question: 'How does the hot tub work and what should I know?',
      answer: (
        <>
          <p className="mb-4 text-neutral-400 leading-loose">The hot tub is wood-fired and requires significant time and effort to heat.</p>
          <ul className="list-disc list-inside space-y-2 mb-4 ml-4 text-neutral-400 leading-loose">
            <li>It takes 4-6 hours to heat from cold to usable temperature.</li>
            <li>It consumes a large amount of firewood. You must decide if you want to commit the time and wood needed.</li>
            <li>In winter, heating takes longer and may be impractical due to freezing risks.</li>
            <li>You are responsible for lighting and maintaining the fire that heats the tub.</li>
          </ul>
        </>
      )
    },
    {
      question: 'Is there internet or phone signal?',
      answer: (
        <>
          <p className="mb-4 text-neutral-400 leading-loose">No. There is no wifi and mobile reception is weak or completely absent at the cabin.</p>
          <ul className="list-disc list-inside space-y-2 ml-4 text-neutral-400 leading-loose">
            <li>This is a full digital detox location with no reliable connectivity.</li>
            <li>In emergencies, you must walk or drive back towards the village to regain phone signal.</li>
            <li>Plan accordingly. Download any maps, information, or entertainment before arriving.</li>
          </ul>
        </>
      )
    }
  ];

  const toggleFaq = (index) => {
    setOpenFaqIndex(openFaqIndex === index ? null : index);
  };


  // Living Notes quotes for bottom section (no duplicates with pull quote)
  const livingNotes = [
    {
      text: "We brewed pine needle tea at dawn. The steam looked like soft handwriting.",
      author: "Daniela"
    },
    {
      text: "The journal we found on the shelf had pressed ferns from guests we will never meet.",
      author: "Petra & Ivo"
    },
    {
      text: "Three days without a screen. We remembered how to listen.",
      author: "Markus"
    }
  ];

  // Noise texture SVG data URL
  const noiseTexture = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120' viewBox='0 0 120 120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)' opacity='0.05'/%3E%3C/svg%3E";

  // Grain overlay texture - Enhanced for paper feel
  const grainOverlay = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='grain'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23grain)'/%3E%3C/svg%3E";

  return (
    <>
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
              src={CABIN_STILL}
              alt={getSEOAlt(CABIN_STILL) || 'The Cabin (Bucephalus) - Off-grid mountain cabin exterior showing rustic wooden structure in forest setting near Bachevo, Rhodope Mountains, Bulgaria'}
              title={getSEOTitle(CABIN_STILL) || 'The Cabin - Off-Grid Mountain Retreat in Rhodope Mountains'}
              className="absolute inset-0 w-full h-full object-cover"
              loading="lazy"
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
                  transform: 'scale(1.2)',
                transformOrigin: 'center center'
              }}
            />
          ) : (
            <video
              ref={videoRef}
              className="absolute inset-0 w-full h-full object-cover"
              autoPlay
              loop
              muted
              playsInline
              preload="metadata"
              poster={CABIN_STILL}
              aria-label={getSEOAlt(CABIN_STILL) || 'Video showing The Cabin (Bucephalus) off-grid mountain cabin in forest setting near Bachevo, Rhodope Mountains, Bulgaria'}
              style={{
                minWidth: '100%',
                minHeight: '100%',
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                  transform: 'scale(1.2)',
                transformOrigin: 'center center'
              }}
            >
              <source src={CABIN_VIDEO} type="video/mp4" />
            </video>
          )}
        </motion.div>
        
          {/* Overlay */}
        <div className="absolute inset-0 bg-black/40" />
        
        {/* Content */}
        <div className="relative z-10 text-center px-4 max-w-4xl mx-auto">
          <motion.h1 
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
              className="font-['Playfair_Display'] text-5xl md:text-7xl lg:text-8xl text-[#F1ECE2] font-semibold tracking-tight leading-tight drop-shadow-2xl mb-4"
          >
              <span className="sr-only">Off grid cabin in the Rhodope Mountains | Drift & Dwells </span>The Cabin
          </motion.h1>
            
          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.25 }}
              className="font-serif text-sm md:text-base tracking-[0.2em] uppercase text-[#F1ECE2]/70"
          >
            The Art of Subtraction
          </motion.p>
            
            <motion.p 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.3 }}
              className="mt-3 text-lg md:text-xl text-[#F1ECE2]/90 max-w-2xl mx-auto font-medium drop-shadow-sm"
            >
              Off grid mountain cabin for two in the Rhodope Mountains, Bulgaria. High clearance recommended. No wifi.
            </motion.p>
            
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.4 }}
              className="flex flex-col sm:flex-row gap-4 justify-center items-center mt-8 px-4"
          >
            <button
                onClick={openModal}
                className="bg-[#F1ECE2] text-stone-900 px-6 sm:px-8 py-3 sm:py-4 font-bold uppercase tracking-widest text-xs sm:text-sm hover:scale-105 transition-transform shadow-xl border-none min-h-[44px] touch-manipulation"
              >
                Check availability
              </button>
              <button
                onClick={scrollToReality}
                className="border border-white/30 text-white px-6 sm:px-8 py-3 sm:py-4 font-medium uppercase tracking-widest text-xs sm:text-sm hover:bg-white/10 transition-all backdrop-blur-sm min-h-[44px] touch-manipulation"
              >
                Is this for you?
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
        <div className="max-w-6xl mx-auto px-4 md:px-8">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-12 items-center justify-center">
            <img 
              src="/uploads/Icons%20trival/guest+favorite+logo.webp" 
              alt="Guest Favorite" 
                className="h-36 md:h-48 w-auto opacity-90 mx-auto md:mx-0" 
              />
              <div className="text-center md:text-left">
                <p className="font-serif text-base md:text-lg tracking-widest uppercase text-white mb-1">
                  Most Iconic Destination Award
                </p>
                <p className="text-sm md:text-base text-neutral-400 italic">
                  Travel & Hospitality Excellence
                </p>
              </div>
              {/* Right Column: Media Feature */}
              <div className="flex flex-col items-center text-center">
                {/* Optional: A subtle icon like a 'Play' button or 'Clapperboard' could go here, but text is cleaner */}
                <h3 className="font-serif text-2xl md:text-3xl text-white mb-2">
                  Nationally Featured
                </h3>
                <p className="text-[10px] md:text-xs tracking-[0.2em] text-neutral-400 uppercase">
                  As seen on all National TV Channels
                </p>
              </div>
            </div>
        </div>
      </section>

        {/* Section: The Narrative - Intro Copy */}
        <section className="relative py-20 md:py-28 bg-[#121212]">
          <div className="relative max-w-4xl mx-auto px-4 md:px-6">
            <p className="text-base text-neutral-400 leading-loose mb-6">
              Nestled in the rugged folds of the Pirin Mountains in Bulgaria, The Cabin is a testament to the beauty of subtraction. Here, every unnecessary element has been stripped away, leaving only what matters: the crackle of firewood, the whisper of wind through pines, and the profound silence that follows when you finally unplug.
            </p>
            <p className="text-base text-neutral-400 leading-loose">
              This is not a place for convenience. It is a place for presence. A deliberate choice to step away from the noise and rediscover what it means to truly dwell in the Rhodope Mountains.
            </p>
            
            {/* Bold Statement */}
            <div className="mt-8">
              <p className="font-serif text-2xl md:text-3xl text-white font-bold tracking-wide mb-6">
                This is not a hotel. It is a commitment.
              </p>
              <button
                onClick={scrollToReality}
                className="text-sm uppercase tracking-widest text-neutral-400 hover:text-white transition-colors underline underline-offset-4"
              >
                Read the reality
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
              The Reality of staying off grid
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-16">
              {/* CARD 1: ACCESS */}
              <div className="group">
                <div className="h-px w-full bg-white/20 mb-6"></div>
                <h3 className="font-serif text-2xl text-white mb-4">Access</h3>
                <p className="text-base text-neutral-400 leading-relaxed max-w-sm">
                  High clearance recommended. Normal cars can reach the cabin but expect a rough forest road. Drive slowly over bumps and stones, especially after rain.
                </p>
              </div>

              {/* CARD 2: POWER */}
              <div className="group">
                <div className="h-px w-full bg-white/20 mb-6"></div>
                <h3 className="font-serif text-2xl text-white mb-4">Power</h3>
                <p className="text-base text-neutral-400 leading-relaxed max-w-sm">
                  Off grid solar only. No hair dryers. No AC. Power is limited and must be used with care.
                </p>
              </div>

              {/* CARD 3: SILENCE */}
              <div className="group">
                <div className="h-px w-full bg-white/20 mb-6"></div>
                <h3 className="font-serif text-2xl text-white mb-4">Silence</h3>
                <p className="text-base text-neutral-400 leading-relaxed max-w-sm">
                  No neighbors. No road noise. Nights are very dark and very quiet.
                </p>
              </div>

              {/* CARD 4: CONNECTION */}
              <div className="group">
                <div className="h-px w-full bg-white/20 mb-6"></div>
                <h3 className="font-serif text-2xl text-white mb-4">Connection</h3>
                <p className="text-base text-neutral-400 leading-relaxed max-w-sm">
                  No wifi. Only emergency Starlink if needed. You cannot work remotely from here.
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
              Practical details
            </h2>

            <div className="flex flex-col">
              {/* Item 1 */}
              <div className="flex flex-col md:flex-row md:justify-between md:items-baseline border-b border-white/10 py-6">
                <span className="text-xs font-bold tracking-[0.2em] text-neutral-500 uppercase mb-2 md:mb-0">Sleeps</span>
                <span className="font-serif text-xl text-white text-left md:text-right">2 adults</span>
              </div>

              {/* Item 2 */}
              <div className="flex flex-col md:flex-row md:justify-between md:items-baseline border-b border-white/10 py-6">
                <span className="text-xs font-bold tracking-[0.2em] text-neutral-500 uppercase mb-2 md:mb-0">Location</span>
                <span className="font-serif text-xl text-white text-left md:text-right">Near Bachevo, Rhodope Mountains</span>
              </div>

              {/* Item 3 */}
              <div className="flex flex-col md:flex-row md:justify-between md:items-baseline border-b border-white/10 py-6">
                <span className="text-xs font-bold tracking-[0.2em] text-neutral-500 uppercase mb-2 md:mb-0">Access</span>
                <span className="font-serif text-xl text-white text-left md:text-right">High clearance recommended</span>
              </div>

              {/* Item 4 */}
              <div className="flex flex-col md:flex-row md:justify-between md:items-baseline border-b border-white/10 py-6">
                <span className="text-xs font-bold tracking-[0.2em] text-neutral-500 uppercase mb-2 md:mb-0">Heating</span>
                <span className="font-serif text-xl text-white text-left md:text-right">Wood stove</span>
              </div>

              {/* Item 5 */}
              <div className="flex flex-col md:flex-row md:justify-between md:items-baseline border-b border-white/10 py-6">
                <span className="text-xs font-bold tracking-[0.2em] text-neutral-500 uppercase mb-2 md:mb-0">Water</span>
                <span className="font-serif text-xl text-white text-left md:text-right">Spring water (Wood-fired hot water)</span>
              </div>

              {/* Item 6 */}
              <div className="flex flex-col md:flex-row md:justify-between md:items-baseline border-b border-white/10 py-6">
                <span className="text-xs font-bold tracking-[0.2em] text-neutral-500 uppercase mb-2 md:mb-0">Check In / Out</span>
                <span className="font-serif text-xl text-white text-left md:text-right">3:00 PM / 11:00 AM</span>
              </div>

              {/* Item 7 */}
              <div className="flex flex-col md:flex-row md:justify-between md:items-baseline border-b border-white/10 py-6">
                <span className="text-xs font-bold tracking-[0.2em] text-neutral-500 uppercase mb-2 md:mb-0">Pets</span>
                <span className="font-serif text-xl text-white text-left md:text-right">Not permitted (Wildlife protection)</span>
              </div>
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
              Questions before you book
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
                Read the full FAQ for The Cabin →
              </Link>
            </div>
        </div>
      </section>

        {/* Section: The Vibe - Gallery Grid */}
        <section 
          className="relative py-24 md:py-32 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-[#1a1a1a] via-[#121212] to-[#0d0d0d] border-t border-white/5 overflow-hidden"
        >
          <div className="max-w-7xl mx-auto px-4 md:px-6">
            <div className="text-center mb-12 md:mb-16">
              <motion.h2
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.8 }}
                className="font-serif italic font-thin text-4xl md:text-5xl lg:text-7xl text-neutral-400 mb-3 md:mb-4"
              >
                Ready to stay at The Cabin for real?
              </motion.h2>
              <motion.p
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.8, delay: 0.1 }}
                className="text-xs md:text-sm text-neutral-400 uppercase tracking-widest"
              >
                This is a commitment, not a casual hotel stay.
              </motion.p>
            </div>

            {/* Airbnb-Style Hero Grid Layout */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 max-w-7xl mx-auto">
              {/* Large Hero Image - Left Side (50% width) */}
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.8 }}
                className="relative h-[50vh] md:h-[60vh] lg:h-[80vh] overflow-hidden rounded-xl group cursor-pointer"
                onClick={openModal}
              >
                <div 
                  className="absolute inset-0 bg-cover bg-center transition-transform duration-700 group-hover:scale-110"
                  style={{
                    backgroundImage: 'url(/uploads/Content%20website/drift-dwells-bulgaria-bucephalus-suite.avif)',
                  }}
                  role="img"
                  aria-label={getSEOAlt('/uploads/Content website/drift-dwells-bulgaria-bucephalus-suite.avif') || 'Interior of Bucephalus cabin showing rustic wooden walls, queen bed, and warm ambient lighting in off-grid mountain cabin near Bachevo, Rhodope Mountains, Bulgaria'}
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors duration-300" />
              </motion.div>

              {/* 2x2 Grid - Right Side (50% width) */}
              <div className="grid grid-cols-2 gap-4 md:gap-6 h-[50vh] md:h-[60vh] lg:h-[80vh]">
                {/* Top Left - Cabin interior reading/journal space */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.6, delay: 0.1 }}
                  className="relative overflow-hidden rounded-xl group cursor-pointer"
                  onClick={openModal}
                  aria-label={getSEOAlt('/uploads/Content website/drift-dwells-bulgaria-cabin-journal.avif') || 'Cozy reading nook with journal and natural lighting inside Bucephalus off-grid cabin, Rhodope Mountains, Bulgaria'}
                >
                  <div 
                    className="absolute inset-0 bg-cover bg-center transition-transform duration-700 group-hover:scale-110"
                    style={{
                      backgroundImage: 'url(/uploads/Content%20website/drift-dwells-bulgaria-cabin-journal.avif)',
                    }}
                    role="img"
                    aria-label={getSEOAlt('/uploads/Content website/drift-dwells-bulgaria-cabin-journal.avif') || 'Cozy reading nook with journal and natural lighting inside Bucephalus off-grid cabin, Rhodope Mountains, Bulgaria'}
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors duration-300" />
                </motion.div>

                {/* Top Right - Cabin exterior or interior detail */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.6, delay: 0.2 }}
                  className="relative overflow-hidden rounded-xl group cursor-pointer"
                  onClick={openModal}
                  aria-label={getSEOAlt('/uploads/The Cabin/6c6a852c-e8e1-44af-8dda-c31fbc9dbda6.jpeg') || 'Bucephalus off-grid cabin image showing cabin interior or exterior detail, Rhodope Mountains, Bulgaria'}
                >
                  <div 
                    className="absolute inset-0 bg-cover bg-center transition-transform duration-700 group-hover:scale-110"
                    style={{
                      backgroundImage: 'url(/uploads/The Cabin/6c6a852c-e8e1-44af-8dda-c31fbc9dbda6.jpeg)',
                    }}
                    role="img"
                    aria-label={getSEOAlt('/uploads/The Cabin/6c6a852c-e8e1-44af-8dda-c31fbc9dbda6.jpeg') || 'Bucephalus off-grid cabin image showing cabin interior or exterior detail, Rhodope Mountains, Bulgaria'}
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors duration-300" />
                </motion.div>

                {/* Bottom Left - Cabin interior or nature detail */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.6, delay: 0.3 }}
                  className="relative overflow-hidden rounded-xl group cursor-pointer"
                  onClick={openModal}
                  aria-label={getSEOAlt('/uploads/The Cabin/011f4645-32ce-4739-ac8e-16a900612ac7.jpeg') || 'Bucephalus off-grid cabin interior or nature detail, Rhodope Mountains, Bulgaria'}
                >
                  <div 
                    className="absolute inset-0 bg-cover bg-center transition-transform duration-700 group-hover:scale-110"
                    style={{
                      backgroundImage: 'url(/uploads/The Cabin/011f4645-32ce-4739-ac8e-16a900612ac7.jpeg)',
                    }}
                    role="img"
                    aria-label={getSEOAlt('/uploads/The Cabin/011f4645-32ce-4739-ac8e-16a900612ac7.jpeg') || 'Bucephalus off-grid cabin interior or nature detail, Rhodope Mountains, Bulgaria'}
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors duration-300" />
                </motion.div>

                {/* Bottom Right - Cabin interior or exterior view */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.6, delay: 0.4 }}
                  className="relative overflow-hidden rounded-xl group cursor-pointer"
                  onClick={openModal}
                  aria-label={getSEOAlt('/uploads/The Cabin/40ce9b09-4b86-4e9a-a4d4-e860ba84bcdf.jpeg') || 'Bucephalus off-grid cabin interior or exterior view, Rhodope Mountains, Bulgaria'}
                >
                  <div 
                    className="absolute inset-0 bg-cover bg-center transition-transform duration-700 group-hover:scale-110"
                    style={{
                      backgroundImage: 'url(/uploads/The Cabin/40ce9b09-4b86-4e9a-a4d4-e860ba84bcdf.jpeg)',
                    }}
                    role="img"
                    aria-label={getSEOAlt('/uploads/The Cabin/40ce9b09-4b86-4e9a-a4d4-e860ba84bcdf.jpeg') || 'Bucephalus off-grid cabin interior or exterior view, Rhodope Mountains, Bulgaria'}
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors duration-300" />
                </motion.div>
              </div>
            </div>

            {/* CTA Button */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8, delay: 0.5 }}
              className="text-center mt-12 md:mt-16"
            >
              <button
                onClick={openModal}
                className="bg-[#F1ECE2] text-stone-900 px-8 sm:px-12 py-4 sm:py-5 font-bold uppercase tracking-widest text-xs sm:text-sm hover:scale-105 transition-transform shadow-xl border-none min-h-[44px] touch-manipulation"
              >
                Check availability
              </button>
            </motion.div>
          </div>
        </section>

        {/* Section: Living Notes - Guestbook */}
        <section className="relative py-20 md:py-28 bg-[#121212]">
          <div className="relative z-10 max-w-3xl mx-auto px-4 md:px-6">
            <div className="text-center mb-16">
              <h2 className="font-serif text-2xl md:text-3xl text-white mb-3">
                Living Notes
            </h2>
              <p className="text-sm uppercase tracking-widest text-neutral-400 mb-2">
                Ink that keeps moving long after guests depart.
              </p>
            </div>
            
            <div className="space-y-12 md:space-y-16">
              {livingNotes.slice(0, 3).map((note, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.6, delay: index * 0.1 }}
                  className="text-center pb-10 last:pb-0"
                >
                  <p className="font-serif text-3xl text-white leading-loose mb-4 italic">
                    "{note.text}"
                  </p>
                  <cite className="mt-2 text-sm md:text-base text-neutral-400 not-italic tracking-wide block font-serif">
                    {note.author}
                  </cite>
                </motion.div>
              ))}
            </div>
        </div>
      </section>
      </div>
    </>
  );
};

export default TheCabin;
