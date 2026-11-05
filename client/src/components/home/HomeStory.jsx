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
    <section className={`bg-[#F9F9F7] ${sectionClass}`} aria-labelledby="home-story-title">
      <div className={wrapClass}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-16 items-center mb-12 md:mb-20">
          <div className="relative aspect-[16/9] lg:aspect-[4/3] bg-stone-200 overflow-hidden min-w-0 order-1">
            <HomePicture
              image={HOME_IMAGES.cabinExterior}
              alt={t('story.imageAlt')}
              sizes="(min-width: 1024px) 45vw, 100vw"
              className="absolute inset-0 h-full w-full object-cover"
            />
          </div>
          <div className="max-w-xl order-2">
            <p className={`${eyebrowClass} mb-4`}>{t('story.eyebrow')}</p>
            <h2 id="home-story-title" className={titleClass}>{t('story.title')}</h2>
            <p className="mt-5 text-base md:text-lg text-stone-700 leading-relaxed">{t('story.body')}</p>
            <Link to={localizePath('/about', language)} className={`${textLinkClass} mt-6`}>
              {t('story.cta')}
            </Link>
          </div>
        </div>

        <div className="max-w-3xl">
          <p className={`${eyebrowClass} mb-4`}>{t('philosophy.eyebrow')}</p>
          <h2 className="font-serif text-4xl sm:text-5xl md:text-6xl text-[#1c1917] tracking-tight">
            {t('philosophy.word')}
          </h2>
          <p className="mt-3 text-stone-600">
            <span className="italic">{t('philosophy.phonetic')}</span>
            <span className="mx-2">·</span>
            <span className="italic">{t('philosophy.type')}</span>
          </p>
          <div className="h-px bg-[#E5E5E0] my-6" />
          <div className="space-y-4 text-base md:text-lg text-stone-800 leading-relaxed font-serif">
            <p><span className="font-semibold">1.</span> {t('philosophy.definition1')}</p>
            <p><span className="font-semibold">2.</span> {t('philosophy.definition2')}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
