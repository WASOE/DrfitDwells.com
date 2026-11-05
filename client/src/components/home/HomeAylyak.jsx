import { useTranslation } from 'react-i18next';
import { eyebrowClass, wrapClass } from './homeStyles';

export default function HomeAylyak() {
  const { t } = useTranslation('home');

  return (
    <section
      className="bg-[#FFFDF8] border-t border-[#EBE7DF] py-16 md:py-20 lg:py-24"
      aria-labelledby="home-aylyak-title"
    >
      <div className={`${wrapClass} text-center max-w-3xl`}>
        <p className={`${eyebrowClass} mb-4`}>{t('philosophy.eyebrow')}</p>
        <h2
          id="home-aylyak-title"
          className="font-serif text-5xl sm:text-6xl md:text-[4.4rem] text-[#1c1917] tracking-tight"
        >
          {t('philosophy.word')}
        </h2>
        <p className="mt-3 text-stone-500 text-sm italic">
          {t('philosophy.phonetic')}
          <span className="mx-2 not-italic">·</span>
          {t('philosophy.type')}
        </p>
        <p className="mt-7 font-serif text-lg md:text-xl text-stone-700 leading-relaxed max-w-2xl mx-auto">
          {t('philosophy.line')}
        </p>
      </div>
    </section>
  );
}
