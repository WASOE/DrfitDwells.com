import { Link } from 'react-router-dom';
import CabinCard from './CabinCard';
import { locations } from '../data/content';

// Video paths matching TheCabin and TheValley pages
const CABIN_VIDEO = '/uploads/Videos/The-cabin-header.mp4';
const CABIN_VIDEO_POSTER = '/uploads/Videos/The-cabin-header-poster.jpg';
const VALLEY_VIDEO = '/uploads/Videos/The-Valley-firaplace-video.mp4';
const VALLEY_VIDEO_POSTER = '/uploads/Videos/The-Valley-firaplace-video-poster.jpg';

const DestinationsFooter = () => {
  const cabin = locations.find(loc => loc.id === 'cabin');
  const valley = locations.find(loc => loc.id === 'valley');

  return (
    <div className="relative w-full">
      {/* 1. BEIGE TOP SECTION */}
      <div className="bg-[#F1ECE2] pt-12 md:pt-16 pb-48 relative z-20">
        <div className="max-w-7xl mx-auto px-4 md:px-6">
          {/* Header */}
          <div className="text-center mb-8 md:mb-10">
            <h2 className="font-serif text-3xl md:text-4xl lg:text-5xl text-stone-900 mb-2 md:mb-3">Atmospheric Retreats</h2>
            <p className="font-script text-lg md:text-xl text-stone-500 italic">Sound on. Breath slows. Pages turn.</p>
          </div>

          {/* Cards Grid - Push Down Method */}
          <div className="mb-[-160px] md:mb-[-180px]">
            {/* Mobile: Horizontal Scroll Carousel */}
            <div className="flex md:hidden overflow-x-auto snap-x snap-mandatory gap-4 px-4 pb-8 scrollbar-hide -mx-4">
              {cabin && (
                <div className="flex-shrink-0 w-[85vw] snap-center">
                  <CabinCard
                    title={cabin.name}
                    description={cabin.description}
                    image={cabin.image}
                    interiorImage={cabin.interiorImage}
                    audioSrc={cabin.audioSrc}
                    details={cabin.details}
                    locationId={cabin.id}
                    price={cabin.price}
                    cta={cabin.cta}
                    videoSrc={CABIN_VIDEO}
                    videoPoster={CABIN_VIDEO_POSTER}
                  />
                </div>
              )}
              {valley && (
                <div className="flex-shrink-0 w-[85vw] snap-center">
                  <CabinCard
                    title={valley.name}
                    description={valley.description}
                    image={valley.image}
                    interiorImage={valley.interiorImage}
                    audioSrc={valley.audioSrc}
                    details={valley.details}
                    locationId={valley.id}
                    price={valley.price}
                    cta={valley.cta}
                    videoSrc={VALLEY_VIDEO}
                    videoPoster={VALLEY_VIDEO_POSTER}
                  />
                </div>
              )}
            </div>

            {/* Desktop: Grid Layout */}
            <div className="hidden md:grid md:grid-cols-2 gap-4 lg:gap-6" style={{ alignItems: 'stretch' }}>
              {/* CABIN CARD */}
              {cabin && (
                <div className="flex">
                  <CabinCard
                    title={cabin.name}
                    description={cabin.description}
                    image={cabin.image}
                    interiorImage={cabin.interiorImage}
                    audioSrc={cabin.audioSrc}
                    details={cabin.details}
                    locationId={cabin.id}
                    price={cabin.price}
                    cta={cabin.cta}
                    videoSrc={CABIN_VIDEO}
                    videoPoster={CABIN_VIDEO_POSTER}
                  />
                </div>
              )}

              {/* VALLEY CARD */}
              {valley && (
                <div className="flex">
                  <CabinCard
                    title={valley.name}
                    description={valley.description}
                    image={valley.image}
                    interiorImage={valley.interiorImage}
                    audioSrc={valley.audioSrc}
                    details={valley.details}
                    locationId={valley.id}
                    price={valley.price}
                    cta={valley.cta}
                    videoSrc={VALLEY_VIDEO}
                    videoPoster={VALLEY_VIDEO_POSTER}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 2. DARK FOOTER SECTION */}
      <div
        className="relative text-white overflow-hidden z-10 min-h-[500px] bg-cover bg-no-repeat bg-center"
        style={{
          backgroundColor: '#000',
          backgroundImage: "url('/uploads/Content%20website/drift-dwells-bulgaria-bucephalus-suite.avif')",
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
          backgroundAttachment: 'scroll'
        }}
      >
        {/* Layer 1: Lighter global tint */}
        <div className="absolute inset-0 bg-black/20" />
        {/* Layer 2: Gradient only on bottom 50% for text readability, top 50% stays clear */}
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-transparent" style={{ backgroundPosition: 'bottom' }} />

        {/* Footer Content */}
        <div className="relative z-20 max-w-7xl mx-auto px-4 md:px-6 pt-[160px] md:pt-[200px] pb-12 md:pb-16 space-y-12 md:space-y-16">
          {/* Living Notes / Guestbook */}
          <div className="max-w-2xl mx-auto text-center space-y-4 drop-shadow-lg">
            <div className="w-24 h-[1px] bg-white/40 mx-auto mb-4" />
            <p className="text-xs uppercase tracking-[0.4em] text-white/70 mb-1">Guestbook</p>
            <h2 className="font-['Playfair_Display'] text-3xl md:text-5xl text-white drop-shadow-md">
              Living Notes
            </h2>
            <p className="font-['Merriweather'] text-base md:text-lg text-white/80 italic">
              Ink that keeps moving long after guests depart.
            </p>
            <div className="mt-6 md:mt-8 space-y-5 md:space-y-6 text-center">
              <p className="font-['Caveat'] text-base md:text-lg lg:text-2xl text-white/90 leading-snug">
                Left the phones in the drawer and heard the creek compose a lullaby for us.
                <span className="block mt-2 text-white/70 text-sm md:text-base">— Mira &amp; Theo</span>
              </p>
              <p className="font-['Caveat'] text-base md:text-lg lg:text-2xl text-white/90 leading-snug">
                We brewed pine needle tea at dawn. The steam looked like soft handwriting.
                <span className="block mt-2 text-white/70 text-sm md:text-base">— Daniela</span>
              </p>
              <p className="font-['Caveat'] text-base md:text-lg lg:text-2xl text-white/90 leading-snug">
                The journal we found on the shelf had pressed ferns from guests we will never meet.
                <span className="block mt-2 text-white/70 text-sm md:text-base">— Petra &amp; Ivo</span>
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-10 pt-6 md:pt-8">
            <div>
              <h3 className="text-sm font-bold tracking-widest uppercase mb-4">Our Promise</h3>
              <p className="text-gray-200 text-sm leading-relaxed">
                Eco-retreat cabins in the heart of Bulgaria's pristine wilderness. Experience sustainable luxury framed by handcrafted storytelling.
              </p>
            </div>

            <div>
              <h3 className="text-sm font-bold tracking-widest uppercase mb-4">Quick Links</h3>
              <ul className="space-y-3 text-sm font-medium text-white/60">
                <li><Link to="/" className="hover:text-white transition-colors">Home</Link></li>
                <li><Link to="/cabin" className="hover:text-white transition-colors">The Cabin</Link></li>
                <li><Link to="/valley" className="hover:text-white transition-colors">The Valley</Link></li>
                <li><Link to="/about" className="hover:text-white transition-colors">About</Link></li>
                <li><Link to="/build" className="hover:text-white transition-colors">Build</Link></li>
                <li><Link to="/search" className="hover:text-white transition-colors">Search Cabins</Link></li>
              </ul>
            </div>

            <div>
              <h3 className="text-sm font-bold tracking-widest uppercase mb-4">Contact</h3>
              <div className="space-y-3 text-sm text-white/60">
                <p>
                  <a href="mailto:info@driftdwells.com" className="hover:text-white transition-colors" rel="noopener noreferrer">📧 info@driftdwells.com</a>
                </p>
                <p>📞 +359 88 123 4567</p>
                <p>📍 Rhodope Mountains, Bulgaria</p>
              </div>
            </div>
          </div>

          <div className="border-t border-white/20 pt-4 md:pt-6 text-sm text-gray-300 flex flex-col md:flex-row justify-between items-center space-y-3 md:space-y-0">
            <div className="flex flex-col md:flex-row items-center gap-3 md:gap-6">
              <img 
                src="/uploads/Logo/Drift-Dwell-white.png" 
                alt="Drift & Dwells" 
                className="h-5 md:h-6 w-auto opacity-80"
              />
              <p>© 2024 Drift & Dwells. All rights reserved.</p>
            </div>
            <div className="flex space-x-6 md:space-x-8">
              <Link to="/privacy" className="hover:text-white transition-colors">Privacy Policy</Link>
              <Link to="/terms" className="hover:text-white transition-colors">Terms of Service</Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DestinationsFooter;
