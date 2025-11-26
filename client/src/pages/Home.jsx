import DualityHero from '../components/DualityHero';
import TrustStrip from '../components/TrustStrip';
import MemoryStream from '../components/MemoryStream';
import CabinCard from '../components/CabinCard';
import { locations, philosophy, home } from '../data/content';

const Home = () => {
  const cabin = locations.find(loc => loc.id === 'cabin');
  const valley = locations.find(loc => loc.id === 'valley');
  return (
    <div className="min-h-screen bg-[#F7F4EE]">
      <DualityHero />
      <TrustStrip />

      {/* Mission Section - Editorial Grid */}
      <section className="relative py-16 md:py-28 overflow-hidden mt-8 paper-texture">
        <div className="max-w-7xl mx-auto px-4 md:px-12 grid grid-cols-1 lg:grid-cols-2 gap-8 md:gap-12">
          {/* Left Column - Mission Text with sketches */}
          <div className="relative flex flex-col justify-center lg:pr-12">
            <div className="absolute inset-0 pointer-events-none hidden lg:block">
              <img
                src="/uploads/Deco%20elements%20-%20Buschcraft/bushcraft-26.png"
                alt=""
                className="absolute -left-8 top-6 w-40 opacity-20"
                style={{ transform: 'rotate(-10deg)' }}
              />
              <img
                src="/uploads/Deco%20elements%20-%20Buschcraft/bushcraft-32.png"
                alt=""
                className="absolute right-2 bottom-10 w-32 opacity-15"
                style={{ transform: 'rotate(15deg)' }}
              />
            </div>
            <div className="relative space-y-6 md:space-y-8 max-w-3xl mx-auto text-center lg:text-left">
              <p className="text-xs uppercase tracking-[0.3em] text-gray-600 font-sans">{home.mission.title}</p>
              <p className="font-serif text-base md:text-lg lg:text-2xl leading-relaxed md:leading-loose text-stone-800">
                {home.mission.narrative}
              </p>
            </div>
          </div>

          {/* Right Column - Polaroid Image with floating Tiny Book */}
          <div className="relative mt-8 lg:mt-0">
            {/* Ghost photo behind (stack effect) - hidden on mobile */}
            <div 
              className="hidden lg:block absolute inset-0 bg-white opacity-30 -z-10"
              style={{ 
                transform: 'rotate(2deg)',
                boxShadow: '0 25px 55px rgba(12,28,20,0.12)'
              }}
            />
            
            {/* Main Polaroid Photo */}
            <div 
              className="relative bg-white p-3 sm:p-4 md:p-6 shadow-2xl polaroid-hover transition-all duration-300 lg:rotate-[-1deg]"
              style={{ 
                boxShadow: '0 35px 70px -25px rgba(10,25,18,0.35)'
              }}
            >
              <div className="relative aspect-[4/5] bg-cover bg-center">
                <img
                  src="/uploads/Content%20website/drift-dwells-bulgaria-cabin-journal.avif"
                  alt="Cabin interior"
                  className="w-full h-full object-cover"
                />
              </div>
              {/* Polaroid caption space */}
              <div className="pt-3 sm:pt-4 pb-2">
                <p className="font-['Caveat'] text-base sm:text-lg text-gray-700 text-center">
                  Summer 2024
                </p>
              </div>
            </div>

            {/* Tiny Book - repositioned for mobile */}
            <div
              className="relative lg:absolute lg:left-[-90px] lg:bottom-8 mt-6 lg:mt-0 bg-[#EFECE6] border border-[#d8d2c7] w-full max-w-sm mx-auto lg:mx-0"
              style={{ boxShadow: '0 35px 85px rgba(12,28,20,0.18)' }}
            >
              <div className="p-4 sm:p-6 flex flex-col gap-3 sm:gap-4">
                <div className="flex gap-3 sm:gap-4 items-start">
                  <div className="w-16 h-16 sm:w-20 sm:h-20 bg-[#d8d2c7] overflow-hidden border border-white/40 flex-shrink-0">
                    <img
                      src="/uploads/Icons%20trival/house.png"
                      alt="Tiny book thumbnail"
                      className="w-full h-full object-cover mix-blend-multiply"
                    />
                  </div>
                  <div>
                    <p className="font-['Playfair_Display'] text-xl sm:text-2xl text-gray-900 font-semibold">The Cabin's Tiny Book</p>
                    <p className="text-xs uppercase tracking-[0.3em] text-gray-600 mt-1">By Drift & Dwells</p>
                  </div>
                </div>
                <p className="font-sans text-sm text-gray-700 leading-relaxed">
                  Create your cabin itinerary with tips, rituals, and seasonal activities curated by the hosts. Downloadable notes, mood playlists, and hidden paths to explore.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <MemoryStream />

      {/* Philosophy Section - Aylyak */}
      <section className="relative py-16 md:py-24 bg-[#F7F4EE]">
        <div className="max-w-4xl mx-auto px-4 md:px-12 text-center">
          <p className="text-xs uppercase tracking-[0.4em] text-gray-500 mb-4">Philosophy</p>
          <h2 className="font-['Playfair_Display'] text-3xl md:text-5xl text-gray-900 mb-6">
            {philosophy.title}
          </h2>
          <p className="font-['Merriweather'] text-lg md:text-xl text-gray-700 leading-relaxed max-w-3xl mx-auto italic">
            {philosophy.text}
          </p>
          <p className="font-['Merriweather'] text-base md:text-lg text-gray-600 leading-relaxed max-w-2xl mx-auto mt-6">
            {philosophy.description}
          </p>
        </div>
      </section>

      <section className="relative z-20 pt-16 md:pt-32 pb-0 bg-transparent">
        {/* Half-wall beige background behind cards only */}
        <div className="absolute inset-x-0 top-0 h-[80%] bg-[#F1ECE2] -z-10 rounded-b-[60px]" />

        <div className="max-w-6xl mx-auto px-4 md:px-12 pb-20">
          <div className="text-center mb-10 md:mb-16">
            <p className="text-xs uppercase tracking-[0.4em] text-gray-500 mb-4">Cabins</p>
            <h2 className="font-['Playfair_Display'] text-3xl md:text-5xl text-[#1f2c23]">
              Atmospheric Retreats
            </h2>
            <p className="font-['Merriweather'] text-base md:text-lg text-gray-600 italic mt-4">
              Sound on. Breath slows. Pages turn.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-10">
            {cabin && (
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
              />
            )}
            {valley && (
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
              />
            )}
          </div>
        </div>
      </section>

    </div>
  );
};

export default Home;
