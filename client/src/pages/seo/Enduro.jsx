import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Seo from '../../components/Seo';
import HeroResponsivePicture from '../../components/HeroResponsivePicture';
import { getValleyHeroResponsive, HERO_LCP_PRELOAD_WIDTH } from '../../config/heroResponsive';
import { INSTAGRAM_URL } from '../../data/gmbLocations';
import { useLocalizedPath } from '../../hooks/useLocalizedPath';
import { buildHreflangAlternates } from '../../utils/localizedRoutes';
import '../../i18n/ns/seo';
import './seo-landing.css';

const PROMO_CODE = 'ENDURO';
const BOOK_PATH = '/stays/a-frame';
const BUYOUT_PATH = '/retreats/the-valley';
const LCP_PRELOAD_HREF = `/media/hero/valley-summer-night-${HERO_LCP_PRELOAD_WIDTH}w.avif`;
const HERO_FALLBACK_WEBP = `/media/hero/valley-summer-night-${HERO_LCP_PRELOAD_WIDTH}w.webp`;

/** Keep festival 3G srcset at/under the LCP preload width (no 1200/1920). */
function capHeroSrcSet(srcSet, maxWidth = HERO_LCP_PRELOAD_WIDTH) {
  return srcSet
    .split(',')
    .map((part) => part.trim())
    .filter((part) => {
      const match = part.match(/\s(\d+)w$/);
      return match && Number(match[1]) <= maxWidth;
    })
    .join(', ');
}

const PROOF_KEYS = ['one', 'two', 'three'];

