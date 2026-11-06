import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { localizePath } from '../../utils/localizedRoutes';
import { useSiteLanguage } from '../../hooks/useSiteLanguage';
import { bodyClass, eyebrowClass, textLinkClass, titleClass, wrapClass } from './homeStyles';

export const HOME_FAQ_KEYS = ['valley', 'winter', 'sofia', 'wifi', 'group', 'gift'];

export default function HomeFaq() {
  const { t } = useTranslation('home');
  const { language } = useSiteLanguage();
  const [openKey, setOpenKey] = useState(HOME_FAQ_KEYS[0]);

  return (
    <section id="faq" className="bg-[#F3EFE6] py-14 md:py-20 lg:py-[6rem]" aria-labelledby="home-faq-title">
      <div className={`${wrapClass} grid grid-cols-1 lg:grid-cols-[0.8fr_1.2fr] gap-10 lg:gap-16 xl:gap-24`}>
        <div className="max-w-xl">
          <p className={`${eyebrowClass} mb-4`}>{t('faq.eyebrow')}</p>
          <h2 id="home-faq-title" className={titleClass}>{t('faq.title')}</h2>
          <p className={`${bodyClass} mt-5`}>{t('faq.body')}</p>
          <div className="mt-6 flex flex-col items-start gap-3">
            <Link to={localizePath('/cabin/faq', language)} className={textLinkClass}>
              {t('faq.moreCabin')}
            </Link>
            <Link to={localizePath('/guides/the-valley', language)} className={textLinkClass}>
              {t('faq.moreValley')}
            </Link>
          </div>
        </div>
        <div className="border-t border-[#D3D3CB]">
          {HOME_FAQ_KEYS.map((key) => {
            const open = openKey === key;
            const panelId = `home-faq-${key}`;
            return (
              <div key={key} className="border-b border-[#D3D3CB]">
                <h3>
                  <button
                    type="button"
                    className="w-full flex items-start justify-between gap-4 py-5 text-left font-semibold text-[#1c1917] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1c1917]"
                    aria-expanded={open}
                    aria-controls={panelId}
                    onClick={() => setOpenKey(open ? '' : key)}
                  >
                    <span className="text-[15px] leading-snug">{t(`faq.items.${key}.q`)}</span>
                    <span
                      aria-hidden="true"
                      className={`font-serif text-2xl leading-none text-stone-500 transition-transform ${open ? 'rotate-45' : ''}`}
                    >
                      +
                    </span>
                  </button>
                </h3>
                <div
                  id={panelId}
                  hidden={!open}
                  className="pb-5 pr-8 text-base text-[#1c1917] leading-relaxed max-w-2xl"
                >
                  {t(`faq.items.${key}.a`)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
