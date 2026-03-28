import { useLocation, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { localizePath, stripLocaleFromPath } from '../utils/localizedRoutes';

const Footer = () => {
  const { t } = useTranslation('nav');
  const location = useLocation();
  const basePath = stripLocaleFromPath(location.pathname);
  const language = location.pathname === '/bg' || location.pathname.startsWith('/bg/') ? 'bg' : 'en';
  const isHome = basePath === '/';

  // Bottom strip elements with image icons
  const bottomStripElements = [
    { image: '/uploads/Icons%20trival/campfire.png', text: 'MOUNTAIN ESCAPE' },
    { image: '/uploads/Icons%20trival/camp.png', text: 'NATURE FIRST' },
    { image: '/uploads/Icons%20trival/pipe.png', text: 'SLOW DOWN' },
    { image: '/uploads/Icons%20trival/dance%20(1).png', text: 'STAY WILD' }
  ];

  return (
    <footer className="relative bg-[#F9F8F6] text-[#111] z-10 mt-0">
      <div 
        className={`max-w-7xl mx-auto ${isHome ? 'pt-[200px] md:pt-[350px]' : ''}`}
        style={{
          paddingTop: isHome ? undefined : 'clamp(28px, 4vw, 48px)',
          paddingBottom: 'clamp(28px, 4vw, 48px)',
          paddingLeft: 'clamp(30px, 4vw, 40px)',
          paddingRight: 'clamp(30px, 4vw, 40px)'
        }}
      >
        <style>{`
          @media (min-width: 1024px) {
            footer > div:first-child {
              padding-top: ${isHome ? '350px' : 'clamp(28px, 4vw, 48px)'} !important;
            }
          }
        `}</style>
        
        {/* Main Content Grid - 2 Columns (40% Left, 60% Right) */}
        <div className="grid grid-cols-1 lg:grid-cols-[2fr_3fr] gap-8 md:gap-12 lg:gap-16 xl:gap-20 mb-6 lg:mb-8">
          
          {/* LEFT COLUMN - Brand/Marketing (40% width) */}
          <div className="flex flex-col">
            {/* Headline */}
            <h2 
              className="font-['Playfair_Display'] text-[#111] leading-[0.95] mb-8 lg:mb-12" 
      style={{
                fontSize: 'clamp(36px, 6vw, 64px)',
                fontWeight: 800,
                textAlign: 'left'
              }}
            >
              Notes from the mountains.
            </h2>
            <p className="font-['Montserrat'] text-[#111] mb-8 lg:mb-10" style={{ fontSize: '14px', fontWeight: 400, opacity: 0.8, lineHeight: '1.6', maxWidth: '400px' }}>
              Stories from the mountains, delivered quietly to your inbox.
            </p>
            
            {/* Newsletter Form */}
            <form className="mb-10 lg:mb-14">
              <div className="flex items-baseline border-b border-[#111] pb-2 mb-4" style={{ maxWidth: '100%' }}>
                <input
                  type="email"
                  placeholder="EMAIL ADDRESS"
                  className="flex-1 bg-transparent text-[#111] placeholder:text-[#111] placeholder:opacity-60 focus:outline-none font-['Montserrat'] uppercase"
                  style={{ 
                    fontSize: '11px',
                    letterSpacing: '0.15em',
                    fontWeight: 500
                  }}
                />
                <button
                  type="submit"
                  className="ml-4 text-[#111] hover:opacity-60 transition-opacity flex-shrink-0"
                  aria-label="Subscribe"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
        </div>

              {/* Privacy Checkbox */}
              <div className="flex items-start gap-2">
                <input type="checkbox" id="privacy" className="mt-1" style={{ width: '14px', height: '14px' }} />
                <label htmlFor="privacy" className="font-['Montserrat'] text-[#111]" style={{ fontSize: '11px', fontWeight: 400, opacity: 0.7, lineHeight: '1.5' }}>
                  I agree with the{' '}
                  <Link to={localizePath('/privacy', language)} className="underline hover:opacity-60">privacy policy</Link>
                  {' '}and{' '}
                  <Link to={localizePath('/terms', language)} className="underline hover:opacity-60">terms of use</Link>.
                </label>
              </div>
            </form>

          </div>

          {/* RIGHT COLUMN - Navigation/Utility (60% width) */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 md:gap-12">
            
            {/* COLUMN 1: Menu */}
            <div className="flex flex-col">
              <h3 className="font-['Montserrat'] text-[#111] uppercase mb-5" style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.18em', opacity: 0.75 }}>
                Menu
              </h3>
              
              <ul>
                <li style={{ marginBottom: 'clamp(16px, 2vw, 28px)' }}>
                  <Link to={localizePath('/', language)} className="font-['Montserrat'] text-[#111] hover:opacity-60 transition-opacity uppercase" style={{ fontSize: '12px', letterSpacing: '0.12em', fontWeight: 600, lineHeight: '2.5' }}>
                    Home
                  </Link>
                </li>
                <li style={{ marginBottom: 'clamp(16px, 2vw, 28px)' }}>
                  <Link to={localizePath('/cabin', language)} className="font-['Montserrat'] text-[#111] hover:opacity-60 transition-opacity uppercase" style={{ fontSize: '12px', letterSpacing: '0.12em', fontWeight: 600, lineHeight: '2.5' }}>
                    The Cabin
                  </Link>
                </li>
                <li style={{ marginBottom: 'clamp(16px, 2vw, 28px)' }}>
                  <Link to={localizePath('/valley', language)} className="font-['Montserrat'] text-[#111] hover:opacity-60 transition-opacity uppercase" style={{ fontSize: '12px', letterSpacing: '0.12em', fontWeight: 600, lineHeight: '2.5' }}>
                    The Valley
                  </Link>
                </li>
                <li style={{ marginBottom: 'clamp(16px, 2vw, 28px)' }}>
                  <Link to={localizePath('/about', language)} className="font-['Montserrat'] text-[#111] hover:opacity-60 transition-opacity uppercase" style={{ fontSize: '12px', letterSpacing: '0.12em', fontWeight: 600, lineHeight: '2.5' }}>
                    About
                  </Link>
                </li>
                <li style={{ marginBottom: 'clamp(16px, 2vw, 28px)' }}>
                  <Link to={localizePath('/build', language)} className="font-['Montserrat'] text-[#111] hover:opacity-60 transition-opacity uppercase" style={{ fontSize: '12px', letterSpacing: '0.12em', fontWeight: 600, lineHeight: '2.5' }}>
                    Build
                  </Link>
                </li>
              </ul>
            </div>

            {/* COLUMN 2: Explore (SEO landing pages) */}
            <div className="flex flex-col">
              <h3 className="font-['Montserrat'] text-[#111] uppercase mb-5" style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.18em', opacity: 0.75 }}>
                {t('exploreTitle')}
              </h3>
              
              <ul>
                <li style={{ marginBottom: 'clamp(16px, 2vw, 28px)' }}>
                  <Link to={localizePath('/off-grid-cabins-bulgaria', language)} className="font-['Montserrat'] text-[#111] hover:opacity-60 transition-opacity uppercase" style={{ fontSize: '12px', letterSpacing: '0.12em', fontWeight: 600, lineHeight: '2.5' }}>
                    {t('exploreOffGrid')}
                  </Link>
                </li>
                <li style={{ marginBottom: 'clamp(16px, 2vw, 28px)' }}>
                  <Link to={localizePath('/rhodopes-cabin-retreat', language)} className="font-['Montserrat'] text-[#111] hover:opacity-60 transition-opacity uppercase" style={{ fontSize: '12px', letterSpacing: '0.12em', fontWeight: 600, lineHeight: '2.5' }}>
                    {t('exploreRhodopes')}
                  </Link>
                </li>
                <li style={{ marginBottom: 'clamp(16px, 2vw, 28px)' }}>
                  <Link to={localizePath('/bansko-remote-work-retreat', language)} className="font-['Montserrat'] text-[#111] hover:opacity-60 transition-opacity uppercase" style={{ fontSize: '12px', letterSpacing: '0.12em', fontWeight: 600, lineHeight: '2.5' }}>
                    {t('exploreBansko')}
                  </Link>
                </li>
                <li style={{ marginBottom: 'clamp(16px, 2vw, 28px)' }}>
                  <Link to={localizePath('/retreat-venue-bulgaria', language)} className="font-['Montserrat'] text-[#111] hover:opacity-60 transition-opacity uppercase" style={{ fontSize: '12px', letterSpacing: '0.12em', fontWeight: 600, lineHeight: '2.5' }}>
                    {t('exploreRetreatVenue')}
                  </Link>
                </li>
              </ul>
            </div>

            {/* COLUMN 3: Company & Help Merged */}
            <div className="flex flex-col">
              <h3 className="font-['Montserrat'] text-[#111] uppercase mb-5" style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.18em', opacity: 0.75 }}>
                Company
              </h3>
              
              <ul>
                <li style={{ marginBottom: 'clamp(16px, 2vw, 28px)' }}>
                  <Link to={localizePath('/career', language)} className="font-['Montserrat'] text-[#111] hover:opacity-60 transition-opacity uppercase" style={{ fontSize: '12px', letterSpacing: '0.12em', fontWeight: 600, lineHeight: '2.5' }}>
                    Careers
                  </Link>
                </li>
                <li style={{ marginBottom: 'clamp(16px, 2vw, 28px)' }}>
                  <Link to={localizePath('/press', language)} className="font-['Montserrat'] text-[#111] hover:opacity-60 transition-opacity uppercase" style={{ fontSize: '12px', letterSpacing: '0.12em', fontWeight: 600, lineHeight: '2.5' }}>
                    Press
                  </Link>
                </li>
                <li style={{ marginBottom: 'clamp(16px, 2vw, 28px)' }}>
                  <Link to={localizePath('/terms', language)} className="font-['Montserrat'] text-[#111] hover:opacity-60 transition-opacity uppercase" style={{ fontSize: '12px', letterSpacing: '0.12em', fontWeight: 600, lineHeight: '2.5' }}>
                    Terms & Conditions
                  </Link>
                </li>
                <li style={{ marginBottom: 'clamp(16px, 2vw, 28px)' }}>
                  <Link to={localizePath('/privacy', language)} className="font-['Montserrat'] text-[#111] hover:opacity-60 transition-opacity uppercase" style={{ fontSize: '12px', letterSpacing: '0.12em', fontWeight: 600, lineHeight: '2.5' }}>
                    Privacy Policy
                  </Link>
                </li>
            </ul>
          </div>

            {/* COLUMN 3: Contact */}
            <div className="flex flex-col">
              <h3 className="font-['Montserrat'] text-[#111] uppercase mb-5" style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.18em', opacity: 0.75 }}>
                Contact
              </h3>
              <div
                className="font-['Montserrat'] text-[#111]"
                style={{
                  fontSize: 'clamp(14px, 2.4vw, 16px)',
                  fontWeight: 500,
                  opacity: 0.88,
                  lineHeight: '1.75',
                  letterSpacing: '0.02em'
                }}
              >
                <p>
                  <a href="mailto:info@driftdwells.com" className="hover:opacity-60 transition-opacity" rel="noopener noreferrer">info@driftdwells.com</a>
                </p>
                <p className="tabular-nums whitespace-nowrap">+359 88 123 4567</p>
              </div>
              <div className="mt-3">
                <h3 className="font-['Montserrat'] text-[#111] uppercase mb-3" style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.18em', opacity: 0.75 }}>
                  Follow Us
                </h3>
                <div className="flex items-center gap-3">
                  <a href="#" className="text-[#111] hover:opacity-60 transition-opacity" target="_blank" rel="noopener noreferrer" aria-label="Instagram">
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
                    </svg>
                  </a>
                  <a href="#" className="text-[#111] hover:opacity-60 transition-opacity" target="_blank" rel="noopener noreferrer" aria-label="Facebook">
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                    </svg>
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Trust Strip - Full Width */}
        <div className="border-t border-b border-[#111] py-16 lg:py-20" style={{ borderColor: 'rgba(17, 17, 17, 0.25)' }}>
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-10 lg:gap-12">
            {/* Airbnb Guest Favorite */}
            <div className="flex flex-col items-center text-center md:items-start md:text-left px-6 md:px-10">
              <img 
                src="/uploads/Icons%20trival/hd-white-airbnb-official-logo-brand-png-image-701751694789792pszdgb4qdy.png" 
                alt="Airbnb" 
                className="h-12 w-auto object-contain mb-4 mix-blend-multiply brightness-0" 
              />
              <div className="text-4xl font-['Montserrat'] text-[#1c1917] mb-1" style={{ fontWeight: 600 }}>4.95</div>
              <div className="text-[10px] uppercase tracking-[0.3em] text-[#1c1917] mb-2" style={{ opacity: 0.55 }}>★★★★★</div>
              <div className="text-[10px] uppercase tracking-[0.25em] text-stone-500 font-medium">Top 1% of Homes</div>
            </div>

            {/* Booking.com */}
            <div className="flex flex-col items-center text-center px-6 md:px-10">
              <div className="h-12 flex items-center mb-4 mt-2">
                <span className="text-2xl font-['Montserrat'] text-[#1c1917] tracking-tight" style={{ fontWeight: 700 }}>Booking.com</span>
              </div>
              <div className="text-4xl font-['Montserrat'] text-[#1c1917] mb-1" style={{ fontWeight: 600 }}>9.8</div>
              <div className="text-[10px] uppercase tracking-[0.3em] text-[#1c1917] mb-2" style={{ opacity: 0.55 }}>★★★★★</div>
              <div className="text-[10px] uppercase tracking-[0.25em] text-stone-500 font-medium">Traveller Review Awards</div>
            </div>

            {/* TripAdvisor */}
            <div className="flex flex-col items-center text-center md:items-end md:text-right px-6 md:px-10">
              <div className="h-14 flex items-center mb-3">
            <img 
                  src="/uploads/Icons%20trival/trip%20advisor%20logo.png" 
                  alt="TripAdvisor" 
                  className="h-14 w-auto object-contain" 
            />
              </div>
              <div className="text-4xl font-['Montserrat'] text-[#1c1917] mb-1" style={{ fontWeight: 600 }}>5.0</div>
              <div className="text-[10px] uppercase tracking-[0.3em] text-[#1c1917] mb-2" style={{ opacity: 0.55 }}>★★★★★</div>
              <div className="text-[10px] uppercase tracking-[0.25em] text-stone-500 font-medium">Travelers' Choice</div>
          </div>
          </div>
        </div>

        {/* Bottom Badge Strip - Full Width */}
        <div className="flex flex-wrap items-center justify-center gap-8 md:gap-12 lg:gap-16 py-6 mt-24 lg:mt-28">
          {bottomStripElements.map((item, index) => (
            <div key={index} className="flex items-center gap-3 md:gap-4" style={{ opacity: 0.5 }}>
              <img 
                src={item.image}
                alt={item.text}
                className="w-8 h-8 md:w-9 md:h-9 object-contain"
              />
              <p className="font-['Montserrat'] text-[#111] uppercase" style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.12em' }}>
                {item.text}
              </p>
            </div>
          ))}
        </div>

        {/* Legal Line */}
        <div className="pt-6">
          <p className="font-['Montserrat'] text-[#111] text-center" style={{ fontSize: '11px', fontWeight: 400, opacity: 0.6 }}>
            © 2024 Drift & Dwells. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
