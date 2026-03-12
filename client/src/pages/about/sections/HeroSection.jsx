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
 * Art-directed collage — fixed pixel coordinates on a 440×506 artboard.
 * Pixel values are the exact equivalent of the percentage-based layout
 * that produced the approved screenshot (container was 440px wide at
 * the user's viewport with aspect-ratio 1/1.15 = 506px tall).
 *
 * 5 images, no duplicates, no auto-layout.
 * Heights are intentionally omitted so each photo keeps its natural
 * aspect ratio (just like the approved version did).
 */
const DESKTOP_COLLAGE = [
  {
    src: '/uploads/The%20Cabin/22a9d01c-3e9a-4f5f-83b1-ef08b84ad473.jpeg',
    alt: 'Cabin interior',
    left: 0,
    top: 0,
    width: 211,
    rotate: -3,
    zIndex: 1,
  },
  {
    src: '/uploads/Content%20website/Picture-jose-valley.png',
    alt: 'Jose at the valley',
    left: 132,
    top: 10,
    width: 242,
    rotate: 2,
    zIndex: 3,
  },
  {
    src: '/uploads/The%20Cabin/2b036140-b9f1-48c8-80fe-155be58a9d6a.jpeg',
    alt: 'Hot tub in the mountains',
    left: -22,
    top: 278,
    width: 194,
    rotate: -2,
    zIndex: 1,
  },
  {
    src: '/uploads/Content%20website/SKy-view-Aframe.jpg',
    alt: 'A-frame cabin view',
    left: 154,
    top: 263,
    width: 167,
    rotate: 4,
    zIndex: 2,
  },
  {
    src: '/uploads/The%20Cabin/011f4645-32ce-4739-ac8e-16a900612ac7.jpeg',
    alt: 'Cabin exterior',
    left: 264,
    top: 293,
    width: 176,
    rotate: -3,
    zIndex: 1,
  },
];

const MOBILE_COLLAGE = [
  {
    src: '/uploads/The%20Cabin/22a9d01c-3e9a-4f5f-83b1-ef08b84ad473.jpeg',
    alt: 'Cabin interior',
    left: 0,
    top: 0,
    width: 140,
    rotate: -3,
    zIndex: 1,
  },
  {
    src: '/uploads/Content%20website/Picture-jose-valley.png',
    alt: 'Jose at the valley',
    left: 88,
    top: 8,
    width: 168,
    rotate: 2,
    zIndex: 3,
  },
  {
    src: '/uploads/The%20Cabin/2b036140-b9f1-48c8-80fe-155be58a9d6a.jpeg',
    alt: 'Hot tub in the mountains',
    left: -10,
    top: 192,
    width: 134,
    rotate: -2,
    zIndex: 1,
  },
  {
    src: '/uploads/The%20Cabin/011f4645-32ce-4739-ac8e-16a900612ac7.jpeg',
    alt: 'Cabin exterior',
    left: 178,
    top: 200,
    width: 120,
    rotate: -3,
    zIndex: 1,
  },
];

const CollageImage = ({ image, eager = false }) => (
  <div
    className="absolute overflow-hidden rounded-lg shadow-lg"
    style={{
      left: `${image.left}px`,
      top: `${image.top}px`,
      width: `${image.width}px`,
      zIndex: image.zIndex,
      transform: `rotate(${image.rotate}deg)`,
      transformOrigin: 'center center',
    }}
  >
    <img
      src={image.src}
      alt={image.alt}
      className="w-full h-auto object-cover"
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
    />
  </div>
);

const HeroSection = () => {
  const [expanded, setExpanded] = useState(false);
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: '-50px' });

  return (
    <section ref={ref} className="py-16 md:py-24 lg:py-32 overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-8 xl:px-12">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-start">
          {/* Left column — story text */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
            transition={{ duration: 0.7, delay: 0.1 }}
            className="max-w-lg"
          >
            <h1
              className="text-3xl md:text-4xl lg:text-[2.75rem] font-bold leading-[1.15] text-gray-900 mb-10"
              style={{ fontFamily: 'var(--valley-font-primary, Georgia, serif)' }}
            >
              The story of Drift &amp;&nbsp;Dwells
            </h1>

            <div className="space-y-5 text-base md:text-[17px] leading-relaxed text-gray-700">
              {INTRO_PARAGRAPHS.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setExpanded(prev => !prev)}
              className="mt-8 text-[#c25530] hover:text-[#a8432a] text-base font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-[#c25530]/40 rounded"
              style={{ fontFamily: 'var(--valley-font-primary, Georgia, serif)', fontStyle: 'italic' }}
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
                  <div className="space-y-5 text-base md:text-[17px] leading-relaxed text-gray-700 pt-6">
                    {EXPANDED_PARAGRAPHS.map((p, i) => (
                      <p key={`exp-${i}`}>{p}</p>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <p
              className="mt-12 text-2xl md:text-3xl text-gray-900"
              style={{ fontFamily: 'var(--valley-font-primary, Georgia, serif)', fontStyle: 'italic' }}
            >
              Jose
            </p>
          </motion.div>

          {/* Right column — art-directed collage (desktop) */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={isInView ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.8, delay: 0.3 }}
            className="relative hidden md:block"
            style={{ aspectRatio: '1 / 1.15' }}
          >
            {DESKTOP_COLLAGE.map((image, i) => (
              <CollageImage key={image.alt} image={image} eager={i < 2} />
            ))}
          </motion.div>

          {/* Mobile — separate manually tuned collage */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={isInView ? { opacity: 1 } : { opacity: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="relative md:hidden mx-auto w-full max-w-[310px]"
            style={{ aspectRatio: '310 / 310' }}
          >
            {MOBILE_COLLAGE.map((image, i) => (
              <CollageImage key={`${image.alt}-m`} image={image} eager={i < 2} />
            ))}
          </motion.div>
        </div>
      </div>
    </section>
  );
};

export default HeroSection;
