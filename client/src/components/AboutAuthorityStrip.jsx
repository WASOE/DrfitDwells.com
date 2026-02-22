const AboutAuthorityStrip = () => {
  return (
    <section className="relative bg-[#F9F9F7] py-20 border-y border-[#E5E5E0]">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-12 md:gap-0 items-start justify-items-center">
          <div className="flex flex-col items-center text-center w-full px-8 md:border-r md:border-[#D6D6D3]">
            <div className="h-12 flex items-center mb-6">
              <span className="text-2xl font-bold text-[#1c1917] tracking-tight opacity-0">Spacer</span>
            </div>
            <div className="text-4xl font-serif text-[#1c1917] mb-2">4.95</div>
            <div className="text-[10px] uppercase tracking-[0.25em] text-stone-500 font-medium">Top 1% of Homes</div>
          </div>

          <div className="flex flex-col items-center text-center w-full px-8 md:border-r md:border-[#D6D6D3]">
            <div className="h-12 flex items-center mb-6 mt-2">
              <span className="text-2xl font-bold text-[#1c1917] tracking-tight opacity-0">Spacer</span>
            </div>
            <div className="text-4xl font-serif text-[#1c1917] mb-2">9.8</div>
            <div className="text-[10px] uppercase tracking-[0.25em] text-stone-500 font-medium">Traveller Review Awards</div>
          </div>

          <div className="flex flex-col items-center text-center w-full px-8">
            <div className="h-14 flex items-center mb-4">
              <span className="text-2xl font-bold text-[#1c1917] tracking-tight opacity-0">Spacer</span>
            </div>
            <div className="text-4xl font-serif text-[#1c1917] mb-2">5.0</div>
            <div className="text-[10px] uppercase tracking-[0.25em] text-stone-500 font-medium">Travelers' Choice</div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default AboutAuthorityStrip;
