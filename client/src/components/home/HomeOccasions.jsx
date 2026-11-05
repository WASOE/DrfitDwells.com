import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { HOME_IMAGES } from '../../data/homepageMedia';
import { localizePath } from '../../utils/localizedRoutes';
import { useSiteLanguage } from '../../hooks/useSiteLanguage';
import HomePicture from './HomePicture';
import { eyebrowClass, sectionClass, titleClass, wrapClass } from './homeStyles';

const OCCASIONS = [
  { id: 'two', image: HOME_IMAGES.couple, path: '/cabin', object: 'object-[center_35%]' },
  { id: 'together', image: HOME_IMAGES.together, path: '/retreats/the-valley', object: 'object-center' },
  { id: 'quiet', image: HOME_IMAGES.quiet, path: '/cabin', object: 'object-[center_40%]' },
];

export default function HomeOccasions() {
  const { t } = useTranslation('home');
  const { language } = useSiteLanguage();

  return (
    <section className={`bg-[#FFFDF8] ${sectionClass}`} aria-labelledby="home-occasions-title">
      <div className={wrapClass}>
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6 mb-8 md:mb-12">
          <div className="max-w-3xl">
            <p className={`${eyebrowClass} mb-4`}>{t('occasions.eyebrow')}</p>
            <h2 id="home-occasions-title" className={titleClass}>{t('occasions.title')}</h2>
            <p className="mt-5 text-base md:text-lg text-stone-700 leading-relaxed max-w-2xl">
              {t('occasions.body')}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
          {OCCASIONS.map((item) => (
            <article key={item.id} className="overflow-hidden flex flex-col min-w-0 group">
              <div className="relative aspect-[4/5] bg-stone-200 overflow-hidden">
                <HomePicture
                  image={item.image}
                  alt={t(`occasions.items.${item.id}.imageAlt`)}
                  sizes="(min-width: 1024px) 30vw, (min-width: 768px) 45vw, 100vw"
                  className={`absolute inset-0 h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03] ${item.object}`}
                />
              </div>
              <div className="pt-5 sm:pt-6 flex flex-col flex-1">
                <h3 className="font-serif text-2xl md:text-3xl text-[#1c1917] mb-3 tracking-tight">
                  {t(`occasions.items.${item.id}.title`)}
                </h3>
                <p className="text-sm md:text-base text-stone-700 leading-relaxed mb-5 max-w-sm">
                  {t(`occasions.items.${item.id}.body`)}
                </p>
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
