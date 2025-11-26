import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

const Header = () => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const location = useLocation();
  const isHeroOverlay = location.pathname === '/';

  const wrapperClasses = isHeroOverlay
    ? 'fixed top-0 inset-x-0 w-full z-50 bg-transparent'
    : 'bg-white shadow-sm border-b border-drift-highlight z-50';

  const linkClasses = isHeroOverlay
    ? 'text-white/80 hover:text-white transition-colors duration-200 font-medium tracking-wider uppercase text-sm'
    : 'text-drift-muted hover:text-drift-primary transition-colors duration-200 font-medium tracking-wider uppercase text-sm';

  const logoTextClasses = isHeroOverlay
    ? 'text-xl font-bold text-white tracking-wider uppercase'
    : 'text-xl font-bold text-drift-text tracking-wider uppercase';

  const logoBadgeClasses = isHeroOverlay
    ? 'w-10 h-10 bg-white/15 backdrop-blur-md border border-white/30 rounded-xl flex items-center justify-center'
    : 'w-10 h-10 bg-drift-primary rounded-xl flex items-center justify-center';

  const mobileButtonClasses = isHeroOverlay
    ? 'text-white/80 hover:text-white transition-colors duration-200'
    : 'text-drift-muted hover:text-drift-primary transition-colors duration-200';

  return (
    <header className={wrapperClasses}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-20">
          {/* Logo */}
          <Link to="/" className="flex items-center space-x-2 sm:space-x-3" onClick={() => setIsMobileMenuOpen(false)}>
            <div className={logoBadgeClasses}>
              <span className="text-white font-bold text-xs sm:text-sm tracking-widest mix-blend-normal">D&D</span>
            </div>
            <span className={`${logoTextClasses} text-base sm:text-xl`}>
              Drift & Dwells
            </span>
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex space-x-8">
            <Link 
              to="/" 
              className={linkClasses}
            >
              Home
            </Link>
            <Link 
              to="/search" 
              className={linkClasses}
            >
              Search Cabins
            </Link>
          </nav>

          {/* Mobile menu button */}
          <div className="md:hidden">
            <button 
              className={`${mobileButtonClasses} p-2 -mr-2 touch-manipulation`}
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              aria-label="Toggle menu"
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
            </button>
          </div>
        </div>

        {/* Mobile Navigation Menu */}
        {isMobileMenuOpen && (
          <nav className="md:hidden border-t border-white/10 mt-2 pt-4 pb-4">
            <div className="flex flex-col space-y-3">
              <Link 
                to="/" 
                className={`${linkClasses} px-4 py-2 text-base touch-manipulation`}
                onClick={() => setIsMobileMenuOpen(false)}
              >
                Home
              </Link>
              <Link 
                to="/search" 
                className={`${linkClasses} px-4 py-2 text-base touch-manipulation`}
                onClick={() => setIsMobileMenuOpen(false)}
              >
                Search Cabins
              </Link>
            </div>
          </nav>
        )}
      </div>
    </header>
  );
};

export default Header;
