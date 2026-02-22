import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MapPin, Home, Mountain, Cloud, HelpCircle, ChevronDown } from 'lucide-react';

const PracticalDetailsAccordion = () => {
  const [openIndex, setOpenIndex] = useState(0);

  const items = [
    {
      id: 'access',
      icon: MapPin,
      title: 'Year-round access and parking',
      content: 'The Valley is accessible year-round. Parking is available at the designated area, with a 1km walk to the village (assistance available).'
    },
    {
      id: 'amenities',
      icon: Home,
      title: 'Reliable heating and hot water',
      content: 'All units are equipped with modern heating systems and hot water. The infrastructure is designed to function reliably in all seasons.'
    },
    {
      id: 'water',
      icon: Mountain,
      title: 'Drinking water availability',
      content: 'Fresh drinking water is available on-site. Each accommodation has access to clean, filtered water for all your needs.'
    },
    {
      id: 'winter',
      icon: Cloud,
      title: 'Winter and snow conditions',
      content: 'The Valley is fully prepared for winter conditions. Pathways are maintained, and all systems are designed to handle snow and cold weather.'
    },
    {
      id: 'support',
      icon: HelpCircle,
      title: 'Support availability',
      content: 'Support is available in case of weather changes or emergencies. Remote does not mean unprepared—we ensure everything works reliably.'
    }
  ];

  return (
    <section className="valley-section">
      <div className="valley-container" style={{ maxWidth: '900px' }}>
        {/* Divider Above */}
        <div className="valley-divider" />
        
        {/* H2 - Section Title */}
        <h2 className="valley-h2 mb-5 text-left">Practical details</h2>

        {/* Short Sentence */}
        <p className="valley-intro mb-12 max-w-2xl">
          Remote does not mean unprepared.
        </p>

        {/* Accordion - Aligned to Same Column Width */}
        <div className="border border-[rgba(0,0,0,0.12)] rounded-xl overflow-hidden bg-white">
          {items.map((item, index) => {
            const Icon = item.icon;
            const isOpen = openIndex === index;

            return (
              <div
                key={item.id}
                className="border-b border-[rgba(0,0,0,0.12)] last:border-b-0"
              >
                <button
                  onClick={() => setOpenIndex(isOpen ? -1 : index)}
                  className={`w-full flex items-center gap-4 p-6 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#81887A] ${
                    isOpen ? 'bg-[rgba(0,0,0,0.02)]' : 'bg-transparent hover:bg-[rgba(0,0,0,0.01)]'
                  }`}
                  aria-expanded={isOpen}
                  aria-controls={`accordion-content-${item.id}`}
                >
                  <Icon className="w-5 h-5 text-[#81887A] flex-shrink-0" />
                  <span className="flex-1 text-base font-semibold text-[#1a1a1a]">{item.title}</span>
                  <ChevronDown 
                    className={`w-5 h-5 text-[#4a4a4a] transition-transform duration-300 flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`}
                  />
                </button>
                <AnimatePresence>
                  {isOpen && (
                    <motion.div
                      id={`accordion-content-${item.id}`}
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3 }}
                      className="overflow-hidden"
                    >
                      <div className="px-6 pb-6 pl-20">
                        <p className="valley-body text-[#4a4a4a]">
                          {item.content}
                        </p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>

        {/* Divider Below */}
        <div className="valley-divider" />
      </div>
    </section>
  );
};

export default PracticalDetailsAccordion;
