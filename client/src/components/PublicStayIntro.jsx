import { useTranslation } from 'react-i18next';
import { useSiteLanguage } from '../hooks/useSiteLanguage';
import Seo from './Seo';
import routes from '../data/publicSeoRoutes.json';
import { PAID_TRAFFIC_STAY_META } from '../data/paidTrafficLandingStays';
import { buildHreflangAlternates } from '../utils/localizedRoutes';
import '../i18n/ns/seo';

export function getPublicStayEntry(slug) {
  return routes.find((entry) => entry.stayId && entry.path === `/stays/${slug}`);
}

export default function PublicStayIntro({ slug, children }) {
  const { t } = useTranslation('seo');
  const { language } = useSiteLanguage();
  const entry = getPublicStayEntry(slug);
  if (!entry) return children || null;
  const copy = t(`paidStaysBulgaria.stays.${entry.stayId}`, { returnObjects: true });
  const image = PAID_TRAFFIC_STAY_META.find((stay) => stay.id === entry.stayId)?.fallbackImage;

  return (
    <>
      <Seo
        title={`${copy.title} | Drift & Dwells`}
        description={copy.fitLine}
        canonicalPath={entry.path}
        hreflangAlternates={buildHreflangAlternates(entry.path)}
        ogImage={image}
        ogType="product"
      />
      <section className="max-w-5xl mx-auto px-6 py-12 text-stone-800" data-public-stay={slug}>
        <h1 className="font-serif text-4xl mb-6">{copy.title}</h1>
        <p className="text-lg mb-6">{copy.fitLine}</p>
        {image && <img src={image} alt={copy.title} className="w-full max-h-96 object-cover rounded-xl mb-6" />}
        <ul className="list-disc pl-6 space-y-3 mb-6">
          {copy.facts.map((fact) => <li key={fact}>{fact}</li>)}
        </ul>
        <p className="mb-6">{copy.comparison.bestFor}. {copy.comparison.privacy}. {copy.comparison.comfort}. {copy.comparison.access}.</p>
        <p role="status">{language === 'bg'
          ? 'Актуалната наличност и резервациите се зареждат отделно.'
          : 'Live availability and booking options load separately.'}</p>
        {children}
      </section>
    </>
  );
}
