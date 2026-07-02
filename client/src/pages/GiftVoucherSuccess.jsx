import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Seo from '../components/Seo';
import { useSiteLanguage } from '../hooks/useSiteLanguage';
import '../i18n/ns/giftVoucher';

export default function GiftVoucherSuccess() {
  const { t } = useTranslation('giftVoucher');
  const { language } = useSiteLanguage();
  const isBg = language === 'bg';

  return (
    <>
      <Seo
        title={t('success.title')}
        description={t('success.description')}
        canonicalPath="/gift-vouchers/success"
      />
      <main className="px-4 py-12 md:py-16 lg:py-20">
        <div className="mx-auto w-full max-w-2xl rounded-3xl border border-gray-200 bg-white p-6 md:p-10">
          <p className="text-xs uppercase tracking-[0.24em] text-gray-500">{t('success.kicker')}</p>
          <h1 className="mt-2 text-3xl font-semibold text-gray-900 md:text-4xl">{t('success.heading')}</h1>
          <p className="mt-4 text-sm text-gray-700 md:text-base">{t('success.body')}</p>
          <p className="mt-4 text-sm text-gray-600">
            {t('success.help')}{' '}
            <a className="underline" href="mailto:hello@driftdwells.com">
              hello@driftdwells.com
            </a>
            .
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              to={isBg ? '/bg/gift-vouchers' : '/gift-vouchers'}
              className="rounded-2xl bg-[#81887A] px-5 py-2.5 text-sm text-white"
            >
              {t('success.buyAnother')}
            </Link>
            <Link
              to={isBg ? '/bg' : '/'}
              className="rounded-2xl border border-gray-300 px-5 py-2.5 text-sm text-gray-700"
            >
              {t('success.backHome')}
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}
