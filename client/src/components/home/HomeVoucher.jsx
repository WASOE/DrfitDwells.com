import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { HOME_IMAGES } from '../../data/homepageMedia';
import { localizePath } from '../../utils/localizedRoutes';
import { useSiteLanguage } from '../../hooks/useSiteLanguage';
import HomePicture from './HomePicture';
import { eyebrowClass, primaryCtaClass, sectionClass, titleClass, wrapClass } from './homeStyles';

export default function HomeVoucher() {
  const { t } = useTranslation('home');
  const { language } = useSiteLanguage();

  return (
    <section id="gift" className={`bg-[#F9F9F7] ${sectionClass}`} aria-labelledby="home-voucher-title">
      <div className={`${wrapClass} grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-16 items-center`}>
        <div className="max-w-xl">
          <p className={`${eyebrowClass} mb-4`}>{t('voucher.eyebrow')}</p>
          <h2 id="home-voucher-title" className={titleClass}>{t('voucher.title')}</h2>
          <p className="mt-5 text-base md:text-lg text-stone-700 leading-relaxed max-w-2xl">{t('voucher.body')}</p>
          <ul className="mt-6 flex flex-wrap gap-x-4 gap-y-2 text-sm text-stone-600">
            <li>{t('voucher.from')}</li>
            <li aria-hidden="true">·</li>
            <li>{t('voucher.valid')}</li>
            <li aria-hidden="true">·</li>
            <li>{t('voucher.delivery')}</li>
          </ul>
          <Link to={localizePath('/gift-vouchers', language)} className={`${primaryCtaClass} mt-8`}>
            {t('voucher.cta')}
          </Link>
        </div>
        <div className="relative aspect-[4/5] max-w-md mx-auto lg:max-w-none w-full bg-stone-200 overflow-hidden">
          <HomePicture
            image={HOME_IMAGES.voucher}
            alt={t('voucher.imageAlt')}
            sizes="(min-width: 1024px) 40vw, 100vw"
            className="absolute inset-0 h-full w-full object-cover"
          />
        </div>
      </div>
    </section>
  );
}
