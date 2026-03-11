import { Suspense, lazy } from 'react';
import DualityHero from '../components/DualityHero';
import AuthorityStrip from '../components/AuthorityStrip';
import DestinationsFooter from '../components/DestinationsFooter';
import Footer from '../components/Footer';
import CraftExperienceSection from '../components/CraftExperienceSection';
import Seo from '../components/Seo';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../context/LanguageContext.jsx';
import { CONTACT_PHONE } from '../data/gmbLocations';
import { buildHreflangAlternates } from '../utils/localizedRoutes';
import { getSiteUrl } from '../utils/siteUrl';

const MemoryStream = lazy(() => import('../components/MemoryStream'));
const BookingDrawer = lazy(() => import('../components/BookingDrawer'));

const origin = getSiteUrl();

const Home = () => {
  const { t } = useTranslation('home');
  const { language } = useLanguage();
  const seoTitle =
    language === 'bg'
      ? 'Drift & Dwells | Оф-грид планински уединения в България'
      : 'Drift & Dwells | Off-Grid Mountain Retreats in Bulgaria';
  const seoDescription =
    language === 'bg'
      ? 'Резервирайте оф-грид планинско уединение в България с Drift & Dwells. Отседнете в The Cabin или The Valley за бавно, осъзнато време сред Родопите.'
      : 'Book off-grid mountain retreats in Bulgaria with Drift & Dwells. Stay at The Cabin or The Valley for slow, intentional time in the Rhodope mountains.';

  return (
    <>
      <Seo
        title={seoTitle}
        description={seoDescription}
        canonicalPath="/"
        hreflangAlternates={buildHreflangAlternates('/')}
        ogImage="/uploads/Videos/The-cabin-header.winter-poster.jpg"
        jsonLd={[
          {
            '@context': 'https://schema.org',
            '@type': 'WebSite',
            '@id': `${origin}#website`,
            name: 'Drift & Dwells',
            url: origin
          },
          {
            '@context': 'https://schema.org',
            '@type': 'Organization',
            '@id': `${origin}#organization`,
            name: 'Drift & Dwells',
            url: origin,
            telephone: CONTACT_PHONE,
            logo: `${origin}/uploads/Logo/DRIFTS-01.png`
          }
        ]}
      />
      <div className="min-h-screen bg-white">
        <DualityHero />

        {/* Mobile Top 1% band – inline, non-sticky, under hero video */}
        <section className="md:hidden bg-[#1c1917] border-t border-white/10">
          <div className="text-center px-4 py-3">
            <p className="text-[#F1ECE2] text-[10px] font-bold uppercase tracking-[0.2em]">
              RATED TOP 1% ON PLATFORMS • WE&apos;VE GONE SOLO • BOOK DIRECT &amp; SAVE FEES
            </p>
          </div>
        </section>

        <AuthorityStrip />

        {/* Craft Your Experience - Premium Conversion Section */}
        <CraftExperienceSection variant="editorial" />

        <Suspense fallback={<div className="py-16 text-center text-sm tracking-[0.3em] uppercase text-gray-500">{t('memory.loading')}</div>}>
          <MemoryStream />
        </Suspense>

        {/* Philosophy + Mission Section - The Art of Aylyak (Editorial Poster Layout) */}
        <section className="relative py-12 md:py-24 lg:py-32 bg-white">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 md:px-16">
            {/* Main word + phonetic + type - mobile first typography */}
            <div className="font-serif text-left">
              <h2 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl xl:text-7xl text-gray-900 mb-2 tracking-tight font-normal">
                {t('philosophy.word')}
              </h2>
              <div className="flex flex-wrap items-baseline gap-2 sm:gap-3 text-sm sm:text-base md:text-lg text-gray-600 mb-6 md:mb-8">
                <span className="italic font-normal">{t('philosophy.phonetic')}</span>
                <span className="text-sm italic text-gray-500">{t('philosophy.type')}</span>
              </div>

              {/* Divider line */}
              <div className="h-px w-full bg-gray-300 mb-6 md:mb-8" />

              {/* Definitions */}
              <div className="space-y-4 md:space-y-6 text-sm sm:text-base md:text-lg text-gray-800 leading-relaxed">
                <p className="font-serif font-normal">
                  <span className="font-semibold">1.</span>{' '}
                  {t('philosophy.definition1')}
                </p>
                <p className="font-serif font-normal">
                  <span className="font-semibold">2.</span>{' '}
                  {t('philosophy.definition2')}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Destinations Footer - Atmospheric Retreats */}
        <DestinationsFooter />

        {/* Footer */}
        <Footer />

        {/* Booking Drawer - Mobile Only */}
        <Suspense fallback={null}>
          <BookingDrawer />
        </Suspense>
      </div>
    </>
  );
};

export default Home;
