import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { HOME_IMAGES } from '../../data/homepageMedia';
import { localizePath } from '../../utils/localizedRoutes';
import { useSiteLanguage } from '../../hooks/useSiteLanguage';
import HomePicture from './HomePicture';
import { eyebrowClass, titleClass, wrapClass } from './homeStyles';

const OCCASIONS = [
  { id: 'two', image: HOME_IMAGES.couple, path: '/cabin', object: 'object-[center_28%]' },
  { id: 'together', image: HOME_IMAGES.together, path: '/retreats/the-valley', object: 'object-[center_42%]' },
  { id: 'quiet', image: HOME_IMAGES.quiet, path: '/cabin', object: 'object-[center_45%]' },
];

export default function HomeOccasions() {
  const { t } = useTranslation('home');
  const { language } = useSiteLanguage();

  return (
    <section className="bg-[#FFFDF8] py-14 md:py-20 lg:py-[6.5rem]" aria-labelledby="home-occasions-title">
      <div className={wrapClass}>
        <div className="max-w-3xl mb-10 md:mb-12">
          <p className={`${eyebrowClass} mb-4`}>{t('occasions.eyebrow')}</p>
          <h2 id="home-occasions-title" className={titleClass}>{t('occasions.title')}</h2>
          <p className="mt-5 text-base md:text-lg text-stone-700 leading-relaxed max-w-2xl">
            {t('occasions.body')}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 lg:gap-6">
          {OCCASIONS.map((item) => (
            <article
              key={item.id}
              className="relative h-[340px] sm:h-[380px] lg:h-[420px] overflow-hidden bg-[#1c1917] group min-w-0"
            >
              <HomePicture
                image={item.image}
                alt={t(`occasions.items.${item.id}.imageAlt`)}
                sizes="(min-width: 1024px) 30vw, (min-width: 768px) 45vw, 100vw"
                className={`absolute inset-0 h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04] ${item.object}`}
              />
              <div
                className="absolute inset-0 bg-gradient-to-t from-[#0c0a09]/95 via-[#0c0a09]/40 to-transparent"
                aria-hidden="true"
              />
              <div className="absolute inset-x-0 bottom-0 z-10 p-6 sm:p-8 text-[#F1ECE2]">
                <h3 className="font-serif text-[1.75rem] sm:text-[1.9rem] tracking-tight mb-3 leading-tight">
                  {t(`occasions.items.${item.id}.title`)}
                </h3>
                <p className="text-sm text-stone-200 leading-relaxed max-w-sm">
                  {t(`occasions.items.${item.id}.body`)}
                </p>
                <Link
                  to={localizePath(item.path, language)}
                  className="inline-flex mt-5 text-[11px] uppercase tracking-[0.14em] border-b border-white/50 pb-1.5 hover:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F1ECE2]"
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
