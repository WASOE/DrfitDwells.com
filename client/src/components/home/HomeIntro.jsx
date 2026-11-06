import { useTranslation } from 'react-i18next';
import { bodyClass, eyebrowClass, titleClass, wrapClass } from './homeStyles';

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.15,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

/** Thin elevations of the four stays. Decorative only. */
function StayOutlines() {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 hidden lg:block text-[#1c1917]/[0.22]" aria-hidden="true">
      <div className="mx-auto flex max-w-7xl items-end justify-end gap-6 px-6 xl:gap-8">
        <svg viewBox="0 0 72 56" className="h-12 w-16">
          <path {...stroke} d="M8 50V28L36 12l28 16v22H8" />
          <path {...stroke} d="M30 50V36h12v14M16 32h10v7H16M50 20V13h6v4" />
        </svg>
        <svg viewBox="0 0 72 56" className="h-12 w-16">
          <path {...stroke} d="M8 50 36 12l28 38H8" />
          <path {...stroke} d="M30 50V38h12v12" />
        </svg>
        <svg viewBox="0 0 84 56" className="h-12 w-[4.75rem]">
          <path {...stroke} d="M22 24h48v24H22zM28 30h28v12H28M8 48h22v5H8" />
        </svg>
        <svg viewBox="0 0 88 56" className="h-12 w-[5.25rem]">
          <path {...stroke} d="M8 50V32L36 16l28 16v18H8" />
          <path {...stroke} d="M14 36h44M14 42h28M18 50V40h10v10M34 50V38h12v12M64 46h16v4H64" />
        </svg>
      </div>
    </div>
  );
}

export default function HomeIntro() {
  const { t } = useTranslation('home');

  return (
    <section className="relative bg-[#F6F1E8] py-14 md:py-20 lg:py-24" aria-labelledby="home-intro-title">
      <StayOutlines />
      <div className={`${wrapClass} relative`}>
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
