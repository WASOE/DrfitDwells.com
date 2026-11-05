import { useTranslation } from 'react-i18next';
import { bodyClass, titleClass, wrapClass } from './homeStyles';

export default function HomeOrient() {
  const { t } = useTranslation('home');

  return (
    <section className="bg-[#F6F1E8] py-8 md:py-10 border-b border-[#E6E0D4]" aria-labelledby="home-orient-title">
      <div className={`${wrapClass} max-w-4xl`}>
        <h1 id="home-orient-title" className={`${titleClass} text-3xl sm:text-4xl lg:text-[2.6rem]`}>
          {t('orient.title')}
        </h1>
        <p className={`${bodyClass} mt-4`}>{t('orient.body')}</p>
      </div>
    </section>
  );
}
