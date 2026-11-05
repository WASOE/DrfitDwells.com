import { Suspense, lazy } from 'react';
import { HOMEPAGE_REVIEWS } from '../../data/homepageReviews';
import { useTranslation } from 'react-i18next';
import { eyebrowClass, titleClass, wrapClass } from './homeStyles';

const AuthorityStrip = lazy(() => import('../AuthorityStrip'));

export default function HomeReviews() {
  const { t } = useTranslation('home');

  return (
    <section id="reviews" className="bg-[#F9F8F6]" aria-labelledby="home-reviews-title">
      <Suspense fallback={<div className="min-h-[180px]" aria-hidden />}>
        <AuthorityStrip />
      </Suspense>
      <div className={`${wrapClass} pb-14 md:pb-20`}>
        <div className="max-w-3xl mb-8">
          <p className={`${eyebrowClass} mb-4`}>{t('reviews.eyebrow')}</p>
          <h2 id="home-reviews-title" className={titleClass}>{t('reviews.title')}</h2>
        </div>
        <ul className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {HOMEPAGE_REVIEWS.map((review) => (
            <li key={review.id} className="bg-white border border-[#E5E5E0] p-6 flex flex-col min-w-0">
              <blockquote className="text-[15px] text-stone-900 leading-relaxed">
                <p>{review.text}</p>
              </blockquote>
              <p className="mt-5 text-xs uppercase tracking-[0.14em] text-stone-600">
                {review.name} · {review.stay} · {review.platform}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
