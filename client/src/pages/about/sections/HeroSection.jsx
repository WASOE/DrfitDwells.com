import { useState, useRef } from 'react';
import { motion, useInView, AnimatePresence } from 'framer-motion';

const INTRO_PARAGRAPHS = [
  'I used to live in the Netherlands and work all the time.',
  'At some point it stopped working for me.',
  'I burned out.',
];

const EXPANDED_PARAGRAPHS = [
  'Then Covid came and everything slowed down. I did the opposite. I left in a campervan. Not to find myself. I just wanted to feel normal again.',
  'I kept driving and ended up in Bulgaria.',
  'I saw a piece of land there and bought it almost on the spot. I did not sit down and make some big plan. I just felt like doing it.',
  'I started building because winter was coming and I needed shelter.',
  'Then deadlines shifted. Things took longer. Winter arrived, and I was still building.',
  'Nights went to minus 25. The wood was frozen. The ground was hard. There was no signal on the land.',
  'I did not know everything, so I learned while building.',
  'I would walk up the hill to get signal, about 20 minutes up and 20 minutes back down, download YouTube videos, and continue building.',
  'Sometimes the video was wrong. Sometimes I got it wrong. Then I had to walk up again and figure out the next step.',
  'There was no big plan at that point. Mostly just the pressure of the present. What needs to be done now. What can I fix today. What do I need before tonight.',
  'It was slow. It was frustrating. But honestly, it helped me.',
  'I was busy with real things. Measuring. Cutting. Fixing. Trying again. One thing at a time.',
  'And my head got quieter.',
  'When the cabin was done, I realized that place had done a lot for me.',
  'Nothing magical. Just simple things. Quiet. Cold air. Silence. Physical work. Sleeping properly again.',
  'So I put it on Airbnb.',
  'Not because I had some big business idea.',
  'I just thought maybe other people could use the same thing.',
  'People came.',
  'And I kept hearing the same kind of feedback, again and again.',
  'I slept.',
  'I slowed down.',
  'I feel normal again.',
  'That is how Drift & Dwells started.',
  'First it was one cabin.',
  'Then we kept going.',
  'What started as one cabin turned into Drift & Dwells.',
  'We build places that help people slow down and reset. That is the whole point.',
  'Today that means two things for us.',
  'We build and host our own places here in Bulgaria.',
  'And we also build cabins for clients abroad, including in the Netherlands.',
  'Now we are building The Valley, which is the next chapter.',
  'And somewhere in all of that, the first cabin became the number one cabin on Airbnb.',
  'I still think the reason is simple.',
  'It is real.',
  'It is built with care.',
  'And it works.',
];

/*
 * Memory-lane collage — percentage layout on a fixed aspect artboard.
 * Every slot has width + height so portraits cannot blow past the frame.
 * Slight rotations and layered z-index keep the “scattered prints” feel
 * without looking like a broken absolute layout.
 */
const MEMORY_COLLAGE = [
  {
    src: '/uploads/The%20Cabin/22a9d01c-3e9a-4f5f-83b1-ef08b84ad473.jpeg',
    alt: 'Green hills above the cabin',
    left: 2,
    top: 0,
    width: 40,
    height: 44,
    rotate: -3.5,
    zIndex: 1,
    objectPosition: 'center 18%',
  },
  {
    src: '/uploads/Content%20website/Picture-jose-valley.png',
    alt: 'Jose at the valley',
    left: 26,
    top: 8,
    width: 48,
    height: 54,
    rotate: 2,
    zIndex: 5,
    objectPosition: 'center 20%',
  },
  {
    src: '/uploads/The%20Cabin/2b036140-b9f1-48c8-80fe-155be58a9d6a.jpeg',
    alt: 'Cabin interior',
    left: 0,
    top: 50,
    width: 44,
    height: 34,
    rotate: -2,
    zIndex: 2,
    objectPosition: 'center 45%',
  },
  {
    src: '/uploads/Content%20website/SKy-view-Aframe.jpg',
    alt: 'A-frame cabin view',
    left: 38,
    top: 58,
    width: 40,
    height: 28,
    rotate: 3,
    zIndex: 3,
    objectPosition: 'center 40%',
  },
  {
    src: '/uploads/The%20Cabin/011f4645-32ce-4739-ac8e-16a900612ac7.jpeg',
    alt: 'Cabin exterior at sunset',
    left: 66,
    top: 34,
    width: 32,
    height: 50,
    rotate: -2.5,
    zIndex: 2,
    objectPosition: 'center 30%',
  },
];

