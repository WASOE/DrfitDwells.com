const BuildStickyBar = ({
  dimensions,
  area,
  capacity,
  price,
  onDownloadPDF,
  onScheduleConsultation,
}) => {
  const stats = [
    { label: 'Dimensions', value: dimensions || '—' },
    { label: 'Area', value: area || '—' },
    { label: 'Capacity', value: capacity || '—' },
    { label: 'Price', value: price || '—' },
  ];

  return (
    <div className="fixed bottom-0 right-0 z-[200] flex h-[60px] w-full items-center justify-between border-l border-[#333] bg-[#1a1a1a] px-4 text-white sm:px-6 lg:w-[460px] lg:px-8">
      <div className="flex flex-wrap gap-3 sm:gap-7">
        {stats.map((stat) => (
          <div key={stat.label} className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[0.55rem] uppercase tracking-[0.14em] text-[#888]">
              {stat.label}
            </span>
            <span className="truncate text-[0.72rem] font-normal text-white sm:text-[0.82rem]">
              {stat.value}
            </span>
          </div>
        ))}
      </div>

      <div className="hidden shrink-0 items-center gap-2 sm:flex">
        <button
          type="button"
          onClick={onDownloadPDF}
          className="rounded-[2px] border border-[#555] bg-transparent px-3 py-2 text-[0.62rem] uppercase tracking-[0.1em] text-white transition-colors hover:border-white"
        >
          Download Spec PDF
        </button>
        <button
          type="button"
          onClick={onScheduleConsultation}
          className="rounded-[2px] bg-white px-3 py-2 text-[0.62rem] font-medium uppercase tracking-[0.1em] text-[#1a1a1a] transition-colors hover:bg-[#eee]"
        >
          Schedule Consultation
        </button>
      </div>
    </div>
  );
};

export default BuildStickyBar;
