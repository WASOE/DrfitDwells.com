import { useTranslation } from 'react-i18next';
import { wrapClass } from './homeStyles';

export default function HomeAylyak() {
  const { t } = useTranslation('home');

  return (
    <section
      className="relative overflow-hidden bg-[#1c1917] text-[#F1ECE2] py-20 md:py-28 lg:py-32"
      aria-labelledby="home-aylyak-title"
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            'radial-gradient(circle at 20% 20%, #F1ECE2 0.8px, transparent 1px), radial-gradient(circle at 80% 60%, #F1ECE2 0.8px, transparent 1px)',
          backgroundSize: '28px 28px',
        }}
        aria-hidden="true"
      />
      <div className={`relative ${wrapClass} max-w-4xl text-center`}>
        <p className="text-[11px] uppercase tracking-[0.22em] text-stone-400 mb-6">
          {t('philosophy.eyebrow')}
        </p>
        <h2
          id="home-aylyak-title"
          className="font-serif text-6xl sm:text-7xl md:text-[5.5rem] lg:text-[6.5rem] tracking-tight leading-none"
        >
          {t('philosophy.word')}
        </h2>
        <p className="mt-5 text-stone-400 text-sm md:text-base">
          {t('philosophy.phonetic')}
          <span className="mx-3 text-stone-600">·</span>
          {t('philosophy.type')}
        </p>
        <p className="mt-10 md:mt-12 font-serif text-xl sm:text-2xl md:text-[1.75rem] text-[#F1ECE2] leading-relaxed max-w-2xl mx-auto">
          {t('philosophy.line')}
        </p>
      </div>
    </section>
  );
}
