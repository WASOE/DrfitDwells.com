import { Suspense, lazy } from 'react';
import { useNavigate } from 'react-router-dom';
import DualityHero from '../components/DualityHero';
import AuthorityStrip from '../components/AuthorityStrip';
import Footer from '../components/Footer';

const MemoryStream = lazy(() => import('../components/MemoryStream'));
const BookingDrawer = lazy(() => import('../components/BookingDrawer'));

const Home = () => {
  const navigate = useNavigate();

  const handleCraftExperienceClick = () => {
    // Navigate to craft experience flow
    navigate('/craft/step-1');
  };

  return (
    <div className="min-h-screen bg-white">
      <DualityHero />
      <AuthorityStrip />

      {/* Mission Section - Editorial Grid */}
      <section className="relative py-20 overflow-hidden mt-0 bg-white">
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
              <p className="text-xs uppercase tracking-[0.3em] text-gray-600 font-sans">Our Mission</p>
              <p className="font-serif text-base md:text-lg lg:text-2xl leading-relaxed md:leading-loose text-stone-800">
                We create spaces where you can disconnect from the noise and reconnect with what matters—nature, yourself, and meaningful moments.
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

            {/* Craft Your Experience - Luxurious Sticky Note */}
            <button
              onClick={handleCraftExperienceClick}
              className="relative lg:absolute lg:left-[-90px] lg:bottom-8 mt-6 lg:mt-0 bg-[#F5F1E8] w-full max-w-sm mx-auto lg:mx-0 text-left transition-all duration-300 hover:shadow-[0_20px_50px_rgba(45,58,47,0.18)] hover:-translate-y-1 hover:rotate-0.5 cursor-pointer group active:scale-[0.99]"
              style={{ 
                boxShadow: '0 8px 25px rgba(45,58,47,0.12), 0 3px 10px rgba(45,58,47,0.08)',
                transform: 'rotate(-1.5deg)',
                transformOrigin: 'center center',
                background: 'linear-gradient(to bottom, #F7F3EA 0%, #F5F1E8 100%)'
              }}
            >
              {/* Subtle paper texture overlay */}
              <div className="absolute inset-0 opacity-[0.02] pointer-events-none" style={{
                backgroundImage: `repeating-linear-gradient(
                  0deg,
                  transparent,
                  transparent 1px,
                  rgba(45,58,47,0.1) 1px,
                  rgba(45,58,47,0.1) 2px
                ),
                repeating-linear-gradient(
                  90deg,
                  transparent,
                  transparent 1px,
                  rgba(45,58,47,0.05) 1px,
                  rgba(45,58,47,0.05) 2px
                )`
              }}></div>
              
              {/* Subtle adhesive strip at top (luxury sticky note detail) */}
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-[#81887A]/20 to-transparent"></div>
              
              <div className="relative p-5 sm:p-6 flex flex-col gap-3 sm:gap-4">
                {/* Doodles in corners */}
                <svg className="absolute top-3 right-4 w-8 h-8 text-[#81887A]/40" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5} style={{ transform: 'rotate(15deg)' }}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v18m0 0l-3-3m3 3l3-3" />
                </svg>
                <svg className="absolute top-8 right-8 w-6 h-6 text-[#81887A]/30" fill="currentColor" viewBox="0 0 24 24" style={{ transform: 'rotate(-10deg)' }}>
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
                
                {/* Handwritten Title with doodle */}
                <div className="relative">
                  <p className="font-['Caveat'] text-3xl sm:text-4xl text-[#2D3A2F] font-semibold group-hover:text-[#1A241C] transition-colors leading-tight" style={{ letterSpacing: '0.02em' }}>
                    Craft Your Experience
                  </p>
                  {/* Small heart doodle */}
                  <svg className="absolute -right-2 top-0 w-5 h-5 text-[#81887A]/50" fill="currentColor" viewBox="0 0 24 24" style={{ transform: 'rotate(-15deg)' }}>
                    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                  </svg>
                  <p className="font-['Caveat'] text-sm sm:text-base text-[#81887A] mt-1" style={{ letterSpacing: '0.05em' }}>
                    Tell us what brings you here, and we'll tailor every detail
                  </p>
                </div>
                
                {/* Note-style list with checkmarks */}
                <div className="mt-2 space-y-2">
                  <div className="flex items-start gap-2">
                    <svg className="w-4 h-4 text-[#81887A] mt-1 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    <p className="font-['Caveat'] text-base sm:text-lg text-[#2D3A2F]/85 leading-relaxed" style={{ letterSpacing: '0.01em' }}>
                      What brings you here?
                    </p>
                  </div>
                  <div className="flex items-start gap-2">
                    <svg className="w-4 h-4 text-[#81887A] mt-1 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    <p className="font-['Caveat'] text-base sm:text-lg text-[#2D3A2F]/85 leading-relaxed" style={{ letterSpacing: '0.01em' }}>
                      Tailor every detail
                    </p>
                  </div>
                  <div className="flex items-start gap-2">
                    <svg className="w-4 h-4 text-[#81887A] mt-1 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    <p className="font-['Caveat'] text-base sm:text-lg text-[#2D3A2F]/85 leading-relaxed" style={{ letterSpacing: '0.01em' }}>
                      Create your journey
                    </p>
                  </div>
                </div>
                
                {/* Compass doodle */}
                <div className="absolute bottom-16 right-6 opacity-30">
                  <svg className="w-10 h-10 text-[#81887A]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5} style={{ transform: 'rotate(25deg)' }}>
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
                    <path d="M12 8l-4 4 4 4 4-4-4-4z" />
                  </svg>
                </div>
                
                {/* Handwritten CTA with signature-style underline */}
                <div className="mt-4 sm:mt-5 pt-3 border-t border-[#81887A]/10">
                  <div className="text-[#2D3A2F] font-['Caveat'] text-lg sm:text-xl group-hover:text-[#81887A] transition-all duration-300 flex items-center justify-center gap-2">
                    <span className="relative">
                      Begin Your Journey
                      {/* Hand-drawn underline */}
                      <svg 
                        className="absolute -bottom-1 left-0 w-full h-2 text-[#81887A] group-hover:text-[#2D3A2F] transition-colors" 
                        viewBox="0 0 200 8" 
                        preserveAspectRatio="none"
                        style={{ overflow: 'visible' }}
                      >
                        <path 
                          d="M 0 4 Q 30 2, 60 4 T 120 4 T 180 4 T 200 4" 
                          stroke="currentColor" 
                          strokeWidth="1.5" 
                          fill="none" 
                          strokeLinecap="round"
                          style={{ filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.1))' }}
                        />
                      </svg>
                    </span>
                    <svg className="w-5 h-5 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                    </svg>
                  </div>
                </div>
              </div>
            </button>
          </div>
        </div>
      </section>

      <Suspense fallback={<div className="py-16 text-center text-sm tracking-[0.3em] uppercase text-gray-500">Loading memories…</div>}>
        <MemoryStream />
      </Suspense>

      {/* Philosophy Section - Aylyak */}
      <section className="relative py-12 md:py-24 bg-[#F1ECE2]">
        <div className="max-w-4xl mx-auto px-4 md:px-12 text-center">
          <p className="text-xs uppercase tracking-[0.4em] text-gray-500 mb-4">Philosophy</p>
          <h2 className="font-['Playfair_Display'] text-3xl md:text-5xl text-gray-900 mb-6">
            The Art of Aylyak
          </h2>
          <p className="font-['Merriweather'] text-lg md:text-xl text-gray-700 leading-relaxed max-w-3xl mx-auto italic">
            A deliberate refusal to be rushed.
          </p>
          <p className="font-['Merriweather'] text-base md:text-lg text-gray-600 leading-relaxed max-w-2xl mx-auto mt-6">
            We claim ownership of the Bulgarian concept of 'Aylyak'—a conscious choice to move at nature's pace, prioritizing presence over productivity and connection over connection.
          </p>
        </div>
      </section>

      {/* Footer */}
      <Footer />

      {/* Booking Drawer - Mobile Only */}
      <Suspense fallback={null}>
        <BookingDrawer />
      </Suspense>
    </div>
  );
};

export default Home;
