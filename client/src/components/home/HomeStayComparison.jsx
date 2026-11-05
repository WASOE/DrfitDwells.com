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
  textLinkClass,
  titleClass,
  wrapClass,
} from './homeStyles';

const STAYS = [
  {
    id: 'cabin',
    stayId: 'cabin',
    image: HOME_IMAGES.cabinExterior,
    imageClass: 'object-[center_45%]',
    path: '/cabin',
    facts: ['sleeps', 'location', 'connection', 'access'],
  },
  {
    id: 'valley',
    stayId: 'aframe',
    image: HOME_IMAGES.valleyAframes,
    imageClass: 'object-[center_62%]',
    path: '/valley',
    facts: ['sleeps', 'location', 'connection', 'access'],
  },
];

function StayCard({ stay, t, language, partyTotal, handoff }) {
  const overCapacity = capacityExceeded(stay.stayId, partyTotal);

  return (
    <article className="bg-white border border-[#E4DFD5] overflow-hidden flex flex-col min-w-0 shadow-[0_8px_28px_rgba(28,25,23,0.08)] h-full">
      <div className="relative h-[220px] sm:h-[260px] lg:h-[300px] bg-stone-200 shrink-0 overflow-hidden">
        <HomePicture
          image={stay.image}
          alt={t(`stays.${stay.id}.imageAlt`)}
          sizes="(min-width: 1024px) 42vw, 100vw"
          className={`absolute inset-0 h-full w-full object-cover transition-transform duration-700 ease-out hover:scale-[1.03] ${stay.imageClass}`}
        />
        <p className="absolute top-4 left-5 bg-[#FFFCF2] text-[#1c1917] text-xs font-bold tracking-wide px-3.5 py-2 rounded-full">
          {t(`stays.${stay.id}.price`)}
        </p>
      </div>
      <div className="p-6 sm:p-8 lg:px-9 lg:py-9 flex flex-col flex-1">
        <p className={`${eyebrowClass} mb-2`}>{t(`stays.${stay.id}.place`)}</p>
        <h3 className="font-serif text-[2rem] sm:text-[2.25rem] lg:text-[2.45rem] text-[#1c1917] mb-3 tracking-tight leading-none">
          {t(`stays.${stay.id}.name`)}
        </h3>
        <p className="text-[15px] md:text-base text-stone-600 leading-relaxed mb-7 max-w-md">
          {t(`stays.${stay.id}.body`)}
        </p>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-5 mb-7">
          {stay.facts.map((fact) => (
            <div key={fact} className="border-t border-[#E5E5E0] pt-3">
              <dt className="text-[11px] uppercase tracking-[0.14em] text-stone-500 mb-1.5">
                {t(`stays.facts.${fact}`)}
              </dt>
              <dd className="text-sm text-[#1c1917] leading-snug">
                {t(`stays.${stay.id}.facts.${fact}`)}
              </dd>
            </div>
          ))}
        </dl>
        {overCapacity ? (
          <p className="mb-5 text-sm text-stone-600 leading-relaxed" role="status">
            {t(`stays.${stay.id}.capacityNote`, { count: partyTotal })}
          </p>
        ) : null}
        <div className="mt-auto flex flex-col sm:flex-row gap-3">
          <Link to={localizePath(stay.path, language)} className={primaryCtaClass}>
            {t(`stays.${stay.id}.explore`)}
          </Link>
          <button type="button" className={secondaryCtaClass} onClick={() => handoff(stay.stayId)}>
            {t('stays.checkDates')}
          </button>
        </div>
      </div>
    </article>
  );
}

export default function HomeStayComparison() {
  const { t } = useTranslation('home');
  const { language } = useSiteLanguage();
  const { adults, children, babies } = useBookingSearch();
  const handoff = useHomeBookingHandoff();
  const partyTotal = Math.max(1, (adults || 0) + (children || 0) + (babies || 0));
  const [cabin, valley] = STAYS;

  return (
    <section id="stays" className="bg-[#F9F8F6] py-14 md:py-20 lg:py-[6.5rem]" aria-labelledby="home-stays-title">
      <div className={wrapClass}>
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6 mb-10 md:mb-12">
          <div className="max-w-3xl">
            <p className={`${eyebrowClass} mb-4`}>{t('stays.eyebrow')}</p>
            <h2 id="home-stays-title" className={titleClass}>{t('stays.title')}</h2>
          </div>
          <a href="#planner" className={`${textLinkClass} lg:mb-2`}>{t('stays.help')}</a>
        </div>

        <div className="relative grid grid-cols-1 lg:grid-cols-2 gap-7 lg:gap-8 items-stretch">
          <StayCard stay={cabin} t={t} language={language} partyTotal={partyTotal} handoff={handoff} />

          <div className="flex lg:hidden items-center justify-center py-2" aria-hidden="true">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-[#D7D2C7] bg-white font-serif text-sm tracking-[0.14em] text-[#1c1917] shadow-sm">
              {t('stays.or')}
            </span>
          </div>

          <div
            className="hidden lg:flex absolute left-1/2 top-[38%] z-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
            aria-hidden="true"
          >
            <span className="inline-flex h-14 w-14 items-center justify-center rounded-full border border-[#D7D2C7] bg-white font-serif text-sm tracking-[0.14em] text-[#1c1917] shadow-[0_8px_24px_rgba(28,25,23,0.12)]">
              {t('stays.or')}
            </span>
          </div>

          <StayCard stay={valley} t={t} language={language} partyTotal={partyTotal} handoff={handoff} />
        </div>

        <p className="mt-7 text-sm text-stone-500 max-w-2xl">{t('stays.priceNote')}</p>
      </div>
    </section>
  );
}