export default function Enduro() {
  const { t } = useTranslation('seo');
  const lp = useLocalizedPath();
  const e = (key, opts) => t(`enduro.${key}`, opts);

  const hero = getValleyHeroResponsive('summer');
  const bookTo = {
    pathname: lp(BOOK_PATH),
    search: `?promoCode=${PROMO_CODE}`
  };
  const buyoutTo = lp(BUYOUT_PATH);
  const heroAlt = `${e('hero.titleSmall')} ${e('hero.title')}`;

  return (
    <>
      <Seo
        title={e('metaTitle')}
        description={e('metaDescription')}
        canonicalPath="/enduro"
        ogImage={HERO_FALLBACK_WEBP}
        preloadImages={[
          { href: LCP_PRELOAD_HREF, type: 'image/avif', fetchPriority: 'high' }
        ]}
        hreflangAlternates={buildHreflangAlternates('/enduro')}
      />

      <div className="seo-landing pb-0">
        <section className="relative min-h-[100svh] w-full overflow-hidden bg-stone-900">
          <div className="absolute inset-0 [&_picture]:absolute [&_picture]:inset-0 [&_picture]:block [&_picture]:h-full [&_picture]:w-full">
            <HeroResponsivePicture
              avifSrcSet={capHeroSrcSet(hero.avifSrcSet)}
              webpSrcSet={capHeroSrcSet(hero.webpSrcSet)}
              fallbackSrc={HERO_FALLBACK_WEBP}
              width={HERO_LCP_PRELOAD_WIDTH}
              height={540}
              sizes="100vw"
              alt={heroAlt}
              className="absolute inset-0 h-full w-full object-cover"
              loading="eager"
              fetchPriority="high"
              decoding="async"
            />
            <div
              className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/30"
              aria-hidden="true"
            />
          </div>

          <div className="relative z-10 mx-auto flex min-h-[100svh] w-full max-w-7xl flex-col justify-end px-6 pb-12 pt-[calc(var(--header-offset,4.5rem)+1.5rem)] md:px-8 md:pb-16 lg:px-10">
            <p className="font-['Montserrat'] text-[10px] font-semibold uppercase tracking-[0.28em] text-white/80 md:text-[11px]">
              {e('hero.eyebrow')}
            </p>
            <p className="mt-2 font-['Montserrat'] text-[10px] font-medium uppercase tracking-[0.22em] text-white/70 md:text-[11px]">
              {e('hero.location')}
            </p>
            <h1 className="mt-5 max-w-xl text-white md:mt-6 md:max-w-2xl">
              <span className="block font-['Montserrat'] text-sm font-semibold uppercase tracking-[0.35em] md:text-base">
                {e('hero.titleSmall')}
              </span>
              <span className="mt-1 block font-['Playfair_Display'] text-[3.25rem] font-bold leading-none tracking-tight md:text-6xl lg:text-7xl">
                {e('hero.title')}
              </span>
            </h1>
            <p className="mt-4 max-w-md font-['Playfair_Display'] text-lg italic leading-snug text-white/90 md:mt-5 md:max-w-lg md:text-xl">
              {e('hero.subline')}
            </p>
            <div className="mt-8 max-w-md md:mt-10">
              <Link
                to={bookTo}
                className="seo-landing-btn inline-flex w-full items-center justify-center text-center no-underline sm:w-auto"
              >
                {e('cta.primary')}
              </Link>
            </div>
          </div>
        </section>

        <section className="border-b border-black/10 bg-[#F1ECE2]">
          <div className="seo-landing-container py-5 md:py-6">
            <p className="font-['Montserrat'] text-sm font-semibold uppercase tracking-[0.12em] text-stone-900 md:text-base">
              <span>{e('promo.offer')}</span>
              <span className="mx-2 text-stone-400" aria-hidden="true">
                ·
              </span>
              <span className="font-medium normal-case tracking-normal text-stone-700">
                {e('promo.validity')}
              </span>
            </p>
          </div>
        </section>

        <section className="seo-landing-section">
          <div className="seo-landing-container max-w-3xl">
            <h2 className="seo-landing-h2 mb-8 tracking-[0.08em] md:mb-10">
              {e('proof.heading')}
            </h2>
            <ul className="grid grid-cols-1 gap-8 md:grid-cols-3 md:gap-10">
              {PROOF_KEYS.map((key) => (
                <li key={key} className="border-t border-black/10 pt-5">
                  <h3 className="seo-landing-h3 text-lg md:text-xl">{e(`proof.${key}.title`)}</h3>
                  <p className="seo-landing-body mb-0 mt-2 text-sm md:text-[0.9375rem]">
                    {e(`proof.${key}.body`)}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="seo-landing-section border-t border-black/8">
          <div className="seo-landing-container max-w-2xl">
            <p className="mb-3 font-['Montserrat'] text-[10px] font-semibold uppercase tracking-[0.22em] text-stone-500 md:text-[11px]">
              {e('crew.eyebrow')}
            </p>
            <h2 className="seo-landing-h2 mb-4">
              <span className="block">{e('crew.titleLine1')}</span>
              <span className="block">{e('crew.titleLine2')}</span>
            </h2>
            <p className="seo-landing-body">{e('crew.body')}</p>
            <p className="seo-landing-body mb-6 italic text-stone-600">{e('crew.hook')}</p>
            <Link to={buyoutTo} className="seo-landing-link text-base font-semibold">
              {e('cta.secondary')}
            </Link>
          </div>
        </section>

        <section className="seo-landing-section border-t border-black/8 bg-[#F9F8F6]">
          <div className="seo-landing-container max-w-2xl text-center">
            <p className="seo-landing-body mb-2 md:mx-auto">{e('instagram.lead')}</p>
            <p className="mb-6 font-['Montserrat'] text-xl font-semibold tracking-[0.06em] text-stone-900 md:text-2xl">
              {e('instagram.handle')}
            </p>
            <a
              href={INSTAGRAM_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="seo-landing-btn inline-flex items-center justify-center no-underline"
            >
              {e('instagram.cta')}
            </a>
          </div>
        </section>

        <section className="seo-landing-cta border-t border-black/8 bg-stone-900">
          <div className="seo-landing-container max-w-md text-center">
            <Link
              to={bookTo}
              className="seo-landing-btn inline-flex w-full items-center justify-center bg-white text-stone-900 no-underline hover:bg-[#F1ECE2] sm:w-auto"
            >
              {e('cta.primary')}
            </Link>
          </div>
        </section>
      </div>
    </>
  );
}
