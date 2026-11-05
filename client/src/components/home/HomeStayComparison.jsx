import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { HOME_IMAGES } from '../../data/homepageMedia';
import { localizePath } from '../../utils/localizedRoutes';
import { useSiteLanguage } from '../../hooks/useSiteLanguage';
import { useBookingSearch } from '../../context/BookingSearchContext';
import HomePicture from './HomePicture';
import { useHomeBookingHandoff } from './useHomeBookingHandoff';
import { eyebrowClass, primaryCtaClass, secondaryCtaClass, sectionClass, textLinkClass, titleClass, wrapClass } from './homeStyles';

const STAYS = [
  {
    id: 'cabin',
    image: HOME_IMAGES.cabinInterior,
    path: '/cabin',
    party: 2,
    facts: ['sleeps', 'location', 'connection', 'access'],
  },
  {
    id: 'valley',
    image: HOME_IMAGES.valleyAframes,
    path: '/valley',
    party: 2,
    facts: ['sleeps', 'location', 'connection', 'access'],
  },
];

export default function HomeStayComparison() {
  const { t } = useTranslation('home');
  const { language } = useSiteLanguage();
  const { adults } = useBookingSearch();
  const handoff = useHomeBookingHandoff();

  return (
    <section id="stays" className={`bg-[#F9F9F7] ${sectionClass}`} aria-labelledby="home-stays-title">
      <div className={wrapClass}>
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6 mb-8 md:mb-12">
          <div className="max-w-3xl">
            <p className={`${eyebrowClass} mb-4`}>{t('stays.eyebrow')}</p>
            <h2 id="home-stays-title" className={titleClass}>{t('stays.title')}</h2>
          </div>
          <a href="#planner" className={textLinkClass}>{t('stays.help')}</a>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8">
          {STAYS.map((stay) => (
            <article key={stay.id} className="bg-white border border-[#E5E5E0] overflow-hidden flex flex-col min-w-0">
              <div className="relative aspect-[4/5] sm:aspect-[4/3] bg-stone-200">
                <HomePicture
                  image={stay.image}
                  alt={t(`stays.${stay.id}.imageAlt`)}
                  sizes="(min-width: 1024px) 40vw, 100vw"
                  className="absolute inset-0 h-full w-full object-cover"
                />
                <p className="absolute top-4 left-4 bg-[#F9F8F6]/95 text-[#1c1917] text-xs font-semibold tracking-wide px-3 py-2">
                  {t(`stays.${stay.id}.price`)}
                </p>
              </div>
              <div className="p-5 sm:p-8 flex flex-col flex-1">
                <p className={`${eyebrowClass} mb-3`}>{t(`stays.${stay.id}.place`)}</p>
                <h3 className="font-serif text-3xl md:text-4xl text-[#1c1917] mb-4">{t(`stays.${stay.id}.name`)}</h3>
                <p className="text-stone-700 leading-relaxed mb-6 max-w-xl">{t(`stays.${stay.id}.body`)}</p>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
                  {stay.facts.map((fact) => (
                    <div key={fact} className="border-t border-[#E5E5E0] pt-3">
                      <dt className="text-[11px] uppercase tracking-[0.16em] text-stone-500 mb-1">
                        {t(`stays.facts.${fact}`)}
                      </dt>
                      <dd className="text-sm text-[#1c1917] leading-snug">{t(`stays.${stay.id}.facts.${fact}`)}</dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-auto flex flex-col sm:flex-row gap-3">
                  <Link to={localizePath(stay.path, language)} className={primaryCtaClass}>
                    {t(`stays.${stay.id}.explore`)}
                  </Link>
                  <button type="button" className={secondaryCtaClass} onClick={() => {
                    const guests = stay.id === 'cabin'
                      ? Math.min(2, Math.max(1, adults || stay.party))
                      : Math.max(1, adults || stay.party);
                    handoff(stay.id === 'cabin' ? 'cabin' : 'aframe', guests);
                  }}>
                    {t('stays.checkDates')}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
        <p className="mt-6 text-sm text-stone-500 max-w-2xl">{t('stays.priceNote')}</p>
      </div>
    </section>
  );
}
