import { useCallback, useEffect, useRef, useState } from 'react';
import Seo from '../../components/Seo';
import { buildHreflangAlternates } from '../../utils/localizedRoutes';
import { WINTER_VILLAGE_HERO_PRELOAD } from './winterVillageMedia';
import { useWinterVillageLocale } from './useWinterVillageLocale';
import WinterVillageHero from './components/WinterVillageHero';
import WinterVillageWays from './components/WinterVillageWays';
import WinterVillageChristmasFeature from './components/WinterVillageChristmasFeature';
import WinterVillageParentFeature from './components/WinterVillageParentFeature';
import WinterVillageFounding from './components/WinterVillageFounding';
import WinterVillageProductSelector from './components/WinterVillageProductSelector';
import WinterVillageDates from './components/WinterVillageDates';
import WinterVillageClose from './components/WinterVillageClose';
import WinterVillageFaq from './components/WinterVillageFaq';
import WinterVillagePreviewModal from './components/WinterVillagePreviewModal';
import './winter-village.css';

export default function WinterVillagePage() {
  const { seo } = useWinterVillageLocale();
  const packagesRef = useRef(null);
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
        title={seo.title}
        description={seo.description}
        ogTitle={seo.ogTitle}
        ogDescription={seo.ogDescription}
        canonicalPath={seo.canonicalPath}
        hreflangAlternates={buildHreflangAlternates('/winter-village')}
        ogType="website"
        ogImage={seo.ogImage}
        preloadImages={[
          {
            href: WINTER_VILLAGE_HERO_PRELOAD,
            type: 'image/avif',
            fetchPriority: 'high'
          }
        ]}
      />

      <div className="winter-village-page">
        <WinterVillageHero
          onViewPackage={selectProductAndScroll}
          onExplorePackages={scrollToPackages}
        />

        <WinterVillageWays onChooseWay={selectProductAndScroll} />

        <WinterVillageChristmasFeature
          onChooseChristmas={() => selectProductAndScroll('christmas')}
        />

        <WinterVillageParentFeature
          onChooseWeekend={() => selectProductAndScroll('parent-child')}
        />

        <WinterVillageFounding />

        <WinterVillageProductSelector
          sectionRef={packagesRef}
          selectedProductId={selectedProductId}
          onSelectProduct={setSelectedProductId}
          onRequestReserve={() => setModalOpen(true)}
        />

        <WinterVillageDates onSelectDate={selectProductAndScroll} />

        <WinterVillageClose onChooseWinter={scrollToPackages} />

        <WinterVillageFaq />

        <WinterVillagePreviewModal open={modalOpen} onClose={() => setModalOpen(false)} />
      </div>
    </>
  );
}
