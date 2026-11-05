import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { localizePath } from '../../utils/localizedRoutes';
import { useSiteLanguage } from '../../hooks/useSiteLanguage';
import { eyebrowClass, titleClass, wrapClass } from './homeStyles';

const GUIDES = [
  { id: 'cabins', path: '/off-grid-cabins-bulgaria' },
  { id: 'detox', path: '/digital-detox-bulgaria' },
  { id: 'rhodopes', path: '/rhodopes-cabin-retreat' },
  { id: 'bansko', path: '/bansko-remote-work-retreat' },
  { id: 'venue', path: '/retreat-venue-bulgaria' },
];

export default function HomeGuides() {
  const { t } = useTranslation('home');
  const { language } = useSiteLanguage();

  return (
    <section className="bg-[#F6F1E8] py-14 md:py-20 lg:py-24" aria-labelledby="home-guides-title">
      <div className={wrapClass}>
        <div className="max-w-3xl mb-8">
          <p className={`${eyebrowClass} mb-4`}>{t('guides.eyebrow')}</p>
          <h2 id="home-guides-title" className={titleClass}>{t('guides.title')}</h2>
        </div>
        <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {GUIDES.map((guide) => (
            <li key={guide.id}>
              <Link
                to={localizePath(guide.path, language)}
                className="block h-full bg-white border border-[#E5E5E0] p-6 hover:border-[#1c1917]"
              >
                <h3 className="font-serif text-2xl text-[#1c1917] mb-2">{t(`guides.items.${guide.id}.title`)}</h3>
                <p className="text-sm text-stone-800 leading-relaxed">{t(`guides.items.${guide.id}.body`)}</p>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
