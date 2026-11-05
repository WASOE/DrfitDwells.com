import { useTranslation } from 'react-i18next';
import { useBookingSearch } from '../../context/BookingSearchContext';
import { sectionClass, wrapClass } from './homeStyles';

function scrollToId(id) {
  const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  document.getElementById(id)?.scrollIntoView({ behavior, block: 'start' });
}

export default function HomeFinalCta() {
  const { t } = useTranslation('home');
  const { openModal } = useBookingSearch();

  return (
    <section className={`bg-[#1c1917] text-[#F1ECE2] ${sectionClass}`} aria-labelledby="home-final-title">
      <div className={`${wrapClass} grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-16 items-center`}>
        <div className="max-w-xl">
          <p className="text-[11px] uppercase tracking-[0.22em] text-stone-300 mb-4">{t('final.eyebrow')}</p>
          <h2 id="home-final-title" className="font-serif text-3xl sm:text-4xl md:text-5xl tracking-tight leading-[1.08]">
            {t('final.title')}
          </h2>
          <p className="mt-5 text-base md:text-lg text-stone-300 leading-relaxed max-w-2xl">{t('final.body')}</p>
        </div>
        <div className="flex flex-col sm:flex-row lg:justify-end gap-3 max-w-xl">
          <button
            type="button"
            className="inline-flex w-full sm:w-auto items-center justify-center min-h-12 px-6 py-3 rounded-full bg-[#F1ECE2] text-[#1c1917] text-xs font-semibold uppercase tracking-[0.18em] hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F1ECE2] focus-visible:ring-offset-2 focus-visible:ring-offset-[#1c1917]"
            onClick={() => {
              scrollToId('booking');
              openModal();
            }}
          >
            {t('final.dates')}
          </button>
          <a
            href="#planner"
            className="inline-flex w-full sm:w-auto items-center justify-center min-h-12 px-6 py-3 rounded-full border border-[#F1ECE2] text-[#F1ECE2] text-xs font-semibold uppercase tracking-[0.18em] hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F1ECE2] focus-visible:ring-offset-2 focus-visible:ring-offset-[#1c1917]"
          >
            {t('final.choose')}
          </a>
        </div>
      </div>
    </section>
  );
}
