import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { HOME_IMAGES } from '../../data/homepageMedia';
import { localizePath } from '../../utils/localizedRoutes';
import { useSiteLanguage } from '../../hooks/useSiteLanguage';
import HomePicture from './HomePicture';
import { lightCtaClass, outlineLightCtaClass, wrapClass } from './homeStyles';

const STATS = ['guests', 'stays', 'shared', 'valley'];

export default function HomeGroupStay() {
  const { t } = useTranslation('home');
  const { language } = useSiteLanguage();

  return (
    <section
      id="groups"
      className="relative overflow-hidden bg-[#1c1917] text-[#F1ECE2]"
      aria-labelledby="home-groups-title"
    >
      <div className="absolute inset-0" aria-hidden="true">
        <HomePicture
          image={HOME_IMAGES.valleyAframesSummer}
          alt=""
          sizes="100vw"
          className="h-full w-full object-cover object-[center_40%] opacity-[0.28]"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[#1c1917] via-[#1c1917]/88 to-[#1c1917]/55" />
      </div>

      <div className={`relative ${wrapClass} py-16 md:py-20 lg:py-[6.5rem]`}>
        <div className="grid grid-cols-1 lg:grid-cols-[1.35fr_0.65fr] gap-12 lg:gap-16 xl:gap-20 items-center">
          <div className="max-w-2xl">
            <p className="text-[11px] uppercase tracking-[0.22em] text-stone-300 mb-4">
              {t('group.eyebrow')}
            </p>
            <h2
              id="home-groups-title"
              className="font-serif text-4xl sm:text-5xl md:text-[3.8rem] lg:text-[4.2rem] tracking-tight leading-[1.02] mb-6"
            >
              {t('group.title')}
            </h2>
            <p className="text-base md:text-lg text-stone-300 leading-relaxed max-w-xl">
              {t('group.body')}
            </p>
            <p className="mt-5 text-sm text-stone-400 leading-relaxed max-w-xl">
              {t('group.capacityLine')}
            </p>
            <div className="mt-9 flex flex-col sm:flex-row gap-3 max-w-xl">
              <Link to={localizePath('/retreats/the-valley', language)} className={lightCtaClass}>
                {t('group.hire')}
              </Link>
              <Link to={localizePath('/retreat-venue-bulgaria', language)} className={outlineLightCtaClass}>
                {t('group.retreat')}
              </Link>
            </div>
          </div>

          <dl className="border border-white/25 grid grid-cols-2 self-center bg-[#1c1917]/55 backdrop-blur-[2px]">
            {STATS.map((stat, index) => (
              <div
                key={stat}
                className={`px-5 py-8 sm:px-6 sm:py-9 ${index % 2 === 0 ? 'border-r border-white/25' : ''} ${
                  index < 2 ? 'border-b border-white/25' : ''
                }`}
              >
                <dt className="font-serif text-4xl sm:text-5xl text-[#F1ECE2] leading-none">
                  {t(`group.stats.${stat}.value`)}
                </dt>
                <dd className="mt-3 text-[10px] uppercase tracking-[0.13em] text-stone-300 leading-snug">
                  {t(`group.stats.${stat}.label`)}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}
