import { useTranslation } from 'react-i18next';
import { useBookingSearch } from '../../context/BookingSearchContext';
import { lightCtaClass, outlineLightCtaClass, wrapClass } from './homeStyles';

function scrollToId(id) {
  const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  document.getElementById(id)?.scrollIntoView({ behavior, block: 'start' });
}

export default function HomeFinalCta() {
  const { t } = useTranslation('home');
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
          <p className="mt-4 text-[15px] text-stone-300 leading-relaxed max-w-md">
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
          <a href="#planner" className={outlineLightCtaClass}>
            {t('final.choose')}
          </a>
        </div>
      </div>
    </section>
  );
}
