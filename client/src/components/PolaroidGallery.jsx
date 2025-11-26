import { useMemo } from 'react';
import { motion } from 'framer-motion';

const galleryImages = [
  { src: '/uploads/Content%20website/drift-dwells-bulgaria-campfire-night.avif', caption: 'Firelight letters', memory: 'The fire crackled while letters from home were read aloud.' },
  { src: '/uploads/Content%20website/drift-dwells-bulgaria-lantern-walk.png', caption: 'Lantern trail', memory: 'Pines glowed gold as lanterns guided the midnight walk.' },
  { src: '/uploads/Content%20website/drift-dwells-bulgaria-river-letters.avif', caption: 'River post', memory: 'We floated notes downstream to future versions of ourselves.' },
  { src: '/uploads/Content%20website/drift-dwells-bulgaria-starlit-mountain.avif', caption: 'Stargazer ridge', memory: 'The Milky Way felt close enough to stir with a spoon.' },
  { src: '/uploads/Content%20website/drift-dwells-bulgaria-rainy-eaves.avif', caption: 'Rain hymns', memory: 'Rain on cedar became the night’s only orchestra.' },
  { src: '/uploads/Content%20website/drift-dwells-bulgaria-bucephalus-suite.avif', caption: 'Bucephalus nook', memory: 'We framed our vows between stone hearth and glass.' },
  { src: '/uploads/Content%20website/drift-dwells-bulgaria-valley-haven.avif', caption: 'Valley hush', memory: 'Mornings were syrup slow with fog and honeyed tea.' },
  { src: '/uploads/Content%20website/drift-dwells-bulgaria-fireside-lounge.avif', caption: 'Fireside vows', memory: 'Light and smoke braided together in the lodge.' },
  { src: '/uploads/Content%20website/drift-dwells-bulgaria-meadow-trail.avif', caption: 'Meadow dash', memory: 'Bare feet, wet grass, and the call of distant cowbells.' },
  { src: '/uploads/Content%20website/drift-dwells-bulgaria-cabin-path.png', caption: 'Cabin path', memory: 'Mossy planks remembered every muddy boot print.' },
  { src: '/uploads/Content%20website/drift-dwells-bulgaria-lake-dawn.png', caption: 'Lake hush', memory: 'Steam rose off the lake like whispered folklore.' },
  { src: '/uploads/Content%20website/drift-dwells-bulgaria-fern-study.png', caption: 'Fern study', memory: 'Pressed ferns mapped every turn of the hidden trail.' }
];

const offsetsY = [-32, -12, 0, 18, -20, 24];
const offsetsX = [-18, 0, 12, -24, 16];

const PolaroidGallery = () => {
  const stackedMemories = useMemo(() => {
    return galleryImages.map((item, index) => {
      const rotation = Math.round((Math.random() * 24 - 12) * 10) / 10;
      return {
        id: `memory-${index}`,
        ...item,
        date: `20${(12 + index).toString().padStart(2, '0')}`,
        rotation,
        offsetY: offsetsY[index % offsetsY.length],
        offsetX: offsetsX[index % offsetsX.length]
      };
    });
  }, []);

  const renderCard = (memory) => (
    <motion.div
      key={memory.id}
      className="relative cursor-pointer transition-transform duration-300 group"
      style={{
        marginTop: `${memory.offsetY}px`,
        marginLeft: `${memory.offsetX}px`
      }}
      initial={{ rotate: memory.rotation }}
      whileHover={{ rotate: 0, scale: 1.1, zIndex: 50, boxShadow: '0 35px 90px rgba(10,16,12,0.45)' }}
    >
      <div className="w-full max-w-[280px] md:max-w-[240px] lg:max-w-[220px] perspective snap-center">
        <div className="relative w-full h-[360px] md:h-[320px]">
          <div className="absolute inset-0 bg-white/95 p-5 rounded-[18px] shadow-[0_25px_60px_rgba(12,26,20,0.2)] transition duration-300">
            <div className="h-full flex flex-col">
              <div className="flex-1 overflow-hidden rounded-[12px]">
                <img
                  src={memory.src}
                  alt={memory.caption}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              </div>
              <p className="font-['Caveat'] text-xl text-gray-800 text-center mt-3">
                {memory.caption}
              </p>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );

  return (
    <section className="relative py-10 md:py-32 bg-[#F5F2EC] overflow-hidden">
      <div className="max-w-6xl mx-auto px-4 md:px-12">
        <div className="text-center mb-8 md:mb-16">
          <p className="text-xs tracking-[0.4em] text-gray-500 uppercase mb-4">Memories</p>
          <h2 className="font-['Playfair_Display'] text-3xl md:text-5xl text-gray-900">
            Moments Captured
          </h2>
          <p className="font-['Merriweather'] text-base md:text-lg text-gray-600 italic mt-4">
            A table of stories—pick them up, feel the grain, stay awhile.
          </p>
        </div>

        {/* Mobile horizontal stack */}
        <div className="md:hidden flex gap-4 overflow-x-auto pb-4 snap-x snap-mandatory -mx-4 px-4">
          {stackedMemories.map((memory) => renderCard(memory))}
        </div>

        {/* Desktop Masonry */}
        <div className="hidden md:grid grid-cols-2 lg:grid-cols-4 gap-6 md:gap-8">
          {stackedMemories.map((memory) => (
            <div key={`${memory.id}-desktop`} className="-m-4">
              {renderCard(memory)}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default PolaroidGallery;

