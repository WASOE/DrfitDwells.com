import { useTranslation } from 'react-i18next';
import { eyebrowClass, wrapClass } from './homeStyles';

export default function HomeAylyak() {
  const { t } = useTranslation('home');

  return (
    <section
      className={`bg-[#FFFDF8] border-y border-[#EBE7DF] py-12 md:py-16 lg:py-20`}
      aria-labelledby="home-aylyak-title"
    >
      <div className={`${wrapClass} text-center max-w-2xl`}>
        <p className={`${eyebrowClass} mb-3`}>{t('philosophy.eyebrow')}</p>
        <h2
          id="home-aylyak-title"
          className="font-serif text-5xl sm:text-6xl text-[#1c1917] tracking-tight"
        >
          {t('philosophy.word')}
        </h2>
        <p className="mt-3 text-stone-500 text-sm">
          <span className="italic">{t('philosophy.phonetic')}</span>
          <span className="mx-2">·</span>
          <span className="italic">{t('philosophy.type')}</span>
        </p>
        <p className="mt-6 font-serif text-lg md:text-xl text-stone-800 leading-relaxed">
          {t('philosophy.line')}
        </p>
      </div>
    </section>
  );
}
