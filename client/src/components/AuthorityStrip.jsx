import { useTranslation } from 'react-i18next';
import { BRANDING, BRANDING_DIMENSIONS } from '../config/brandingAssets';

const AuthorityStrip = () => {
  const { t } = useTranslation('common');

  return (
    <section className="relative bg-[#F9F9F7] py-20 border-y border-[#E5E5E0]">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-12 md:gap-0 items-start justify-items-center">
          {/* COLUMN 1: Airbnb Guest Favorite */}
          <div className="flex flex-col items-center text-center w-full px-8 md:border-r md:border-[#D6D6D3]">
            <img
              src={BRANDING.partnerAirbnbWebp}
              alt="Airbnb"
              width={BRANDING_DIMENSIONS.partnerAirbnb.width}
              height={BRANDING_DIMENSIONS.partnerAirbnb.height}
              className="h-12 w-auto object-contain mb-6 mix-blend-multiply brightness-0"
              loading="lazy"
              decoding="async"
            />
            <div className="text-4xl font-serif text-[#1c1917] mb-2">4.95</div>
            <div className="text-[10px] uppercase tracking-[0.25em] text-stone-500 font-medium">{t('authority.airbnbTopHomes')}</div>
          </div>

          {/* COLUMN 2: Booking.com */}
          <div className="flex flex-col items-center text-center w-full px-8 md:border-r md:border-[#D6D6D3]">
            {/* Booking.com Logo */}
            <div className="h-12 flex items-center mb-6 mt-2">
              <span className="text-2xl font-bold text-[#1c1917] tracking-tight">Booking.com</span>
            </div>
            <div className="text-4xl font-serif text-[#1c1917] mb-2">9.8</div>
            <div className="text-[10px] uppercase tracking-[0.25em] text-stone-500 font-medium">{t('authority.bookingAwards')}</div>
          </div>

          {/* COLUMN 3: TripAdvisor */}
          <div className="flex flex-col items-center text-center w-full px-8">
            {/* TripAdvisor Logo */}
            <div className="h-14 flex items-center mb-4">
              <img
                src={BRANDING.partnerTripadvisorWebp}
                alt="TripAdvisor"
                width={BRANDING_DIMENSIONS.partnerTripadvisor.width}
                height={BRANDING_DIMENSIONS.partnerTripadvisor.height}
                className="h-14 w-auto object-contain"
                loading="lazy"
                decoding="async"
              />
            </div>
            <div className="text-4xl font-serif text-[#1c1917] mb-2">5.0</div>
            <div className="text-[10px] uppercase tracking-[0.25em] text-stone-500 font-medium">{t('authority.tripadvisorChoice')}</div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default AuthorityStrip;

