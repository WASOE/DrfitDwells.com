import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import GiftVoucherCardPreview from '../giftVoucher/GiftVoucherCardPreview';
import {
  buildPreviewVoucher,
  createInitialBuilderState,
} from '../giftVoucher/giftVoucherBuilderState';
import { localizePath } from '../../utils/localizedRoutes';
import { useSiteLanguage } from '../../hooks/useSiteLanguage';
import { eyebrowClass, primaryCtaClass, titleClass, wrapClass } from './homeStyles';

export default function HomeVoucher() {
  const { t } = useTranslation('home');
  const { language } = useSiteLanguage();
  const previewFields = useMemo(
    () => buildPreviewVoucher(createInitialBuilderState(language), 15000),
    [language]
  );

  return (
    <section id="gift" className="bg-[#FFFDF8] py-14 md:py-20 lg:py-[6.5rem]" aria-labelledby="home-voucher-title">
      <div className={`${wrapClass} grid grid-cols-1 lg:grid-cols-[1.15fr_0.85fr] gap-10 lg:gap-[4.5rem] items-center`}>
        <div className="max-w-xl order-2 lg:order-1">
          <p className={`${eyebrowClass} mb-4`}>{t('voucher.eyebrow')}</p>
          <h2 id="home-voucher-title" className={titleClass}>{t('voucher.title')}</h2>
          <p className="mt-5 text-base md:text-lg text-stone-700 leading-relaxed max-w-md">
            {t('voucher.body')}
          </p>
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
        <div className="order-1 lg:order-2 w-full max-w-md mx-auto lg:max-w-none">
          <div className="bg-[#F3EFE6] border border-[#E5E5E0] p-5 sm:p-8 min-h-[320px] lg:min-h-[420px] flex items-center justify-center">
            <GiftVoucherCardPreview fields={previewFields} />
          </div>
          <p className="sr-only">{t('voucher.imageAlt')}</p>
        </div>
      </div>
    </section>
  );
}
