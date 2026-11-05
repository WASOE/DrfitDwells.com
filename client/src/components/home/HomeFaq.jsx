import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { localizePath } from '../../utils/localizedRoutes';
import { useSiteLanguage } from '../../hooks/useSiteLanguage';
import { bodyClass, eyebrowClass, sectionClass, textLinkClass, titleClass, wrapClass } from './homeStyles';

export const HOME_FAQ_KEYS = ['where', 'drive', 'wifi', 'group', 'times', 'gift'];

export default function HomeFaq() {
  const { t } = useTranslation('home');
  const { language } = useSiteLanguage();
  const [openKey, setOpenKey] = useState(HOME_FAQ_KEYS[0]);

  return (
    <section id="faq" className={`bg-white ${sectionClass}`} aria-labelledby="home-faq-title">
      <div className={`${wrapClass} grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-16`}>
        <div className="lg:col-span-5 max-w-xl">
          <p className={`${eyebrowClass} mb-4`}>{t('faq.eyebrow')}</p>
          <h2 id="home-faq-title" className={titleClass}>{t('faq.title')}</h2>
          <p className={`${bodyClass} mt-5`}>{t('faq.body')}</p>
          <div className="mt-6 flex flex-col items-start gap-3">
            <Link to={localizePath('/cabin/faq', language)} className={textLinkClass}>{t('faq.moreCabin')}</Link>
            <Link to={localizePath('/guides/the-valley', language)} className={textLinkClass}>{t('faq.moreValley')}</Link>
          </div>
        </div>
        <div className="lg:col-span-7 border-t border-[#E5E5E0]">
          {HOME_FAQ_KEYS.map((key) => {
            const open = openKey === key;
            const panelId = `home-faq-${key}`;
            return (
              <div key={key} className="border-b border-[#E5E5E0]">
                <h3>
                  <button
                    type="button"
                    className="w-full flex items-start justify-between gap-4 py-4 text-left font-medium text-[#1c1917] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1c1917]"
                    aria-expanded={open}
                    aria-controls={panelId}
                    onClick={() => setOpenKey(open ? '' : key)}
                  >
                    <span>{t(`faq.items.${key}.q`)}</span>
                    <span aria-hidden="true" className="font-serif text-xl leading-none">{open ? '−' : '+'}</span>
                  </button>
                </h3>
                <div id={panelId} hidden={!open} className="pb-4 pr-8 text-sm md:text-base text-stone-700 leading-relaxed">
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
