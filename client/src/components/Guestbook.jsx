import { useRef } from 'react';
import { motion, useInView } from 'framer-motion';

const guestNotes = [
  {
    id: 'note-1',
    text: 'Left the phones in the drawer and heard the creek compose a lullaby for us.',
    author: '— Mira & Theo'
  },
  {
    id: 'note-2',
    text: 'We brewed pine needle tea at dawn. The steam looked like soft handwriting.',
    author: '— Daniela'
  },
  {
    id: 'note-3',
    text: 'The journal we found on the shelf had pressed ferns from guests we will never meet.',
    author: '— Petra & Ivo'
  }
];

const doodles = [
  { id: 'pine', className: 'top-10 left-8 rotate-3', color: '#4A6A57' },
  { id: 'coffee', className: 'bottom-16 right-10 rotate-[-12deg]', color: '#A56B4F' },
  { id: 'arrow', className: 'top-1/2 left-1/2 rotate-6', color: '#2F3A33' }
];

const entryVariants = {
  hidden: { opacity: 0, clipPath: 'inset(0 100% 0 0)' },
  visible: (index) => ({
    opacity: 1,
    clipPath: 'inset(0 0% 0 0)',
    transition: {
      duration: 1.8,
      ease: [0.25, 0.1, 0.25, 1],
      delay: index * 0.4
    }
  })
};

const Guestbook = () => {
  const sectionRef = useRef(null);
  const isInView = useInView(sectionRef, { once: true, amount: 0.3 });

  return (
    <section
      ref={sectionRef}
      className="relative py-10 md:py-32 px-4 md:px-12"
    >
      <div className="max-w-4xl mx-auto relative">
        {doodles.map((doodle) => (
          <svg
            key={doodle.id}
            className={`absolute opacity-20 ${doodle.className}`}
            width="120"
            height="120"
            viewBox="0 0 120 120"
            fill="none"
          >
            <path
              d="M20 60 C40 20, 80 100, 100 40"
              stroke={doodle.color}
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray="6 10"
            />
          </svg>
        ))}

        <div className="text-center mb-10 md:mb-14">
          <p className="text-xs uppercase tracking-[0.4em] text-gray-500 mb-3">Guestbook</p>
          <h2 className="font-['Playfair_Display'] text-3xl md:text-5xl text-[#1d2a1f]">
            Living Notes
          </h2>
          <p className="font-['Merriweather'] text-base md:text-lg text-gray-600 italic mt-3">
            Ink that keeps moving long after guests depart.
          </p>
        </div>

        <div className="space-y-8 md:space-y-12">
          {guestNotes.map((entry, index) => (
            <motion.div
              key={entry.id}
              custom={index}
              variants={entryVariants}
              initial="hidden"
              animate={isInView ? 'visible' : 'hidden'}
            >
              <p className="font-['Caveat'] text-xl md:text-4xl text-[#1c1917] leading-snug">{entry.text}</p>
              <span className="font-['Caveat'] text-lg md:text-xl text-stone-600 block mt-3">
                {entry.author}
              </span>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Guestbook;

