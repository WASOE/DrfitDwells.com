import { useCallback, useState } from 'react';
import '../../i18n/ns/retreats';
import { useTranslation } from 'react-i18next';
import Seo from '../../components/Seo';
import { buildHreflangAlternates } from '../../utils/localizedRoutes';
import '../the-valley/the-valley.css';
import './retreat-page.css';
import RetreatHeroSection from './sections/RetreatHeroSection';
import RetreatWhySection from './sections/RetreatWhySection';
import RetreatIncludedSection from './sections/RetreatIncludedSection';
import RetreatAccommodationsSection from './sections/RetreatAccommodationsSection';
import RetreatCapacitySection from './sections/RetreatCapacitySection';
import RetreatQuoteSection from './sections/RetreatQuoteSection';
import RetreatIdealForSection from './sections/RetreatIdealForSection';
import RetreatLogisticsSection from './sections/RetreatLogisticsSection';
import RetreatFaqSection from './sections/RetreatFaqSection';

const CANONICAL_PATH = '/retreats/the-valley';

const TheValleyRetreatPage = () => {
  const { t } = useTranslation('retreats');
  const [maxGuests, setMaxGuests] = useState(null);

  const scrollToQuote = useCallback(() => {
    document.getElementById('retreat-quote')?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const handleQuoteLoaded = useCallback((data) => {
    if (data?.maxGuests != null) {
      setMaxGuests(data.maxGuests);
    }
  }, []);

  return (
    <div className="retreat-page valley-page">
      <Seo
        title={t('meta.title')}
        description={t('meta.description')}
        canonicalPath={CANONICAL_PATH}
        ogImage="/uploads/The Valley/WhatsApp Image 2025-10-17 at 10.20.23 AM.jpeg"
        hreflangAlternates={buildHreflangAlternates(CANONICAL_PATH)}
      />

      <RetreatHeroSection onCheckAvailability={scrollToQuote} />
      <RetreatWhySection />
      <RetreatIncludedSection />
      <RetreatAccommodationsSection />
      <RetreatCapacitySection maxGuests={maxGuests} />
      <RetreatQuoteSection onQuoteLoaded={handleQuoteLoaded} />
      <RetreatIdealForSection />
      <RetreatLogisticsSection />
      <RetreatFaqSection />
    </div>
  );
};

export default TheValleyRetreatPage;
