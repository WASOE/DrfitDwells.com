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
    <div className="fixed bottom-0 left-0 right-0 z-[200] h-[60px] border-t border-[#333] bg-[#1a1a1a] text-white">
      <div className="mx-auto flex h-full max-w-[1600px] items-center justify-between gap-4 px-6 lg:px-10">
        <div className="flex min-w-0 items-center gap-6 lg:gap-12">
          {stats.map((stat) => (
            <div key={stat.label} className="flex min-w-0 shrink-0 flex-col gap-0.5">
              <span className="whitespace-nowrap text-[0.55rem] uppercase tracking-[0.14em] text-[#888]">
                {stat.label}
              </span>
              <span className="whitespace-nowrap text-[0.82rem] font-normal text-white">
                {stat.value}
              </span>
            </div>
          ))}
        </div>

        <div className="flex shrink-0 items-center gap-2.5">
          <button
            type="button"
            onClick={onDownloadPDF}
            className="whitespace-nowrap rounded-[2px] border border-[#555] bg-transparent px-4 py-2.5 text-[0.62rem] uppercase tracking-[0.1em] text-white transition-colors hover:border-white"
          >
            Download Spec PDF
          </button>
          <button
            type="button"
            onClick={onScheduleConsultation}
            className="whitespace-nowrap rounded-[2px] bg-white px-4 py-2.5 text-[0.62rem] font-medium uppercase tracking-[0.1em] text-[#1a1a1a] transition-colors hover:bg-[#eee]"
          >
            Schedule Consultation
          </button>
        </div>
      </div>
    </div>
  );
};

export default BuildStickyBar;
