import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Seo from '../../components/Seo';
import BookingCTABand from '../the-valley/sections/BookingCTABand';
import { useLocalizedPath } from '../../hooks/useLocalizedPath';
import { buildHreflangAlternates } from '../../utils/localizedRoutes';
import { WINTER_VILLAGE_SEO } from './winterVillageConfig';
import WinterVillageHero, {
  WINTER_VILLAGE_HERO_PRELOAD
} from './components/WinterVillageHero';
import WinterVillageProductSelector from './components/WinterVillageProductSelector';
import WinterVillageAccommodations from './components/WinterVillageAccommodations';
import WinterVillageFacilities from './components/WinterVillageFacilities';
import WinterVillageDates from './components/WinterVillageDates';
import WinterVillageFaq from './components/WinterVillageFaq';
import WinterVillagePreviewModal from './components/WinterVillagePreviewModal';
import '../the-valley/the-valley.css';
import './winter-village.css';

export default function WinterVillagePage() {
  const packagesRef = useRef(null);
  const navigate = useNavigate();
  const lp = useLocalizedPath();
  const [selectedProductId, setSelectedProductId] = useState('stay');
  const [modalOpen, setModalOpen] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setPrefersReducedMotion(mediaQuery.matches);
    update();
    mediaQuery.addEventListener('change', update);
    return () => mediaQuery.removeEventListener('change', update);
  }, []);

  const scrollToPackages = useCallback(() => {
    packagesRef.current?.scrollIntoView({
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
      block: 'start'
    });
  }, [prefersReducedMotion]);

  const selectProductAndScroll = useCallback(
    (productId) => {
      setSelectedProductId(productId);
      requestAnimationFrame(() => {
        packagesRef.current?.scrollIntoView({
          behavior: prefersReducedMotion ? 'auto' : 'smooth',
          block: 'start'
        });
      });
    },
    [prefersReducedMotion]
  );

  return (
    <>
      <Seo
        title={WINTER_VILLAGE_SEO.title}
        description={WINTER_VILLAGE_SEO.description}
        canonicalPath={WINTER_VILLAGE_SEO.canonicalPath}
        hreflangAlternates={buildHreflangAlternates('/winter-village')}
        ogType="website"
        ogImage={WINTER_VILLAGE_SEO.ogImage}
        preloadImages={[
          {
            href: WINTER_VILLAGE_HERO_PRELOAD,
            type: 'image/avif',
            fetchPriority: 'high'
          }
        ]}
      />

      <div className="valley-page winter-village-page retreat-page">
        <WinterVillageHero
          onExplorePackages={scrollToPackages}
          prefersReducedMotion={prefersReducedMotion}
        />

        <WinterVillageProductSelector
          sectionRef={packagesRef}
          selectedProductId={selectedProductId}
          onSelectProduct={setSelectedProductId}
          onRequestReserve={() => setModalOpen(true)}
        />

        <WinterVillageAccommodations prefersReducedMotion={prefersReducedMotion} />

        <WinterVillageFacilities prefersReducedMotion={prefersReducedMotion} />

        <WinterVillageDates onSelectDate={selectProductAndScroll} />

        <WinterVillageFaq prefersReducedMotion={prefersReducedMotion} />

        <BookingCTABand
          primaryLabel="Explore winter packages"
          secondaryLabel="Visit The Valley"
          onPrimaryClick={scrollToPackages}
          onSecondaryClick={() => navigate(lp('/valley'))}
        />

        <WinterVillagePreviewModal open={modalOpen} onClose={() => setModalOpen(false)} />
      </div>
    </>
  );
}
