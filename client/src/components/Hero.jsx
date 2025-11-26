import { motion } from 'framer-motion';
import SearchBar from './SearchBar';
import { home } from '../data/content';

const Hero = () => {

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.08,
        delayChildren: 0.2
      }
    }
  };

  const letterVariants = {
    hidden: { opacity: 0, y: 30 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] }
    }
  };

  return (
    <section className="relative h-screen flex flex-col justify-end overflow-hidden">
      <div className="absolute inset-0">
        <iframe
          title="Drift & Dwells Hero Reel"
          src="https://player.vimeo.com/video/953299334?h=944861e8ef&autoplay=1&muted=1&loop=1&background=1&app_id=122963"
          className="w-full h-full pointer-events-none"
          allow="autoplay; fullscreen; picture-in-picture; clipboard-write; encrypted-media; web-share"
          referrerPolicy="strict-origin-when-cross-origin"
          frameBorder="0"
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            width: '120vw',
            height: '120vh',
            transform: 'translate(-50%, -50%)'
          }}
        />
      </div>

      <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.5) 0%, transparent 25%)' }} />
      <div className="absolute top-6 right-4 md:right-10 text-[10px] md:text-xs tracking-[0.4em] text-white/80 uppercase z-30">
        Bachevo, Bulgaria
      </div>

      <div className="relative z-10 px-6 sm:px-6 md:px-12 pt-24 sm:pt-32 md:pt-40 pb-8 sm:pb-10 md:pb-20 flex flex-col items-center text-center space-y-4 sm:space-y-6 md:space-y-8">
        <motion.h1
          className="font-['Playfair_Display'] text-4xl md:text-6xl lg:text-7xl text-white font-semibold tracking-tight leading-[1.1] drop-shadow-md max-w-4xl mx-auto"
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          Drift into the Wild.<br className="hidden md:block" /> Dwell in the Silence.
        </motion.h1>

        <p className="font-['Merriweather'] text-lg md:text-xl text-white/90 font-light mt-6 max-w-2xl mx-auto drop-shadow-md">
          Two distinct paths to the same peace.<br className="hidden md:block" /> Choose your sanctuary in the heart of the Balkans.
        </p>

        <motion.div
          className="w-full max-w-5xl px-2"
          whileHover={{ scale: 1.02 }}
          transition={{ type: 'spring', stiffness: 140, damping: 18 }}
        >
          <div className="bg-white/40 border border-white/30 backdrop-blur-md rounded-2xl md:rounded-full p-3 sm:p-4 md:p-6 shadow-[0_20px_50px_rgba(12,26,19,0.2)] transition-all duration-300 hover:bg-white/60 hover:border-white/80">
            <SearchBar buttonTheme="hero" variant="glass" />
          </div>
        </motion.div>

        <div className="text-white/80 font-['Caveat'] text-base sm:text-lg md:text-xl flex items-center gap-2 sm:gap-3 px-4">
          <span className="inline-flex h-px w-8 sm:w-12 bg-white/40" />
          <span className="whitespace-nowrap">Your next cabin chapter begins below</span>
          <span className="inline-flex h-px w-8 sm:w-12 bg-white/40" />
        </div>
      </div>
    </section>
  );
};

export default Hero;
