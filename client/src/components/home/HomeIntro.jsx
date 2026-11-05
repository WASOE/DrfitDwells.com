import { useTranslation } from 'react-i18next';
import { bodyClass, eyebrowClass, titleClass, wrapClass } from './homeStyles';

export default function HomeIntro() {
  const { t } = useTranslation('home');

  return (
    <section className={`bg-[#EFEADE] py-10 md:py-14 lg:py-16`} aria-labelledby="home-intro-title">
      <div className={wrapClass}>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-16 items-end max-w-5xl">
          <div className="lg:col-span-7">
            <p className={`${eyebrowClass} mb-3`}>{t('intro.eyebrow')}</p>
            <h2 id="home-intro-title" className={`${titleClass} text-3xl sm:text-4xl md:text-[2.75rem]`}>
              {t('intro.title')}
            </h2>
          </div>
          <p className={`${bodyClass} lg:col-span-5 text-base md:text-[1.05rem]`}>{t('intro.body')}</p>
        </div>
      </div>
    </section>
  );
}
