import './the-valley/the-valley.css';
import HeroSection from './about/sections/HeroSection';
import StorySection from './about/sections/StorySection';
import StatsSection from './about/sections/StatsSection';
import PlaceSection from './about/sections/PlaceSection';
import OutcomesSection from './about/sections/OutcomesSection';
import HostSection from './about/sections/HostSection';
import CTASection from './about/sections/CTASection';

const About = () => {
  return (
    <div className="valley-page">
      <HeroSection />
      <StorySection />
      <StatsSection />
      <PlaceSection />
      <OutcomesSection />
      <HostSection />
      <CTASection />
    </div>
  );
};

export default About;
