import {
  buildSummaryRows,
  computeBuildTotal,
  formatBuildBarPrice,
} from '../../data/buildConfiguratorLogic.js';
import { BUILD_CONSULTATION_URL } from '../../data/buildConsultation.js';
import { SUMMARY_REVIEWS } from '../../data/buildConfiguratorSchema.js';

const BuildSummary = ({
  state,
  model,
  onDownloadPDF,
  padX = 'px-8',
  omitActions = false,
}) => {
  const rows = buildSummaryRows(state);
  const pricing = computeBuildTotal(state);
  const totalLabel = formatBuildBarPrice(pricing);

  return (
    <div className={`${padX} py-8`}>
      <div className="mb-6 flex h-[60px] w-[60px] items-center justify-center rounded-full border border-[#e0e0e0] bg-[#faf9f7] text-2xl">
        🏡
      </div>

      <h2 className="mb-2 font-serif text-[2.2rem] font-normal leading-tight text-[#1a1a1a]">
        Your cabin
        <br />
        is ready to build.
      </h2>
      <p className="mb-8 text-[0.8rem] leading-relaxed text-[#5a5a5a]">
        Here is what you&apos;ve configured. Schedule a free consultation and we&apos;ll walk
        your land together — no obligation, just a real conversation about what&apos;s possible.
      </p>

      <div className="mb-8 flex flex-col gap-0.5">
        {rows.map((row) => (
          <div
            key={`${row.key}-${row.value}`}
            className="flex justify-between border-b border-[#e0e0e0] py-2.5 text-[0.8rem]"
          >
            <span className="text-[#9a9a9a]">{row.key}</span>
            <span className="max-w-[55%] text-right font-medium text-[#1a1a1a]">{row.value}</span>
          </div>
        ))}
      </div>

      <div className="mb-6 flex flex-col items-center gap-1 rounded-[2px] bg-[#1a1a1a] px-6 py-6 text-center text-white">
        <div className="text-[0.6rem] uppercase tracking-[0.14em] text-[#888]">Your estimate</div>
        <div className="font-serif text-[2.8rem] font-light leading-none">{totalLabel}</div>
        <div className="text-[0.7rem] text-[#888]">All-inclusive. Delivery &amp; installation included.</div>
      </div>

      {model.summaryNote ? (
        <p className="mb-6 text-[0.78rem] leading-relaxed text-[#5a5a5a]">{model.summaryNote}</p>
      ) : null}

      {omitActions ? null : (
        <>
          <a
            href={BUILD_CONSULTATION_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mb-3 block w-full rounded-[2px] bg-[#1a1a1a] px-4 py-4 text-center text-[0.7rem] font-medium uppercase tracking-[0.14em] text-white no-underline transition-colors hover:bg-[#2b2b2b]"
          >
            Schedule a free consultation
          </a>
          <button
            type="button"
            onClick={onDownloadPDF}
            className="mb-6 w-full rounded-[2px] border border-[#e0e0e0] px-4 py-3.5 text-[0.7rem] uppercase tracking-[0.14em] text-[#5a5a5a] transition-colors hover:border-[#1a1a1a] hover:text-[#1a1a1a]"
          >
            Download spec PDF
          </button>
        </>
      )}

      <div className="rounded-[2px] bg-[#faf9f7] p-5">
        <div className="mb-3 text-[0.6rem] uppercase tracking-[0.12em] text-[#9a9a9a]">
          People have already paid to stay in a cabin like yours. Their honest reaction:
        </div>
        {SUMMARY_REVIEWS.map((review) => (
          <div
            key={review.author}
            className="border-b border-[#e0e0e0] py-2 text-[0.76rem] leading-relaxed text-[#5a5a5a] last:border-b-0"
          >
            &ldquo;{review.quote}&rdquo;
            <strong className="mt-1 block text-[0.68rem] text-[#1a1a1a]">{review.author}</strong>
          </div>
        ))}
      </div>
    </div>
  );
};

export default BuildSummary;
