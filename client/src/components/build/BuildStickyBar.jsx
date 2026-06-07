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
    <div className="fixed bottom-0 left-0 right-0 z-[200] border-t border-[#333] bg-[#1a1a1a] text-white">
      <div
        className="mx-auto flex max-w-[1600px] items-center justify-between gap-4 px-4 py-3.5 md:px-10 md:py-4"
        style={{ paddingBottom: 'max(0.875rem, env(safe-area-inset-bottom))' }}
      >
        <div className="flex min-w-0 items-center gap-5 md:gap-10 lg:gap-14">
          {stats.map((stat) => (
            <div key={stat.label} className="flex min-w-0 shrink-0 flex-col gap-1">
              <span className="whitespace-nowrap text-[0.65rem] font-medium uppercase tracking-[0.14em] text-[#b5b5b5] md:text-xs">
                {stat.label}
              </span>
              <span className="whitespace-nowrap text-sm font-semibold tabular-nums text-white md:text-base">
                {stat.value}
              </span>
            </div>
          ))}
        </div>

        <div className="flex shrink-0 items-center gap-2.5 md:gap-3">
          <button
            type="button"
            onClick={onDownloadPDF}
            className="whitespace-nowrap rounded-[2px] border border-[#555] bg-transparent px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.08em] text-white transition-colors hover:border-white md:px-5 md:py-3 md:text-sm"
          >
            Download Spec PDF
          </button>
          <button
            type="button"
            onClick={onScheduleConsultation}
            className="whitespace-nowrap rounded-[2px] bg-white px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.08em] text-[#1a1a1a] transition-colors hover:bg-[#eee] md:px-5 md:py-3 md:text-sm"
          >
            Schedule Consultation
          </button>
        </div>
      </div>
    </div>
  );
};

export default BuildStickyBar;
