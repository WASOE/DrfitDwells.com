import { useTranslation } from 'react-i18next';
import { bodyClass, eyebrowClass, sectionClass, titleClass, wrapClass } from './homeStyles';

const BENEFITS = ['direct', 'hosts', 'arrival', 'gift'];

export default function HomeIntro() {
  const { t } = useTranslation('home');

  return (
    <section className={`bg-[#EFEADE] ${sectionClass}`} aria-labelledby="home-intro-title">
      <div className={wrapClass}>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-20 items-end">
          <div className="lg:col-span-7 max-w-3xl">
            <p className={`${eyebrowClass} mb-4`}>{t('intro.eyebrow')}</p>
            <h2 id="home-intro-title" className={titleClass}>
              {t('intro.title')}
            </h2>
          </div>
          <p className={`${bodyClass} lg:col-span-5`}>{t('intro.body')}</p>
        </div>

        <ul className="mt-10 md:mt-14 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 md:gap-8 border-t border-[#E0D8CC] pt-8 md:pt-10">
          {BENEFITS.map((key) => (
            <li key={key} className="max-w-xs">
              <h3 className="font-serif text-lg text-[#1c1917] mb-2">{t(`intro.benefits.${key}.title`)}</h3>
              <p className="text-sm text-stone-600 leading-relaxed">{t(`intro.benefits.${key}.body`)}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
