import './the-valley/the-valley.css';
import HeroSection from './about/sections/HeroSection';
import StatsSection from './about/sections/StatsSection';
import OutcomesSection from './about/sections/OutcomesSection';
import HostSection from './about/sections/HostSection';
import CTASection from './about/sections/CTASection';
import Seo from '../components/Seo';
import { useLanguage } from '../context/LanguageContext.jsx';
import { buildHreflangAlternates } from '../utils/localizedRoutes';

const About = () => {
  const { language } = useLanguage();
  const seoTitle =
    language === 'bg'
      ? 'За Drift & Dwells – студио за оф-грид уединения в България'
      : 'About Drift & Dwells – Off-Grid Retreat Studio in Bulgaria';
  const seoDescription =
    language === 'bg'
      ? 'Научете повече за Drift & Dwells, студиото зад The Cabin и The Valley, което създава оф-грид преживявания, фокусирани върху присъствие, природа и бавен ритъм.'
      : 'Learn about Drift & Dwells, the retreat studio behind The Cabin and The Valley, crafting off-grid experiences focused on presence, nature, and slow living.';

  return (
    <>
      <Seo
        title={seoTitle}
        description={seoDescription}
        canonicalPath="/about"
        hreflangAlternates={buildHreflangAlternates('/about')}
        ogImage="/uploads/Videos/The-cabin-header.winter-poster.jpg"
      />
      <div className="valley-page">
        <HeroSection />
        <StatsSection />
        <OutcomesSection />
        <HostSection />
        <CTASection />
      </div>
    </>
  );
};

export default About;
