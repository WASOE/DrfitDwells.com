import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { HOME_IMAGES } from '../../data/homepageMedia';
import { capacityExceeded } from '../../data/homepagePlanner';
import { localizePath } from '../../utils/localizedRoutes';
import { useSiteLanguage } from '../../hooks/useSiteLanguage';
import { useBookingSearch } from '../../context/BookingSearchContext';
import HomePicture from './HomePicture';
import { useHomeBookingHandoff } from './useHomeBookingHandoff';
import {
  eyebrowClass,
  primaryCtaClass,
  secondaryCtaClass,
  sectionClass,
  textLinkClass,
  titleClass,
  wrapClass,
} from './homeStyles';

const STAYS = [
  {
    id: 'cabin',
    stayId: 'cabin',
    image: HOME_IMAGES.cabinExterior,
    imageClass: 'object-[center_65%]',
    path: '/cabin',
    facts: ['sleeps', 'location', 'connection', 'access'],
  },
  {
    id: 'valley',
    stayId: 'aframe',
    image: HOME_IMAGES.valleyAframes,
    imageClass: 'object-[center_70%]',
    path: '/valley',
    facts: ['sleeps', 'location', 'connection', 'access'],
  },
];

export default function HomeStayComparison() {
  const { t } = useTranslation('home');
  const { language } = useSiteLanguage();
  const { adults, children, babies } = useBookingSearch();
  const handoff = useHomeBookingHandoff();
  const partyTotal = Math.max(1, (adults || 0) + (children || 0) + (babies || 0));

  return (
    <section id="stays" className={`bg-[#F9F8F6] ${sectionClass}`} aria-labelledby="home-stays-title">
      <div className={wrapClass}>
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-5 lg:gap-10 mb-8 md:mb-14">
          <div className="max-w-3xl">
            <p className={`${eyebrowClass} mb-4`}>{t('stays.eyebrow')}</p>
            <h2 id="home-stays-title" className={titleClass}>{t('stays.title')}</h2>
          </div>
          <a href="#planner" className={`${textLinkClass} lg:mb-2`}>{t('stays.help')}</a>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-10">
          {STAYS.map((stay) => {
            const overCapacity = capacityExceeded(stay.stayId, partyTotal);
            return (
              <article
                key={stay.id}
                className="bg-white overflow-hidden flex flex-col min-w-0 shadow-[0_18px_40px_rgba(28,25,23,0.06)]"
              >
                <div className="relative aspect-[4/5] sm:aspect-[5/4] lg:aspect-[4/5] bg-stone-200">
                  <HomePicture
                    image={stay.image}
                    alt={t(`stays.${stay.id}.imageAlt`)}
                    sizes="(min-width: 1024px) 42vw, 100vw"
                    className={`absolute inset-0 h-full w-full object-cover ${stay.imageClass}`}
                  />
                  <p className="absolute top-4 left-4 bg-[#F9F8F6]/95 text-[#1c1917] text-xs font-semibold tracking-wide px-3 py-2">
                    {t(`stays.${stay.id}.price`)}
                  </p>
                </div>
                <div className="p-5 sm:p-8 lg:p-10 flex flex-col flex-1">
                  <p className={`${eyebrowClass} mb-3`}>{t(`stays.${stay.id}.place`)}</p>
                  <h3 className="font-serif text-3xl md:text-4xl lg:text-5xl text-[#1c1917] mb-4 tracking-tight">
                    {t(`stays.${stay.id}.name`)}
                  </h3>
                  <p className="text-stone-700 leading-relaxed mb-6 max-w-xl text-base md:text-lg">
                    {t(`stays.${stay.id}.body`)}
                  </p>
                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 mb-6">
                    {stay.facts.map((fact) => (
                      <div key={fact} className="border-t border-[#E5E5E0] pt-3">
                        <dt className="text-[11px] uppercase tracking-[0.16em] text-stone-500 mb-1">
                          {t(`stays.facts.${fact}`)}
                        </dt>
                        <dd className="text-sm text-[#1c1917] leading-snug">
                          {t(`stays.${stay.id}.facts.${fact}`)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  {overCapacity ? (
                    <p className="mb-6 text-sm text-stone-600 leading-relaxed" role="status">
                      {t(`stays.${stay.id}.capacityNote`, { count: partyTotal })}
                    </p>
                  ) : null}
                  <div className="mt-auto flex flex-col sm:flex-row gap-3">
                    <Link to={localizePath(stay.path, language)} className={primaryCtaClass}>
                      {t(`stays.${stay.id}.explore`)}
                    </Link>
                    <button
                      type="button"
                      className={secondaryCtaClass}
                      onClick={() => handoff(stay.stayId)}
                    >
                      {t('stays.checkDates')}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
        <p className="mt-6 text-sm text-stone-500 max-w-2xl">{t('stays.priceNote')}</p>
      </div>
    </section>
  );
}
