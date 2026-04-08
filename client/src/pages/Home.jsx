import { Suspense, lazy } from 'react';
import '../i18n/ns/home';
import DualityHero from '../components/DualityHero';
import Seo from '../components/Seo';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../context/LanguageContext.jsx';
import { useSeason } from '../context/SeasonContext';
import { getCabinHeroPreloadUrl, getHomeHeroMobilePosterUrls } from '../config/heroResponsive';
import { CONTACT_PHONE } from '../data/gmbLocations';
import { buildHreflangAlternates } from '../utils/localizedRoutes';
import { getSiteUrl } from '../utils/siteUrl';

const MemoryStream = lazy(() => import('../components/MemoryStream'));
const BookingDrawer = lazy(() => import('../components/BookingDrawer'));
const AuthorityStrip = lazy(() => import('../components/AuthorityStrip'));
const CraftExperienceSection = lazy(() => import('../components/CraftExperienceSection'));
const DestinationsFooter = lazy(() => import('../components/DestinationsFooter'));
const Footer = lazy(() => import('../components/Footer'));

const origin = getSiteUrl();

const Home = () => {
  const { t } = useTranslation('home');
  const { t: tc } = useTranslation('common');
  const { language } = useLanguage();
  const { season } = useSeason();
  // Mobile hero first paint is always the poster JPGs (left cabin, right valley),
  // so we only preload those on small viewports.
  const { cabin: mobileCabinPoster, valley: mobileValleyPoster } = getHomeHeroMobilePosterUrls(season);
  const seoTitle =
    language === 'bg'
      ? 'Планински оф-грид ретрийт България – Drift & Dwells'
      : 'Off-Grid Mountain Retreats in Bulgaria – Drift & Dwells';
  const seoDescription =
    language === 'bg'
      ? 'Тишина и природа в Родопите и Пирин: оф-грид къщи и глемпинг за двойки и малки групи. The Cabin и The Valley—резервирайте престой сред планината.'
      : 'Escape to quiet mountain retreats in Bulgaria\'s Rhodopes and Pirin. Off-grid cabins and glamping for hikers and nature lovers—The Cabin and The Valley. Book your stay.';

  return (
    <>
      <Seo
        title={seoTitle}
        description={seoDescription}
        canonicalPath="/"
        hreflangAlternates={buildHreflangAlternates('/')}
        preloadImages={[
          {
            href: getCabinHeroPreloadUrl(season),
            type: 'image/avif',
            as: 'image',
            fetchPriority: 'high',
            media: '(min-width: 768px)'
          },
          {
            href: mobileCabinPoster,
            as: 'image',
            fetchPriority: 'high',
            media: '(max-width: 767px)'
          },
          {
            href: mobileValleyPoster,
            as: 'image',
            fetchPriority: 'low',
            media: '(max-width: 767px)'
          }
        ]}
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
              {tc('announcement.bar')}
            </p>
          </div>
        </section>

        <Suspense
          fallback={<div className="min-h-[200px] bg-[#F9F9F7] border-y border-[#E5E5E0]" aria-hidden />}
        >
          <AuthorityStrip />
        </Suspense>

        {/* Craft Your Experience - Premium Conversion Section */}
        <Suspense fallback={<div className="min-h-[320px] bg-white" aria-hidden />}>
          <CraftExperienceSection variant="editorial" />
        </Suspense>

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
        <Suspense fallback={<div className="min-h-[240px] bg-white" aria-hidden />}>
          <DestinationsFooter />
        </Suspense>

        {/* Footer */}
        <Suspense fallback={<div className="min-h-[120px] bg-[#F9F8F6]" aria-hidden />}>
          <Footer />
        </Suspense>

        {/* Booking Drawer - Mobile Only */}
        <Suspense fallback={null}>
          <BookingDrawer />
        </Suspense>
      </div>
    </>
  );
};

export default Home;
