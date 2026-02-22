import { motion } from 'framer-motion';
import { Mountain, Flame, Trees, Sparkles } from 'lucide-react';
import { getSEOAlt } from '../../../data/imageMetadata';

const StoryHighlightsSection = () => {
  // Photo band image - fire/hot tub/people moment
  const momentImage = {
    path: '/uploads/Content website/drift-dwells-bulgaria-fireside-lounge.avif',
    encoded: '/uploads/Content%20website/drift-dwells-bulgaria-fireside-lounge.avif',
    alt: 'Communal fireside lounge interior at The Valley Stone House showing fireplace, comfortable seating, and cozy gathering space for guests, Rhodope Mountains'
  };

  return (
    <section className="relative py-24 md:py-32 border-t border-white/15">
      <div className="max-w-7xl mx-auto px-4 md:px-6">
        {/* Split Layout - No Card Background */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 mb-24 md:mb-28">
          {/* Left: Story */}
          <div className="flex flex-col justify-center">
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8 }}
              className="text-lg md:text-xl lg:text-2xl text-[#e8e8e8] leading-relaxed font-serif max-w-[65ch]"
              style={{ lineHeight: '1.6' }}
            >
              The Valley is a small, walkable mountain village made up of several cabins, a stone house, and shared outdoor spaces. Each stay is private, but the land itself is shared, creating a quiet sense of togetherness without obligation. Days here are unstructured—guests hike, read, cook, sit by the fire, and do very little on purpose.
            </motion.p>
          </div>

          {/* Right: Highlights - Simple List */}
          <div className="flex flex-col justify-center">
            <div className="space-y-6">
              {/* Altitude and views */}
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: 0.1 }}
                className="flex items-start gap-4 pb-6 border-b border-white/15"
              >
                <div className="flex-shrink-0 mt-1">
                  <Mountain className="w-5 h-5 text-[#81887A]" strokeWidth={1.5} />
                </div>
                <div>
                  <h3 className="text-lg font-medium text-white mb-2">Altitude and views</h3>
                  <p className="text-base text-[#e8e8e8] leading-relaxed" style={{ lineHeight: '1.6' }}>1,550m above sea level, above the clouds, with panoramic mountain vistas.</p>
                </div>
              </motion.div>

              {/* Fire, hot tub, stargazing */}
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: 0.2 }}
                className="flex items-start gap-4 pb-6 border-b border-white/15"
              >
                <div className="flex-shrink-0 mt-1">
                  <Flame className="w-5 h-5 text-[#81887A]" strokeWidth={1.5} />
                </div>
                <div>
                  <h3 className="text-lg font-medium text-white mb-2">Fire, hot tub, stargazing</h3>
                  <p className="text-base text-[#e8e8e8] leading-relaxed" style={{ lineHeight: '1.6' }}>Communal fire pit, hot tub experiences, and exceptional stargazing under dark mountain skies.</p>
                </div>
              </motion.div>

              {/* Adventure base */}
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: 0.3 }}
                className="flex items-start gap-4 pb-6 border-b border-white/15"
              >
                <div className="flex-shrink-0 mt-1">
                  <Trees className="w-5 h-5 text-[#81887A]" strokeWidth={1.5} />
                </div>
                <div>
                  <h3 className="text-lg font-medium text-white mb-2">Adventure base</h3>
                  <p className="text-base text-[#e8e8e8] leading-relaxed" style={{ lineHeight: '1.6' }}>ATV trails, hiking routes, and mountain exploration right from the village.</p>
                </div>
              </motion.div>

              {/* Quiet, privacy, nature */}
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: 0.4 }}
                className="flex items-start gap-4"
              >
                <div className="flex-shrink-0 mt-1">
                  <Sparkles className="w-5 h-5 text-[#81887A]" strokeWidth={1.5} />
                </div>
                <div>
                  <h3 className="text-lg font-medium text-white mb-2">Quiet, privacy, nature</h3>
                  <p className="text-base text-[#e8e8e8] leading-relaxed" style={{ lineHeight: '1.6' }}>Space, silence, and autonomy while the essentials are handled and everything works.</p>
                </div>
              </motion.div>
            </div>
          </div>
        </div>

        {/* Photo Band - Full Width */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="relative w-full h-[50vh] md:h-[60vh] rounded-2xl overflow-hidden"
        >
          <div 
            className="absolute inset-0 bg-cover bg-center"
            style={{
              backgroundImage: `url(${momentImage.encoded})`,
            }}
            role="img"
            aria-label={getSEOAlt(momentImage.path) || momentImage.alt}
          />
          <div className="absolute inset-0 bg-black/20" />
        </motion.div>
      </div>
    </section>
  );
};

export default StoryHighlightsSection;
