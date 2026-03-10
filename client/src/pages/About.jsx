import './the-valley/the-valley.css';
import HeroSection from './about/sections/HeroSection';
import StatsSection from './about/sections/StatsSection';
import OutcomesSection from './about/sections/OutcomesSection';
import HostSection from './about/sections/HostSection';
import CTASection from './about/sections/CTASection';
import Seo from '../components/Seo';

const About = () => {
  return (
    <>
      <Seo
        title="About Drift & Dwells – Off-Grid Retreat Studio in Bulgaria"
        description="Learn about Drift & Dwells, the retreat studio behind The Cabin and The Valley, crafting off-grid experiences focused on presence, nature, and slow living."
        canonicalPath="/about"
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
