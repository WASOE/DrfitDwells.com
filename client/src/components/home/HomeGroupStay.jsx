import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { HOME_IMAGES } from '../../data/homepageMedia';
import { localizePath } from '../../utils/localizedRoutes';
import { useSiteLanguage } from '../../hooks/useSiteLanguage';
import HomePicture from './HomePicture';
import {
  lightCtaClass,
  outlineLightCtaClass,
  wrapClass,
} from './homeStyles';

export default function HomeGroupStay() {
  const { t } = useTranslation('home');
  const { language } = useSiteLanguage();

  return (
    <section
      id="groups"
      className="relative overflow-hidden bg-[#1c1917] text-[#F1ECE2] py-14 md:py-20 lg:py-24"
      aria-labelledby="home-groups-title"
    >
      <div className="absolute inset-0">
        <HomePicture
          image={HOME_IMAGES.valleyBuyout}
          alt=""
          sizes="100vw"
          className="h-full w-full object-cover object-[center_60%] opacity-35"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[#1c1917]/95 via-[#1c1917]/80 to-[#1c1917]/55" />
      </div>

      <div className={`relative ${wrapClass}`}>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-end">
          <div className="lg:col-span-7 max-w-2xl">
            <p className="text-[11px] uppercase tracking-[0.22em] text-stone-300 mb-4">
              {t('group.eyebrow')}
            </p>
            <h2
              id="home-groups-title"
              className="font-serif text-4xl sm:text-5xl md:text-[3.4rem] tracking-tight leading-[1.05]"
            >
              {t('group.title')}
            </h2>
            <p className="mt-5 text-base md:text-lg text-stone-200 leading-relaxed max-w-xl">
              {t('group.body')}
            </p>
            <ul className="mt-6 space-y-2 text-sm md:text-base text-stone-300 max-w-xl">
              {['private', 'capacity', 'fire', 'tub', 'occasions'].map((item) => (
                <li key={item} className="flex gap-3">
                  <span aria-hidden="true" className="mt-2 h-1 w-1 rounded-full bg-[#F1ECE2] shrink-0" />
                  <span>{t(`group.points.${item}`)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-5 text-sm text-stone-400">{t('group.capacityLine')}</p>
            <div className="mt-8 flex flex-col sm:flex-row gap-3 max-w-xl">
              <Link to={localizePath('/retreats/the-valley', language)} className={lightCtaClass}>
                {t('group.hire')}
              </Link>
              <Link to={localizePath('/retreat-venue-bulgaria', language)} className={outlineLightCtaClass}>
                {t('group.retreat')}
              </Link>
            </div>
          </div>

          <div className="lg:col-span-5">
            <div className="relative aspect-[4/5] sm:aspect-[5/4] lg:aspect-[4/5] overflow-hidden bg-stone-800 max-w-md lg:max-w-none ml-auto">
              <HomePicture
                image={HOME_IMAGES.firepit}
                alt={t('group.imageAlt')}
                sizes="(min-width: 1024px) 32vw, 90vw"
                className="absolute inset-0 h-full w-full object-cover object-center"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