const CollagePhoto = ({ image, index, isInView }) => (
  <div
    className="group absolute"
    style={{
      left: `${image.left}%`,
      top: `${image.top}%`,
      width: `${image.width}%`,
      height: `${image.height}%`,
      zIndex: image.zIndex,
      // CSS rotate keeps motion transforms free for entrance animation
      rotate: `${image.rotate}deg`,
    }}
  >
    <motion.div
      className="flex h-full w-full flex-col rounded-[10px] bg-white p-[3px]
        shadow-[0_14px_34px_rgba(28,25,23,0.16),0_3px_8px_rgba(28,25,23,0.07)]
        transition-shadow duration-300
        md:rounded-xl md:p-1
        lg:group-hover:shadow-[0_22px_48px_rgba(28,25,23,0.22),0_6px_14px_rgba(28,25,23,0.1)]"
      initial={{ opacity: 0, scale: 0.92, y: 18 }}
      animate={
        isInView
          ? { opacity: 1, scale: 1, y: 0 }
          : { opacity: 0, scale: 0.92, y: 18 }
      }
      transition={{
        duration: 0.7,
        delay: 0.16 + index * 0.09,
        ease: [0.22, 1, 0.36, 1],
      }}
    >
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-[7px] bg-stone-100 md:rounded-[10px]">
        <img
          src={image.src}
          alt={image.alt}
          className="h-full w-full object-cover transition-transform duration-500 ease-out lg:group-hover:scale-[1.03]"
          style={{ objectPosition: image.objectPosition }}
          loading={index < 2 ? 'eager' : 'lazy'}
          decoding="async"
          draggable={false}
        />
      </div>
    </motion.div>
  </div>
);

const MemoryCollage = ({ isInView }) => (
  <div
    className="relative mx-auto w-full max-w-[300px] sm:max-w-[340px] md:max-w-[400px] lg:max-w-[460px] xl:max-w-[500px]"
    style={{ aspectRatio: '5 / 6' }}
    aria-label="A scattered collection of photos from the Drift & Dwells story"
  >
    {/* Soft ground shadow so the cluster reads as one composition */}
    <div
      aria-hidden
      className="pointer-events-none absolute inset-[10%] rounded-[45%] bg-stone-900/[0.05] blur-3xl"
    />
    {MEMORY_COLLAGE.map((image, index) => (
      <CollagePhoto
        key={image.alt}
        image={image}
        index={index}
        isInView={isInView}
      />
    ))}
  </div>
);

const HeroSection = () => {
  const [expanded, setExpanded] = useState(false);
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: '-50px' });

  return (
    <section ref={ref} className="overflow-hidden py-16 md:py-24 lg:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-8 xl:px-12">
        <div className="grid grid-cols-1 items-center gap-12 md:gap-16 lg:grid-cols-2 lg:gap-20 xl:gap-24">
          {/* Left column — story text */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
            transition={{ duration: 0.7, delay: 0.1 }}
            className="max-w-lg"
          >
            <h1
              className="mb-10 text-3xl font-bold leading-[1.15] text-gray-900 md:text-4xl lg:text-[2.75rem]"
              style={{ fontFamily: 'var(--valley-font-primary, Georgia, serif)' }}
            >
              The story of Drift &amp;&nbsp;Dwells
            </h1>

            <div className="space-y-5 text-base leading-relaxed text-gray-700 md:text-[17px]">
              {INTRO_PARAGRAPHS.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              className="mt-8 rounded text-base font-medium text-[#c25530] transition-colors hover:text-[#a8432a] focus:outline-none focus:ring-2 focus:ring-[#c25530]/40"
              style={{
                fontFamily: 'var(--valley-font-primary, Georgia, serif)',
                fontStyle: 'italic',
              }}
            >
              {expanded ? 'Close the story' : 'Read the story'}
            </button>

            <AnimatePresence>
              {expanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.5, ease: 'easeInOut' }}
                  className="overflow-hidden"
                >
                  <div className="space-y-5 pt-6 text-base leading-relaxed text-gray-700 md:text-[17px]">
                    {EXPANDED_PARAGRAPHS.map((p, i) => (
                      <p key={`exp-${i}`}>{p}</p>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <p
              className="mt-12 text-2xl text-gray-900 md:text-3xl"
              style={{
                fontFamily: 'var(--valley-font-primary, Georgia, serif)',
                fontStyle: 'italic',
              }}
            >
              Jose
            </p>
          </motion.div>

          {/* Right column — memory-lane collage */}
          <div className="w-full lg:justify-self-end">
            <MemoryCollage isInView={isInView} />
          </div>
        </div>
      </div>
    </section>
  );
};

export default HeroSection;
