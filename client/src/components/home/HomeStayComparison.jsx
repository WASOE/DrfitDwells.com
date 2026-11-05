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
    image: HOME_IMAGES.cabinInterior,
    imageClass: 'object-[center_55%]',
    path: '/cabin',
    facts: ['sleeps', 'location', 'connection', 'access'],
  },
  {
    id: 'valley',
    stayId: 'aframe',
    image: HOME_IMAGES.valleyAframesSummer,
    imageClass: 'object-[center_72%]',
    path: '/valley',
    facts: ['sleeps', 'location', 'connection', 'access'],
  },
];

function StayCard({ stay, t, language, partyTotal, handoff }) {
  const overCapacity = capacityExceeded(stay.stayId, partyTotal);

  return (
    <article className="bg-white border border-[#E4DFD5] overflow-hidden flex flex-col min-w-0 shadow-[0_4px_17px_rgba(20,42,25,0.06)] h-full">
      <div className="relative h-[200px] sm:h-[220px] lg:h-[240px] bg-stone-200 shrink-0">
        <HomePicture
          image={stay.image}
          alt={t(`stays.${stay.id}.imageAlt`)}
          sizes="(min-width: 1024px) 38vw, 100vw"
          className={`absolute inset-0 h-full w-full object-cover ${stay.imageClass}`}
        />
        <p className="absolute top-3 left-3 bg-[#F9F8F6]/95 text-[#1c1917] text-[11px] font-semibold tracking-wide px-2.5 py-1.5">
          {t(`stays.${stay.id}.price`)}
        </p>
      </div>
      <div className="p-4 sm:p-5 lg:p-6 flex flex-col flex-1 min-h-0">
        <p className={`${eyebrowClass} mb-2`}>{t(`stays.${stay.id}.place`)}</p>
        <h3 className="font-serif text-2xl sm:text-3xl text-[#1c1917] mb-2 tracking-tight">
          {t(`stays.${stay.id}.name`)}
        </h3>
        <p className="text-stone-700 leading-snug mb-4 text-sm sm:text-[15px] max-w-xl">
          {t(`stays.${stay.id}.body`)}
        </p>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 mb-4">
          {stay.facts.map((fact) => (
            <div key={fact} className="border-t border-[#E5E5E0] pt-2">
              <dt className="text-[10px] uppercase tracking-[0.14em] text-stone-500 mb-0.5">
                {t(`stays.facts.${fact}`)}
              </dt>
              <dd className="text-xs sm:text-sm text-[#1c1917] leading-snug">
                {t(`stays.${stay.id}.facts.${fact}`)}
              </dd>
            </div>
          ))}
        </dl>
        {overCapacity ? (
          <p className="mb-3 text-xs text-stone-600 leading-relaxed" role="status">
            {t(`stays.${stay.id}.capacityNote`, { count: partyTotal })}
          </p>
        ) : null}
        <div className="mt-auto flex flex-col sm:flex-row gap-2.5">
          <Link to={localizePath(stay.path, language)} className={`${primaryCtaClass} min-h-11 text-[11px]`}>
            {t(`stays.${stay.id}.explore`)}
          </Link>
          <button
            type="button"
            className={`${secondaryCtaClass} min-h-11 text-[11px]`}
            onClick={() => handoff(stay.stayId)}
          >
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
    <section id="stays" className={`bg-[#F9F8F6] ${sectionClass}`} aria-labelledby="home-stays-title">
      <div className={wrapClass}>
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 lg:gap-10 mb-6 md:mb-8">
          <div className="max-w-3xl">
            <p className={`${eyebrowClass} mb-3`}>{t('stays.eyebrow')}</p>
            <h2 id="home-stays-title" className={`${titleClass} text-3xl sm:text-4xl md:text-5xl`}>
              {t('stays.title')}
            </h2>
          </div>
          <a href="#planner" className={`${textLinkClass} lg:mb-1`}>{t('stays.help')}</a>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] gap-5 lg:gap-4 xl:gap-6 items-stretch">
          <StayCard
            stay={cabin}
            t={t}
            language={language}
            partyTotal={partyTotal}
            handoff={handoff}
          />
          <div
            className="flex items-center justify-center py-1 lg:py-0"
            aria-hidden="true"
          >
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[#D7D2C7] bg-white font-serif text-sm tracking-[0.12em] text-[#1c1917]">
              {t('stays.or')}
            </span>
          </div>
          <StayCard
            stay={valley}
            t={t}
            language={language}
            partyTotal={partyTotal}
            handoff={handoff}
          />
        </div>
        <p className="mt-5 text-sm text-stone-500 max-w-2xl">{t('stays.priceNote')}</p>
      </div>
    </section>
  );
}
