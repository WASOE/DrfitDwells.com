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
      className="bg-[#1c1917] text-[#F1ECE2] py-16 md:py-20 lg:py-[4.7rem]"
      aria-labelledby="home-final-title"
    >
      <div className={`${wrapClass} grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-8 lg:gap-10 items-center`}>
        <div className="max-w-xl">
          <p className="text-[11px] uppercase tracking-[0.22em] text-stone-300 mb-3">
            {t('final.eyebrow')}
          </p>
          <h2
            id="home-final-title"
            className="font-serif text-4xl sm:text-5xl md:text-[3.5rem] tracking-tight leading-[1.05]"
          >
            {t('final.title')}
          </h2>
          <p className="mt-4 text-[17px] text-stone-300 leading-relaxed max-w-md">
            {t('final.body')}
          </p>
        </div>
        <div className="flex flex-col gap-4 max-w-xl lg:justify-end">
          <div className="flex flex-col sm:flex-row lg:justify-end gap-3">
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
            <a href="#planner" className={outlineLightCtaClass}>
              {t('final.choose')}
            </a>
          </div>
          <div className="flex flex-col sm:flex-row lg:justify-end gap-3 sm:gap-5 text-sm">
            <a href="#groups" className="text-stone-300 underline underline-offset-4 hover:text-white">
              {t('final.private')}
            </a>
            <Link
              to={localizePath('/gift-vouchers', language)}
              className="text-stone-300 underline underline-offset-4 hover:text-white"
            >
              {t('final.gift')}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
