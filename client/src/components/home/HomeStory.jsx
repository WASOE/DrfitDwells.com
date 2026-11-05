import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { HOME_IMAGES } from '../../data/homepageMedia';
import { localizePath } from '../../utils/localizedRoutes';
import { useSiteLanguage } from '../../hooks/useSiteLanguage';
import HomePicture from './HomePicture';
import { eyebrowClass, sectionClass, textLinkClass, titleClass, wrapClass } from './homeStyles';

export default function HomeStory() {
  const { t } = useTranslation('home');
  const { language } = useSiteLanguage();

  return (
    <>
      <section className="bg-[#F6F1E8]" aria-labelledby="home-story-title">
        <div className="grid grid-cols-1 lg:grid-cols-2 min-h-0 lg:min-h-[520px]">
          <div className="relative min-h-[320px] lg:min-h-full bg-stone-300 overflow-hidden">
            <HomePicture
              image={HOME_IMAGES.founder}
              alt={t('story.imageAlt')}
              sizes="(min-width: 1024px) 50vw, 100vw"
              className="absolute inset-0 h-full w-full object-cover object-[center_20%]"
            />
          </div>
          <div className="flex items-center">
            <div className="w-full max-w-xl px-4 sm:px-8 lg:px-14 xl:px-20 py-12 md:py-16">
              <p className={`${eyebrowClass} mb-4`}>{t('story.eyebrow')}</p>
              <h2 id="home-story-title" className={titleClass}>{t('story.title')}</h2>
              <p className="mt-5 text-base md:text-lg text-stone-700 leading-relaxed">{t('story.body')}</p>
              <div className="mt-8 relative aspect-[16/10] overflow-hidden bg-stone-200 max-w-md">
                <HomePicture
                  image={HOME_IMAGES.buildSite}
                  alt={t('story.buildAlt')}
                  sizes="(min-width: 1024px) 28vw, 90vw"
                  className="absolute inset-0 h-full w-full object-cover"
                />
              </div>
              <Link to={localizePath('/about', language)} className={`${textLinkClass} mt-6`}>
                {t('story.cta')}
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className={`bg-[#FFFDF8] border-t border-[#EBE7DF] ${sectionClass}`} aria-labelledby="home-aylyak-title">
        <div className={`${wrapClass} text-center max-w-3xl`}>
          <p className={`${eyebrowClass} mb-4`}>{t('philosophy.eyebrow')}</p>
          <h2 id="home-aylyak-title" className="font-serif text-5xl sm:text-6xl md:text-7xl text-[#1c1917] tracking-tight">
            {t('philosophy.word')}
          </h2>
          <p className="mt-3 text-stone-600">
            <span className="italic">{t('philosophy.phonetic')}</span>
            <span className="mx-2">·</span>
            <span className="italic">{t('philosophy.type')}</span>
          </p>
          <div className="h-px bg-[#E5E5E0] my-8 mx-auto max-w-xs" />
          <div className="space-y-4 text-lg md:text-xl text-stone-800 leading-relaxed font-serif max-w-2xl mx-auto">
            <p>{t('philosophy.definition1')}</p>
            <p>{t('philosophy.definition2')}</p>
          </div>
        </div>
      </section>
    </>
  );
}
