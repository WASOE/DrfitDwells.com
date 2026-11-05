import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useBookingSearch } from '../../context/BookingSearchContext';
import { localizePath } from '../../utils/localizedRoutes';
import { useSiteLanguage } from '../../hooks/useSiteLanguage';
import { lightCtaClass, outlineLightCtaClass, wrapClass } from './homeStyles';

function scrollToId(id) {
  const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  document.getElementById(id)?.scrollIntoView({ behavior, block: 'start' });
}

export default function HomeFinalCta() {
  const { t } = useTranslation('home');
  const { language } = useSiteLanguage();
  const { openModal } = useBookingSearch();

  return (
    <section
      className="bg-[#1c1917] text-[#F1ECE2] py-14 md:py-20 lg:py-24"
      aria-labelledby="home-final-title"
    >
      <div className={`${wrapClass} grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-16 items-center`}>
        <div className="max-w-xl">
          <p className="text-[11px] uppercase tracking-[0.22em] text-stone-300 mb-4">
            {t('final.eyebrow')}
          </p>
          <h2
            id="home-final-title"
            className="font-serif text-3xl sm:text-4xl md:text-5xl lg:text-[3.4rem] tracking-tight leading-[1.06]"
          >
            {t('final.title')}
          </h2>
          <p className="mt-5 text-base md:text-lg text-stone-300 leading-relaxed max-w-2xl">
            {t('final.body')}
          </p>
        </div>
        <div className="flex flex-col sm:flex-row lg:justify-end gap-3 max-w-xl">
          <button
            type="button"
            className={lightCtaClass}
            onClick={() => {
              scrollToId('booking');
              openModal();
            }}
          >
            {t('final.dates')}
          </button>
          <Link to={localizePath('/gift-vouchers', language)} className={outlineLightCtaClass}>
            {t('final.gift')}
          </Link>
        </div>
      </div>
    </section>
  );
}
