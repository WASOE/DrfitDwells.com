import { Suspense, lazy } from 'react';
import '../i18n/ns/home';
import DualityHero from '../components/DualityHero';
import Seo from '../components/Seo';
import HomeOrient from '../components/home/HomeOrient';
import HomeTripPlanner from '../components/home/HomeTripPlanner';
import HomeFacts from '../components/home/HomeFacts';
import HomeReviews from '../components/home/HomeReviews';
import HomeAccess from '../components/home/HomeAccess';
import HomeGroupStay from '../components/home/HomeGroupStay';
import HomeGuides from '../components/home/HomeGuides';
import HomeFaq, { HOME_FAQ_KEYS } from '../components/home/HomeFaq';
import HomeVoucher from '../components/home/HomeVoucher';
import HomeFinalCta from '../components/home/HomeFinalCta';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../context/LanguageContext.jsx';
import { useSeason } from '../context/SeasonContext';
import { getCabinHeroPreloadUrl, getHomeHeroMobilePosterUrls } from '../config/heroResponsive';
import { CONTACT_PHONE, CONTACT_EMAIL, INSTAGRAM_URL, FACEBOOK_URL, GMB_LOCATIONS } from '../data/gmbLocations';
import { buildHreflangAlternates } from '../utils/localizedRoutes';
import { getSiteUrl } from '../utils/siteUrl';
import { BRANDING } from '../config/brandingAssets';

const BookingDrawer = lazy(() => import('../components/BookingDrawer'));
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
      ? 'Офгрид къща край Бачево и селище в Родопите – Drift & Dwells'
      : 'Off-grid cabin and mountain village stays in Bulgaria – Drift & Dwells';
  const seoDescription =
    language === 'bg'
      ? 'Резервирайте директно: самостоятелна офгрид къща за двама край Бачево и The Valley в Родопите — пет A-frame къщички, Luxury Cabin и каменна къща за до 18 гости.'
      : 'Book direct: a private off-grid cabin for two near Bachevo, and The Valley in the Rhodopes — five A-frames, a Luxury Cabin and a Stone House for up to 18 guests.';

  const lodgingJsonLd = ['cabin', 'valley'].map((key) => {
    const place = GMB_LOCATIONS[key];
    return {
      '@context': 'https://schema.org',
      '@type': 'LodgingBusiness',
      name: place.businessName,
      description: place.description,
      url: place.url,
      telephone: CONTACT_PHONE,
      email: CONTACT_EMAIL,
      address: {
        '@type': 'PostalAddress',
        addressLocality: place.address.locality,
        postalCode: place.address.postalCode,
        addressRegion: place.address.region,
        addressCountry: place.address.country,
      },
      geo: {
        '@type': 'GeoCoordinates',
        latitude: place.geo.latitude,
        longitude: place.geo.longitude,
      },
    };
  });

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
          faqJsonLd,
          ...lodgingJsonLd
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

        <HomeOrient />
        <HomeTripPlanner />
        <HomeFacts />
        <HomeReviews />
        <HomeAccess />
        <HomeGroupStay />
        <HomeGuides />
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
