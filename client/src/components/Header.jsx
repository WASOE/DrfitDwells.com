import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useBookingSearch } from '../context/BookingSearchContext';
import { useLanguage } from '../context/LanguageContext.jsx';
import { useSiteLanguage } from '../hooks/useSiteLanguage';
import { localizePath, stripLocaleFromPath } from '../utils/localizedRoutes';

const Header = () => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const location = useLocation();
  const { t } = useTranslation('nav');
  const { setLanguage } = useLanguage();
  const { language } = useSiteLanguage();
  const { openModal } = useBookingSearch();
  const basePath = stripLocaleFromPath(location.pathname);
  const isHeroOverlay = basePath === '/' || basePath === '/cabin' || basePath === '/valley';

  useEffect(() => {
    if (!isHeroOverlay) {
      setIsScrolled(false);
      return;
    }

    const handleScroll = () => {
      setIsScrolled(window.scrollY > 50);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [isHeroOverlay]);

  useEffect(() => {
    if (isMobileMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isMobileMenuOpen]);

  const useDarkTheme = isScrolled || !isHeroOverlay;
  const giftNavLabel = language === 'bg' ? 'Подари престой' : 'Gift a stay';

  const navLinks = [
    { to: localizePath('/', language), label: t('home') },
    { to: localizePath('/cabin', language), label: t('cabin') },
    { to: localizePath('/valley', language), label: t('valley') },
    { to: localizePath('/about', language), label: t('about') },
    { to: localizePath('/build', language), label: t('build') }
  ];

  const mobileNavLinks = [
    { to: localizePath('/', language), label: t('home'), isModal: false },
    { to: localizePath('/cabin', language), label: t('cabin'), isModal: false },
    { to: localizePath('/valley', language), label: t('valley'), isModal: false },
    { to: localizePath('/about', language), label: t('about'), isModal: false },
    { to: localizePath('/build', language), label: t('build'), isModal: false },
    { to: null, label: t('search'), isModal: true }
  ];

  const isActive = (path) => stripLocaleFromPath(path) === basePath;

  const handleMobileLinkClick = (link) => {
    setIsMobileMenuOpen(false);
    if (link.isModal) {
      openModal();
    }
  };

  const linkTextClasses = useDarkTheme
    ? 'text-stone-900'
    : 'text-white';

  return (
    <>
      <header className={`fixed top-0 w-full z-50 px-6 py-6 transition-all duration-300 ${useDarkTheme ? 'bg-white/90 backdrop-blur-md shadow-sm' : 'bg-transparent'}`}>
        <div className="max-w-7xl mx-auto">
          <div className="flex justify-between items-center">
            <div className="flex-shrink-0">
              <Link to={localizePath('/', language)} className="flex items-center" onClick={() => setIsMobileMenuOpen(false)}>
                {useDarkTheme ? (
                  <img
                    src="/uploads/Logo/DRIFTS-ai.png"
                    alt="Drift & Dwells"
                    className="h-8 sm:h-10 w-auto transition-opacity duration-300"
                    style={{ filter: 'contrast(1.1) brightness(0.95)' }}
                  />
                ) : (
                  <img
                    src="/uploads/Logo/Drift-Dwell-white.png"
                    alt="Drift & Dwells"
                    className="h-8 sm:h-10 w-auto transition-opacity duration-300 drop-shadow-md"
                  />
                )}
              </Link>
            </div>

            <nav className="hidden md:flex items-center gap-8 lg:gap-10 transition-all duration-300 whitespace-nowrap">
              {navLinks.map((link) => {
                const active = isActive(link.to);
                return (
                  <Link
                    key={link.to}
                    to={link.to}
                    className={`
                      text-[11px] md:text-xs font-medium uppercase tracking-[0.2em] transition-colors duration-200 ${linkTextClasses}
                      ${active ? 'opacity-100' : useDarkTheme ? 'opacity-70 hover:opacity-100' : 'opacity-80 hover:opacity-100'}
                    `}
                  >
                    {link.label}
                  </Link>
                );
              })}
            </nav>

            <div className="hidden md:flex items-center flex-shrink-0 ml-4 lg:ml-6 gap-2">
              <Link
                to={localizePath('/gift-vouchers', language)}
                className={`text-[11px] font-medium uppercase tracking-[0.22em] transition-colors duration-200 mr-2 ${
                  useDarkTheme
                    ? 'text-stone-700/80 hover:text-stone-900'
                    : 'text-white/85 hover:text-white'
                }`}
              >
                {giftNavLabel}
              </Link>
              <div className="flex items-center gap-1 text-[11px] uppercase tracking-[0.2em]">
                <button
                  type="button"
                  onClick={() => setLanguage('en')}
                  className={`px-2 py-1 rounded-full ${
                    language === 'en'
                      ? 'bg-stone-900 text-[#F1ECE2]'
                      : 'bg-transparent text-stone-500'
                  }`}
                >
                  {t('language.en')}
                </button>
                <button
                  type="button"
                  onClick={() => setLanguage('bg')}
                  className={`px-1.5 py-0.5 rounded-full ${
                    language === 'bg'
                      ? 'bg-stone-900 text-[#F1ECE2]'
                      : 'bg-transparent text-stone-500'
                  }`}
                >
                  {t('language.bg')}
                </button>
              </div>
              <button
                type="button"
                onClick={openModal}
                className="bg-[#F1ECE2] text-stone-900 px-5 py-2.5 rounded-full font-bold uppercase tracking-[0.3em] text-xs hover:scale-105 transition-transform shadow-md active:scale-95 min-h-[2.5rem] flex items-center justify-center ml-4 lg:ml-6"
              >
                {t('book')}
              </button>
            </div>

            <div className="md:hidden relative z-[70] flex-shrink-0 flex items-center gap-2">
              <button
                type="button"
                className={`
                  p-2 -mr-2 touch-manipulation transition-colors duration-200
                  ${isMobileMenuOpen
                    ? 'text-[#F1ECE2]'
                    : useDarkTheme
                      ? 'text-stone-700 hover:text-stone-900'
                      : 'text-white/80 hover:text-white'
                  }
                `}
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                aria-expanded={isMobileMenuOpen}
                aria-controls="site-mobile-nav"
                aria-label="Toggle menu"
              >
                <span
                  className={`block transition-transform duration-300 ease-out ${isMobileMenuOpen ? 'rotate-90' : 'rotate-0'}`}
                >
                  {isMobileMenuOpen ? (
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  ) : (
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                    </svg>
                  )}
                </span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {isMobileMenuOpen && (
        <div
          id="site-mobile-nav"
          role="dialog"
          aria-modal="true"
          aria-label="Site navigation"
          className="fixed inset-0 z-[60] bg-stone-900/90 backdrop-blur-xl md:hidden animate-header-veil"
          onClick={() => setIsMobileMenuOpen(false)}
        >
          <button
            type="button"
            aria-label="Close menu"
            onClick={(e) => {
              e.stopPropagation();
              setIsMobileMenuOpen(false);
            }}
            className="fixed top-20 left-6 z-[70] w-12 h-12 rounded-full bg-stone-900/90 backdrop-blur-md text-[#F1ECE2] border border-[#f8f2e8]/15 shadow-lg flex items-center justify-center transition-all duration-150 hover:bg-black/90 active:scale-95 touch-manipulation"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.25}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <nav
            className="h-full flex flex-col items-center justify-center px-6"
            onClick={(e) => e.stopPropagation()}
          >
            {mobileNavLinks.map((link, i) => (
              <div
                key={link.label}
                className="mb-6 opacity-0 animate-header-nav-in"
                style={{ animationDelay: `${80 + i * 70}ms` }}
              >
                {link.isModal ? (
                  <button
                    type="button"
                    onClick={() => handleMobileLinkClick(link)}
                    className="font-['Playfair_Display'] text-4xl text-[#F1ECE2] hover:text-white transition-colors duration-200 touch-manipulation"
                  >
                    {link.label}
                  </button>
                ) : (
                  <Link
                    to={link.to}
                    onClick={() => handleMobileLinkClick(link)}
                    className="font-['Playfair_Display'] text-4xl text-[#F1ECE2] hover:text-white transition-colors duration-200 touch-manipulation block"
                  >
                    {link.label}
                  </Link>
                )}
              </div>
            ))}
            <div
              className="mb-8 opacity-0 animate-header-nav-in"
              style={{ animationDelay: `${80 + mobileNavLinks.length * 70}ms` }}
            >
              <Link
                to={localizePath('/gift-vouchers', language)}
                onClick={() => setIsMobileMenuOpen(false)}
                className="font-['Playfair_Display'] text-3xl text-[#F1ECE2] hover:text-white transition-colors duration-200 touch-manipulation block"
              >
                {giftNavLabel}
              </Link>
            </div>
            <div
              className="mt-10 flex items-center justify-center gap-1 text-[11px] uppercase tracking-[0.2em] opacity-0 animate-header-nav-in"
              style={{ animationDelay: `${80 + (mobileNavLinks.length + 1) * 70}ms` }}
            >
              <button
                type="button"
                onClick={() => {
                  setLanguage('en');
                  setIsMobileMenuOpen(false);
                }}
                className={`px-2 py-1 rounded-full touch-manipulation ${
                  language === 'en'
                    ? 'bg-[#F1ECE2] text-stone-900'
                    : 'bg-transparent text-[#F1ECE2]/70 hover:text-[#F1ECE2]'
                }`}
              >
                {t('language.en')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setLanguage('bg');
                  setIsMobileMenuOpen(false);
                }}
                className={`px-1.5 py-0.5 rounded-full touch-manipulation ${
                  language === 'bg'
                    ? 'bg-[#F1ECE2] text-stone-900'
                    : 'bg-transparent text-[#F1ECE2]/70 hover:text-[#F1ECE2]'
                }`}
              >
                {t('language.bg')}
              </button>
            </div>
          </nav>
        </div>
      )}
    </>
  );
};

export default Header;
