import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext.jsx';
import { useSiteLanguage } from '../hooks/useSiteLanguage';
import { localizePath } from '../utils/localizedRoutes';
import { scrollToPaidTrafficStays } from '../utils/paidTrafficRoutes';
import { BRANDING, BRANDING_DIMENSIONS } from '../config/brandingAssets';

export default function PaidTrafficHeader() {
  const { t } = useTranslation('seo');
  const { t: tn } = useTranslation('nav');
  const { setLanguage } = useLanguage();
  const { language } = useSiteLanguage();

  const homePath = localizePath('/', language);
  const chooseStayLabel = t('paidStaysBulgaria.cta.chooseStay');

  return (
    <header className="fixed top-0 w-full z-50 px-4 sm:px-6 py-4 md:py-5 bg-white/95 backdrop-blur-md border-b border-black/[0.06] shadow-sm">
      <div className="max-w-7xl mx-auto flex justify-between items-center gap-3">
        <Link to={homePath} className="flex-shrink-0" aria-label="Drift & Dwells">
          <picture>
            <source srcSet={BRANDING.headerDarkWebp} type="image/webp" />
            <img
              src={BRANDING.headerDarkPng}
              alt="Drift & Dwells"
              width={BRANDING_DIMENSIONS.header.width}
              height={BRANDING_DIMENSIONS.header.height}
              className="h-7 sm:h-8 w-auto"
            />
          </picture>
        </Link>

        <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
          <div className="flex items-center gap-1 text-[10px] sm:text-[11px] uppercase tracking-[0.2em]">
            <button
              type="button"
              onClick={() => setLanguage('en')}
              className={`px-2 py-1 rounded-full touch-manipulation min-h-[44px] sm:min-h-0 flex items-center ${
                language === 'en'
                  ? 'bg-stone-900 text-[#F1ECE2]'
                  : 'bg-transparent text-stone-500'
              }`}
            >
              {tn('language.en')}
            </button>
            <button
              type="button"
              onClick={() => setLanguage('bg')}
              className={`px-2 py-1 rounded-full touch-manipulation min-h-[44px] sm:min-h-0 flex items-center ${
                language === 'bg'
                  ? 'bg-stone-900 text-[#F1ECE2]'
                  : 'bg-transparent text-stone-500'
              }`}
            >
              {tn('language.bg')}
            </button>
          </div>
          <button
            type="button"
            onClick={scrollToPaidTrafficStays}
            className="hidden sm:inline-flex items-center justify-center bg-[#F1ECE2] text-stone-900 px-4 py-2.5 rounded-full font-bold uppercase tracking-[0.22em] text-[10px] hover:scale-[1.02] transition-transform shadow-sm active:scale-95 min-h-[44px] touch-manipulation"
          >
            {chooseStayLabel}
          </button>
        </div>
      </div>
    </header>
  );
}
