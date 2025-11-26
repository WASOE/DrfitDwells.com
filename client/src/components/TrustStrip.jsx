import { home } from '../data/content';

const TrustStrip = () => {
  return (
    <section className="py-8 border-b border-stone-200 bg-[#F7F4EE]">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-8 max-w-6xl mx-auto px-4 md:px-12">
        {home.trust.map((item, index) => (
          <div key={index} className="text-center">
            <p className="font-serif text-xl text-stone-900 mb-1">{item.label}</p>
            <p className="font-sans text-xs uppercase tracking-widest text-stone-500">{item.sub}</p>
          </div>
        ))}
      </div>
    </section>
  );
};

export default TrustStrip;


