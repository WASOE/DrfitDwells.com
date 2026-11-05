import { useTranslation } from 'react-i18next';
import { bodyClass, eyebrowClass, titleClass, wrapClass } from './homeStyles';

export default function HomeIntro() {
  const { t } = useTranslation('home');

  return (
    <section className="bg-[#F6F1E8] py-14 md:py-20 lg:py-24" aria-labelledby="home-intro-title">
      <div className={wrapClass}>
        <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_0.8fr] gap-8 lg:gap-16 xl:gap-20 items-end">
          <div className="max-w-3xl">
            <p className={`${eyebrowClass} mb-4`}>{t('intro.eyebrow')}</p>
            <h2 id="home-intro-title" className={titleClass}>
              {t('intro.title')}
            </h2>
          </div>
          <p className={`${bodyClass} max-w-md lg:pb-1`}>{t('intro.body')}</p>
        </div>
      </div>
    </section>
  );
}
