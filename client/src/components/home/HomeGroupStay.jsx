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

const STATS = ['guests', 'stays', 'aframes', 'valley'];

export default function HomeGroupStay() {
  const { t } = useTranslation('home');
  const { language } = useSiteLanguage();

  return (
    <section
      id="groups"
      className="relative overflow-hidden bg-[#1c1917] text-[#F1ECE2] py-14 md:py-20 lg:py-28"
      aria-labelledby="home-groups-title"
    >
      <div className="absolute inset-0 opacity-[0.22]" aria-hidden="true">
        <HomePicture
          image={HOME_IMAGES.valleyBuyout}
          alt=""
          sizes="100vw"
          className="h-full w-full object-cover object-center scale-105 blur-[1px]"
        />
      </div>
      <div className={`relative ${wrapClass}`}>
        <div className="grid grid-cols-1 lg:grid-cols-[1.35fr_0.65fr] gap-10 lg:gap-16 items-center">
          <div className="max-w-2xl">
            <p className="text-[11px] uppercase tracking-[0.22em] text-stone-300 mb-4">
              {t('group.eyebrow')}
            </p>
            <h2
              id="home-groups-title"
              className="font-serif text-4xl sm:text-5xl md:text-6xl lg:text-[4.4rem] tracking-tight leading-[1.02]"
            >
              {t('group.title')}
            </h2>
            <p className="mt-6 text-base md:text-lg text-stone-300 leading-relaxed max-w-xl">
              {t('group.body')}
            </p>
            <div className="mt-8 flex flex-col sm:flex-row gap-3 max-w-xl">
              <Link to={localizePath('/retreats/the-valley', language)} className={lightCtaClass}>
                {t('group.hire')}
              </Link>
              <Link to={localizePath('/retreat-venue-bulgaria', language)} className={outlineLightCtaClass}>
                {t('group.retreat')}
              </Link>
            </div>
          </div>

          <dl className="border border-white/25 grid grid-cols-2 bg-[#1c1917]/55 backdrop-blur-[2px]">
            {STATS.map((stat, index) => (
              <div
                key={stat}
                className={`p-5 sm:p-7 ${index % 2 === 0 ? 'border-r border-white/25' : ''} ${
                  index < 2 ? 'border-b border-white/25' : ''
                }`}
              >
                <dt className="font-serif text-4xl sm:text-5xl text-[#F1ECE2]">
                  {t(`group.stats.${stat}.value`)}
                </dt>
                <dd className="mt-2 text-[10px] sm:text-[11px] uppercase tracking-[0.14em] text-stone-300 leading-snug">
                  {t(`group.stats.${stat}.label`)}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="mt-10 md:mt-14">
          <div className="relative aspect-[16/10] md:aspect-[21/9] overflow-hidden bg-stone-800 max-w-7xl">
            <HomePicture
              image={HOME_IMAGES.valleyAframes}
              alt={t('group.imageAlt')}
              sizes="(min-width: 1280px) 80rem, 100vw"
              className="absolute inset-0 h-full w-full object-cover object-[center_72%]"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
