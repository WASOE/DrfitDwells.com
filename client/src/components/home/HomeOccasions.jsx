import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { HOME_IMAGES } from '../../data/homepageMedia';
import { localizePath } from '../../utils/localizedRoutes';
import { useSiteLanguage } from '../../hooks/useSiteLanguage';
import HomePicture from './HomePicture';
import { eyebrowClass, sectionClass, titleClass, wrapClass } from './homeStyles';

const OCCASIONS = [
  { id: 'two', image: HOME_IMAGES.couple, path: '/cabin' },
  { id: 'together', image: HOME_IMAGES.firepit, path: '/retreats/the-valley' },
  { id: 'quiet', image: HOME_IMAGES.cabinForest, path: '/cabin' },
];

export default function HomeOccasions() {
  const { t } = useTranslation('home');
  const { language } = useSiteLanguage();

  return (
    <section className={`bg-[#F9F9F7] ${sectionClass}`} aria-labelledby="home-occasions-title">
      <div className={wrapClass}>
        <div className="max-w-3xl mb-8 md:mb-12">
          <p className={`${eyebrowClass} mb-4`}>{t('occasions.eyebrow')}</p>
          <h2 id="home-occasions-title" className={titleClass}>{t('occasions.title')}</h2>
          <p className="mt-5 text-base md:text-lg text-stone-700 leading-relaxed max-w-2xl">{t('occasions.body')}</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {OCCASIONS.map((item) => (
            <article key={item.id} className="bg-white border border-[#E5E5E0] overflow-hidden flex flex-col min-w-0">
              <div className="relative aspect-[4/5] bg-stone-200">
                <HomePicture
                  image={item.image}
                  alt={t(`occasions.items.${item.id}.imageAlt`)}
                  sizes="(min-width: 1024px) 30vw, (min-width: 768px) 50vw, 100vw"
                  className="absolute inset-0 h-full w-full object-cover"
                />
              </div>
              <div className="p-5 sm:p-6 flex flex-col flex-1">
                <h3 className="font-serif text-2xl text-[#1c1917] mb-3">{t(`occasions.items.${item.id}.title`)}</h3>
                <p className="text-sm text-stone-700 leading-relaxed mb-5">{t(`occasions.items.${item.id}.body`)}</p>
                <Link
                  to={localizePath(item.path, language)}
                  className="mt-auto text-sm text-[#1c1917] underline underline-offset-4 decoration-stone-300 hover:decoration-stone-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1c1917] focus-visible:ring-offset-2"
                >
                  {t(`occasions.items.${item.id}.cta`)}
                </Link>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
