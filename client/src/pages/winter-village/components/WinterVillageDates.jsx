import { WINTER_VILLAGE_DATES } from '../winterVillageConfig';

export default function WinterVillageDates({ onSelectDate }) {
  return (
    <section className="valley-section" aria-labelledby="wv-dates-heading">
      <div className="valley-container" style={{ maxWidth: '900px' }}>
        <p className="valley-label mb-3">{WINTER_VILLAGE_DATES.sectionLabel}</p>
        <h2 id="wv-dates-heading" className="valley-h2 mb-4">
          Proposed dates
        </h2>
        <p className="valley-intro mb-8 md:mb-10 max-w-2xl">{WINTER_VILLAGE_DATES.intro}</p>

        <ul className="border border-[rgba(0,0,0,0.12)] rounded-xl overflow-hidden bg-white divide-y divide-[rgba(0,0,0,0.12)]">
          {WINTER_VILLAGE_DATES.items.map((item) => (
            <li
              key={item.id}
              className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-5 md:p-6"
            >
              <div>
                <p className="text-sm uppercase tracking-[0.12em] text-[#81887A] mb-1">
                  {item.label}
                </p>
                <h3 className="font-serif text-xl md:text-2xl text-[#1a1a1a] font-semibold">
                  {item.title}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => onSelectDate(item.productId)}
                className="inline-flex items-center justify-center border border-[#1a1a1a]/30 text-[#1a1a1a] px-6 py-3 font-medium uppercase tracking-wider text-xs hover:bg-[#1a1a1a]/5 transition-colors min-h-[44px] shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#81887A]"
              >
                View package
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
