import { useTranslation } from 'react-i18next';
import { bodyClass, eyebrowClass, titleClass, wrapClass } from './homeStyles';

export default function HomeIntro() {
  const { t } = useTranslation('home');

  return (
    <section className="bg-[#F6F1E8] py-10 md:py-14 lg:py-16" aria-labelledby="home-intro-title">
      <div className={wrapClass}>
        <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_0.85fr] gap-6 lg:gap-14 items-end">
          <div className="max-w-3xl">
            <p className={`${eyebrowClass} mb-3`}>{t('intro.eyebrow')}</p>
            <h2 id="home-intro-title" className={titleClass}>
              {t('intro.title')}
            </h2>
          </div>
          <p className={`${bodyClass} max-w-md`}>{t('intro.body')}</p>
        </div>
      </div>
    </section>
  );
}
