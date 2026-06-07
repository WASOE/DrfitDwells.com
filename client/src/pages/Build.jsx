import { useCallback, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Seo from '../components/Seo';
import BuildHeroPhoto from '../components/build/BuildHeroPhoto';
import MobileConfigPanel from '../components/configurator/MobileConfigPanel';
import MobileStepIndicator from '../components/configurator/MobileStepIndicator';
import MobileSpecsBar from '../components/configurator/MobileSpecsBar';
import BuildDesktopShell from '../components/build/BuildDesktopShell';
import { useBuildConfigurator } from '../hooks/useBuildConfigurator';
import {
  buildBuildEnquiryMailto,
  downloadBuildSpecPdf,
} from '../data/buildConfiguratorExport.js';
import { BUILD_STEPS } from '../data/buildConfiguratorSchema.js';
import { useLanguage } from '../context/LanguageContext.jsx';
import { CONTACT_EMAIL } from '../data/gmbLocations';

const Build = () => {
  const [isMobileConfigOpen, setIsMobileConfigOpen] = useState(false);
  const [isSpecsBarExpanded, setIsSpecsBarExpanded] = useState(false);
  const { language } = useLanguage();
  const configurator = useBuildConfigurator();

  const handleScheduleConsultation = useCallback(() => {
    window.location.href = buildBuildEnquiryMailto(configurator.state, CONTACT_EMAIL);
  }, [configurator.state]);

  const handlePdfDownload = useCallback(async () => {
    await downloadBuildSpecPdf(configurator.state, CONTACT_EMAIL);
  }, [configurator.state]);

  const handleMobileStepClick = useCallback(
    (stepIndex) => {
      configurator.goToStep(stepIndex);
      setIsMobileConfigOpen(true);
    },
    [configurator]
  );

  const seoTitle =
    language === 'bg'
      ? 'Модулни къщи Drift & Dwells – оф-грид домове (~30 000 €)'
      : 'Custom Modular Cabins Bulgaria – Drift & Dwells';
  const seoDescription =
    language === 'bg'
      ? 'Искате собствена оф-грид къща? Проектираме и доставяме напълно обзаведени модулни домове в България (от около 30 000 €). Холандски дизайн, готови за живеене.'
      : 'Design your own off-grid cabin: turnkey modular timber homes in Bulgaria from around €30,000, Dutch-designed and furnished. Configure finishes and systems here.';

  return (
    <>
      <Seo
        title={seoTitle}
        description={seoDescription}
        canonicalPath="/build"
        noindex
      />
      <div className="min-h-screen bg-white lg:bg-[#f5f5f3]">
        <MobileStepIndicator
          steps={BUILD_STEPS}
          currentStep={configurator.currentStep}
          onStepClick={handleMobileStepClick}
        />

        {/* Mobile: hero + configure button */}
        <div className="relative lg:hidden">
          <div
            className="fixed inset-x-0 top-[var(--header-offset,68px)] bottom-[4.5rem] z-0 overflow-hidden"
            style={{ zIndex: 0 }}
          >
            <BuildHeroPhoto
              imageUrl={configurator.heroImageUrl}
              alt={configurator.model.name}
              fillContainer
            />
          </div>

          <AnimatePresence>
            {!isMobileConfigOpen && !isSpecsBarExpanded && (
              <motion.button
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20, transition: { duration: 0.2 } }}
                type="button"
                onClick={() => setIsMobileConfigOpen(true)}
                className="fixed left-1/2 z-30 -translate-x-1/2 touch-manipulation rounded-full bg-[#1a1a1a] px-8 py-4 text-sm font-medium uppercase tracking-wider text-white shadow-2xl active:scale-95"
                style={{ bottom: '5.75rem' }}
              >
                Configure Cabin
              </motion.button>
            )}
          </AnimatePresence>
        </div>

        <section className="relative hidden lg:block">
          <BuildDesktopShell
            configurator={configurator}
            onDownloadPDF={handlePdfDownload}
            onScheduleConsultation={handleScheduleConsultation}
          />
        </section>

        <MobileConfigPanel
          isOpen={isMobileConfigOpen}
          onClose={() => setIsMobileConfigOpen(false)}
          configurator={configurator}
          onDownloadPDF={handlePdfDownload}
          onScheduleConsultation={handleScheduleConsultation}
        />

        <MobileSpecsBar
          dimensions={configurator.dimensions}
          area={configurator.area}
          capacity={configurator.capacity}
          price={configurator.barPrice}
          onDownloadPDF={handlePdfDownload}
          onScheduleConsultation={handleScheduleConsultation}
          isConfigPanelOpen={isMobileConfigOpen}
          onExpandedChange={setIsSpecsBarExpanded}
        />
      </div>
    </>
  );
};

export default Build;
