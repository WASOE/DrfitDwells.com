import { useTranslation } from 'react-i18next';
import { bodyClass, eyebrowClass, titleClass, wrapClass } from './homeStyles';

const line = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  vectorEffect: 'non-scaling-stroke',
};

/**
 * Two separate elevations: The Cabin on its own ground,
 * and the Valley stays (A-frame, Luxury Cabin, Stone House) on theirs.
 */
function StayOutlines() {
  return (
    <div className="pointer-events-none mt-10 hidden lg:mt-14 lg:block" aria-hidden="true">
      <svg viewBox="0 0 1400 150" className="h-[132px] w-full text-[#1c1917]/[0.58]">
        <g {...line}>
          <path d="M24 142h220" />
          <path d="M58 90V142h128V90" />
          <path d="M40 94 122 36l82 58" />
          <path d="M164 66V44h16v28" />
          <path d="M108 142V108h36v34" />
          <path d="M72 104h24v20H72zM80 104v20M72 114h24" />
          <path d="M154 104h24v20h-24zM162 104v20M154 114h24" />
        </g>
        <g {...line}>
          <path d="M760 142h600" />
          <path d="M788 142 856 34l68 108" />
          <path d="M836 142V110h40v32" />
          <path d="M842 58h28v18h-28zM856 58v18M842 67h28" />
          <path d="M978 72h168M978 64h168" />
          <path d="M986 72v62h152V72" />
          <path d="M1006 86h112v34h-112zM1062 86v34" />
          <path d="M950 134h36M950 142h52v-8" />
          <path d="M1176 96v46h168V96" />
          <path d="M1158 100 1260 40l102 60" />
          <path d="M1198 142v-32h32v32" />
          <path d="M1262 108h40v24h-40zM1282 108v24M1262 120h40" />
          <path d="M1180 114h14M1234 114h24M1306 114h30M1180 126h14M1234 126h24M1306 126h30" />
          <path d="M1344 124h22v18h-22" />
          <path d="M1192 86l30-18M1204 94l26-15" />
        </g>
      </svg>
    </div>
  );
}

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
        <StayOutlines />
      </div>
    </section>
  );
}
