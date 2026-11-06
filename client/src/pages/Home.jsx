import { Suspense, lazy } from 'react';
import '../i18n/ns/home';
import DualityHero from '../components/DualityHero';
import Seo from '../components/Seo';
import HomeIntro from '../components/home/HomeIntro';
import HomeStayComparison from '../components/home/HomeStayComparison';
import HomeGroupStay from '../components/home/HomeGroupStay';
import HomeOccasions from '../components/home/HomeOccasions';
import MemoryStream from '../components/MemoryStream';
import HomeTripPlanner from '../components/home/HomeTripPlanner';
import HomeAylyak from '../components/home/HomeAylyak';
import HomeFaq, { HOME_FAQ_KEYS } from '../components/home/HomeFaq';
import HomeVoucher from '../components/home/HomeVoucher';
import HomeFinalCta from '../components/home/HomeFinalCta';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../context/LanguageContext.jsx';
import { useSeason } from '../context/SeasonContext';
import { getCabinHeroPreloadUrl, getHomeHeroMobilePosterUrls } from '../config/heroResponsive';
import { CONTACT_PHONE, INSTAGRAM_URL, FACEBOOK_URL } from '../data/gmbLocations';
import { buildHreflangAlternates } from '../utils/localizedRoutes';
import { getSiteUrl } from '../utils/siteUrl';
import { BRANDING } from '../config/brandingAssets';

const BookingDrawer = lazy(() => import('../components/BookingDrawer'));
const AuthorityStrip = lazy(() => import('../components/AuthorityStrip'));
const Footer = lazy(() => import('../components/Footer'));

const origin = getSiteUrl();

const Home = () => {
  const { t } = useTranslation('home');
  const { t: tc } = useTranslation('common');
  const { language } = useLanguage();
  const { season } = useSeason();
  const { cabin: mobileCabinPoster, valley: mobileValleyPoster } = getHomeHeroMobilePosterUrls(season);
  const seoTitle =
    language === 'bg'
      ? 'Офгрид къщи в планините на България | Drift & Dwells'
      : "Off-Grid Cabins in Bulgaria's Mountains | Drift & Dwells";
  const seoDescription =
    language === 'bg'
      ? 'Частна горска къща край Банско и скрито селище от A-frame на 1550 м в Родопите. Горещи вани на дърва, без тълпи. Директна резервация, без такси.'
      : 'A private forest cabin near Bansko and a hidden A-frame village at 1,550 m in the Rhodopes. Wood-fired hot tubs, no crowds. Book direct, no fees.';

  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: HOME_FAQ_KEYS.map((key) => ({
      '@type': 'Question',
      name: t(`faq.items.${key}.q`),
      acceptedAnswer: {
        '@type': 'Answer',
        text: t(`faq.items.${key}.a`),
      },
    })),
  };

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
            logo: `${origin}${BRANDING.schemaLogoWebp}`,
            sameAs: [INSTAGRAM_URL, FACEBOOK_URL]
          },
          faqJsonLd
        ]}
      />
      <div className="min-h-screen bg-white overflow-x-hidden">
        <div id="booking">
          <DualityHero />
        </div>

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

        <HomeIntro />
        <HomeStayComparison />
        <HomeGroupStay />
        <HomeOccasions />
        <HomeTripPlanner />
        <MemoryStream />
        <HomeAylyak />
        <HomeFaq />
        <HomeVoucher />
        <HomeFinalCta />

        <Suspense fallback={<div className="min-h-[120px] bg-[#F9F8F6]" aria-hidden />}>
          <Footer />
        </Suspense>

        <Suspense fallback={null}>
          <BookingDrawer />
        </Suspense>
      </div>
    </>
  );
};

export default Home;
