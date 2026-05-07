import { Link } from 'react-router-dom';
import Seo from '../components/Seo';
import { useSiteLanguage } from '../hooks/useSiteLanguage';

export default function GiftVoucherRedeem() {
  const { language } = useSiteLanguage();
  const isBg = language === 'bg';
  const copy = {
    title: isBg ? 'Използване на подаръчен ваучер | Drift & Dwells' : 'Gift Voucher Redemption | Drift & Dwells',
    description: isBg
      ? 'Използването на подаръчни ваучери ще бъде достъпно през процеса на резервация.'
      : 'Gift voucher redemption will be available through the booking flow.',
    kicker: isBg ? 'Подаръчен ваучер' : 'Gift Voucher',
    heading: isBg ? 'Използването предстои' : 'Redemption coming soon',
    body: isBg
      ? 'Използването на ваучер ще бъде достъпно през процеса на резервация в следваща версия.'
      : 'Voucher redemption will be available through the booking flow in a later release.',
    support: isBg ? 'За съдействие пишете на' : 'For support, contact',
    back: isBg ? 'Назад към подаръчните ваучери' : 'Back to gift vouchers'
  };

  return (
    <>
      <Seo
        title={copy.title}
        description={copy.description}
        canonicalPath="/gift-vouchers/redeem"
      />
      <main className="px-4 py-12 md:py-16 lg:py-20">
        <div className="mx-auto w-full max-w-2xl rounded-3xl border border-gray-200 bg-white p-6 md:p-10">
          <p className="text-xs uppercase tracking-[0.24em] text-gray-500">{copy.kicker}</p>
          <h1 className="mt-2 text-3xl font-semibold text-gray-900 md:text-4xl">{copy.heading}</h1>
          <p className="mt-4 text-sm text-gray-700 md:text-base">
            {copy.body}
          </p>
          <p className="mt-3 text-sm text-gray-600">
            {copy.support} <a className="underline" href="mailto:hello@driftdwells.com">hello@driftdwells.com</a>.
          </p>
          <div className="mt-8">
            <Link to={isBg ? '/bg/gift-vouchers' : '/gift-vouchers'} className="rounded-2xl bg-[#81887A] px-5 py-2.5 text-sm text-white">{copy.back}</Link>
          </div>
        </div>
      </main>
    </>
  );
}
