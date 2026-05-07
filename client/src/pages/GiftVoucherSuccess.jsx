import { Link } from 'react-router-dom';
import Seo from '../components/Seo';
import { useSiteLanguage } from '../hooks/useSiteLanguage';

export default function GiftVoucherSuccess() {
  const { language } = useSiteLanguage();
  const isBg = language === 'bg';
  const copy = {
    title: isBg ? 'Плащането за ваучера е получено | Drift & Dwells' : 'Gift Voucher Payment Received | Drift & Dwells',
    description: isBg
      ? 'Плащането за вашия подаръчен ваучер е получено и се обработва сигурно.'
      : 'Your gift voucher payment has been received and is being securely processed.',
    kicker: isBg ? 'Подаръчен ваучер' : 'Gift Voucher',
    heading: isBg ? 'Плащането е получено' : 'Payment received',
    body: isBg
      ? 'Вашият ваучер се обработва сигурно. Имейлът с подаръчния ваучер ще бъде изпратен след потвърждение на плащането.'
      : 'Your voucher is being securely processed. The gift voucher email will be sent once payment is confirmed.',
    help: isBg
      ? 'Ако не получите имейл скоро, свържете се с нас на'
      : 'If you do not receive an email shortly, contact us at',
    buyAnother: isBg ? 'Купи още един ваучер' : 'Buy another voucher',
    backHome: isBg ? 'Назад към началото' : 'Back to home'
  };

  return (
    <>
      <Seo
        title={copy.title}
        description={copy.description}
        canonicalPath="/gift-vouchers/success"
      />
      <main className="px-4 py-12 md:py-16 lg:py-20">
        <div className="mx-auto w-full max-w-2xl rounded-3xl border border-gray-200 bg-white p-6 md:p-10">
          <p className="text-xs uppercase tracking-[0.24em] text-gray-500">{copy.kicker}</p>
          <h1 className="mt-2 text-3xl font-semibold text-gray-900 md:text-4xl">{copy.heading}</h1>
          <p className="mt-4 text-sm text-gray-700 md:text-base">
            {copy.body}
          </p>
          <p className="mt-4 text-sm text-gray-600">
            {copy.help}{' '}
            <a className="underline" href="mailto:hello@driftdwells.com">hello@driftdwells.com</a>.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to={isBg ? '/bg/gift-vouchers' : '/gift-vouchers'} className="rounded-2xl bg-[#81887A] px-5 py-2.5 text-sm text-white">{copy.buyAnother}</Link>
            <Link to={isBg ? '/bg' : '/'} className="rounded-2xl border border-gray-300 px-5 py-2.5 text-sm text-gray-700">{copy.backHome}</Link>
          </div>
        </div>
      </main>
    </>
  );
}
