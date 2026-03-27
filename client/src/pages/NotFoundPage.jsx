import { Link, useLocation } from 'react-router-dom';
import Seo from '../components/Seo';
import useTrack404Hit from '../hooks/useTrack404Hit';

const getLocalePrefix = (pathname) => {
  if (pathname === '/bg' || pathname.startsWith('/bg/')) return '/bg';
  if (pathname === '/nl' || pathname.startsWith('/nl/')) return '/nl';
  return '';
};

const withLocale = (prefix, path) => {
  if (!prefix) return path;
  if (path === '/') return prefix;
  return `${prefix}${path}`;
};

const NotFoundPage = () => {
  const location = useLocation();
  const prefix = getLocalePrefix(location.pathname);

  useTrack404Hit(location.pathname);

  return (
    <>
      <Seo
        title="Page not found | Drift & Dwells"
        description="This page could not be found. Continue your Drift & Dwells journey."
        suppressCanonical
        noindex
      />

      <main className="relative min-h-[calc(100vh-var(--header-offset))] bg-[#F8F5EF] text-[#1F1B17] overflow-hidden">
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-[0.12]"
          style={{
            backgroundImage: 'url("/uploads/Videos/The-cabin-header.summer-poster.jpg")',
            backgroundSize: 'cover',
            backgroundPosition: 'center'
          }}
        />
        <div
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-44 opacity-[0.08]"
          style={{
            background:
              'linear-gradient(180deg, transparent 0%, rgba(31,27,23,0.85) 100%)'
          }}
        />

        <section className="relative max-w-7xl mx-auto px-4 sm:px-6 py-10 md:py-16 lg:py-20">
          <div className="max-w-4xl lg:max-w-[620px] lg:ml-auto lg:mr-[8%]">
            <p className="text-[11px] uppercase tracking-[0.32em] text-[#5B554D]">PAGE NOT FOUND</p>

            <div className="mt-4 leading-none">
              <span className="block font-['Playfair_Display'] text-[120px] sm:text-[170px] md:text-[220px] lg:text-[270px] text-[#1F1B17] tracking-[-0.03em]">
                404
              </span>
            </div>

            <h1 className="mt-1 font-['Playfair_Display'] text-3xl sm:text-4xl md:text-5xl text-[#1F1B17] leading-[1.08] max-w-3xl">
              You took the scenic route.
            </h1>

            <p className="mt-5 text-base sm:text-lg text-[#49433B] max-w-2xl">
              This path does not lead to a cabin.
            </p>
            <p className="mt-2 text-sm sm:text-base text-[#5E574D]">
              Let&apos;s get you back on a better trail.
            </p>

            <div className="mt-8 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
              <Link
                to={withLocale(prefix, '/')}
                className="inline-flex items-center justify-center rounded-full px-6 py-3 bg-[#1F1B17] text-[#F8F5EF] text-xs uppercase tracking-[0.2em] font-semibold"
              >
                Back to homepage
              </Link>
              <Link
                to={withLocale(prefix, '/valley')}
                className="inline-flex items-center justify-center rounded-full px-6 py-3 border border-[#1F1B17]/30 text-[#1F1B17] text-xs uppercase tracking-[0.2em] font-semibold"
              >
                Explore The Valley
              </Link>
            </div>

            <div className="mt-4">
              <Link
                to={withLocale(prefix, '/search')}
                className="inline-flex text-xs uppercase tracking-[0.2em] text-[#4E5E4C] underline underline-offset-4"
              >
                Check availability
              </Link>
            </div>
          </div>
        </section>
      </main>
    </>
  );
};

export default NotFoundPage;
