import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { localizePath } from '../../utils/localizedRoutes';
import { useSiteLanguage } from '../../hooks/useSiteLanguage';
import { bodyClass, eyebrowClass, textLinkClass, titleClass, wrapClass } from './homeStyles';

export default function HomeAccess() {
  const { t } = useTranslation('home');
  const { language } = useSiteLanguage();

  return (
    <section id="access" className="bg-[#FFFDF8] py-14 md:py-20 lg:py-24" aria-labelledby="home-access-title">
      <div className={`${wrapClass} grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16`}>
        <div className="max-w-xl">
          <p className={`${eyebrowClass} mb-4`}>{t('access.eyebrow')}</p>
          <h2 id="home-access-title" className={titleClass}>{t('access.title')}</h2>
          <p className={`${bodyClass} mt-4`}>{t('access.body')}</p>
          <Link to={localizePath('/guides/the-valley', language)} className={`${textLinkClass} mt-6`}>
            {t('access.guide')}
          </Link>
        </div>
        <ul className="space-y-5">
          {['bansko', 'route', 'valleyLast', 'cabinLast'].map((key) => (
            <li key={key} className="border-t border-[#E5E5E0] pt-4">
              <h3 className="text-sm font-semibold text-[#1c1917] mb-1">{t(`access.items.${key}.title`)}</h3>
              <p className="text-[15px] text-stone-800 leading-relaxed">{t(`access.items.${key}.body`)}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
