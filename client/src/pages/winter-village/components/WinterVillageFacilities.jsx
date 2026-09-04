import { motion } from 'framer-motion';
import { WINTER_VILLAGE_FACILITIES } from '../winterVillageConfig';

export default function WinterVillageFacilities({ prefersReducedMotion }) {
  return (
    <section className="valley-section" aria-labelledby="wv-facilities-heading">
      <div className="valley-container">
        <p className="valley-label mb-3">{WINTER_VILLAGE_FACILITIES.statusLabel}</p>
        <h2 id="wv-facilities-heading" className="valley-h2 mb-4 max-w-3xl">
          {WINTER_VILLAGE_FACILITIES.title}
        </h2>
        <p className="valley-intro mb-10 md:mb-12 max-w-2xl">{WINTER_VILLAGE_FACILITIES.intro}</p>

        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-5 max-w-5xl">
          {WINTER_VILLAGE_FACILITIES.items.map((item, index) => (
            <motion.li
              key={item}
              initial={prefersReducedMotion ? false : { opacity: 0, y: 12 }}
              whileInView={prefersReducedMotion ? undefined : { opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.45, delay: index * 0.04 }}
              className="border border-[rgba(0,0,0,0.12)] rounded-xl bg-white p-5 md:p-6"
            >
              <p className="font-serif text-lg text-[#1a1a1a] font-semibold leading-snug mb-2">
                {item}
              </p>
              <p className="text-xs uppercase tracking-[0.1em] text-[#81887A]">
                {WINTER_VILLAGE_FACILITIES.statusLabel}
              </p>
            </motion.li>
          ))}
        </ul>
      </div>
    </section>
  );
}
