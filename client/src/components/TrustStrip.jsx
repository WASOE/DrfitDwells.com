import React from 'react';
import { useTranslation } from 'react-i18next';

const TrustStrip = () => {
  const { t } = useTranslation('common');

  return (
    <section className="py-6 md:py-8 bg-white">
      <div className="max-w-7xl mx-auto px-4 md:px-8">
        <div className="bg-white border border-stone-200 rounded-2xl px-6 py-4 shadow-sm w-full max-w-4xl mx-auto grid grid-cols-[auto_1fr_auto] items-center gap-8">
          {/* ZONE 1: LEFT (The Image) */}
          <div className="flex-shrink-0">
            <img
              src="/uploads/Icons%20trival/guest_favorite_2_990x555.webp"
              alt={t('trustStrip.guestFavoriteAlt')}
              className="h-16 w-auto object-contain mix-blend-darken contrast-125"
            />
          </div>

          {/* ZONE 2: CENTER (The Text) */}
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-stone-900 leading-tight">
              {t('trustStrip.guestFavoriteTitle')}
            </span>
            <span className="text-xs text-stone-600 leading-tight mt-0.5 font-normal">
              {t('trustStrip.guestFavoriteSubtitle')}
            </span>
          </div>

          {/* ZONE 3: RIGHT (The Stats) */}
          <div className="flex items-center gap-6">
            {/* Rating */}
            <div className="text-center">
              <div className="text-xl font-bold text-stone-900 leading-none">4.95</div>
              <div className="flex items-center gap-0.5 justify-center mt-1">
                {[1, 2, 3, 4, 5].map((star) => (
                  <svg
                    key={star}
                    className="w-3 h-3 text-stone-900"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path d="M10 15l-5.878 3.09 1.123-6.545L.489 6.91l6.572-.955L10 0l2.939 5.955 6.572.955-4.756 4.635 1.123 6.545z" />
                  </svg>
                ))}
              </div>
            </div>

            {/* Reviews */}
            <div className="text-center hidden md:block">
              <div className="text-xl font-bold text-stone-900">663</div>
              <div className="text-xs text-stone-500 underline decoration-stone-300 underline-offset-2">{t('trustStrip.reviews')}</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default TrustStrip;
