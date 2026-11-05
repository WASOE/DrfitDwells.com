import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { HOME_IMAGES } from '../../data/homepageMedia';
import { localizePath } from '../../utils/localizedRoutes';
import { useSiteLanguage } from '../../hooks/useSiteLanguage';
import HomePicture from './HomePicture';
import { eyebrowClass, primaryCtaClass, secondaryCtaClass, sectionClass, titleClass, wrapClass } from './homeStyles';

const STATS = ['guests', 'stays', 'aframes', 'valley'];

export default function HomeGroupStay() {
  const { t } = useTranslation('home');
  const { language } = useSiteLanguage();

  return (
    <section id="groups" className={`bg-white ${sectionClass}`} aria-labelledby="home-groups-title">
      <div className={wrapClass}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-16 items-center">
          <div className="relative aspect-[4/3] bg-stone-200 overflow-hidden min-w-0">
            <HomePicture
              image={HOME_IMAGES.valleyVillage}
              alt={t('group.imageAlt')}
              sizes="(min-width: 1024px) 45vw, 100vw"
              className="absolute inset-0 h-full w-full object-cover"
            />
          </div>
          <div className="max-w-xl">
            <p className={`${eyebrowClass} mb-4`}>{t('group.eyebrow')}</p>
            <h2 id="home-groups-title" className={titleClass}>{t('group.title')}</h2>
            <p className="mt-5 text-base md:text-lg text-stone-700 leading-relaxed">{t('group.body')}</p>
            <dl className="mt-8 grid grid-cols-2 gap-4">
              {STATS.map((stat) => (
                <div key={stat} className="border border-[#E5E5E0] p-4">
                  <dt className="font-serif text-3xl text-[#1c1917]">{t(`group.stats.${stat}.value`)}</dt>
                  <dd className="mt-1 text-sm text-stone-600">{t(`group.stats.${stat}.label`)}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-8 flex flex-col sm:flex-row gap-3">
              <Link to={localizePath('/retreats/the-valley', language)} className={primaryCtaClass}>
                {t('group.hire')}
              </Link>
              <Link to={localizePath('/retreat-venue-bulgaria', language)} className={secondaryCtaClass}>
                {t('group.retreat')}
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
