import { BUILD_CONSULTATION_URL } from '../../data/buildConsultation.js';

const BuildEnquirySuccess = ({
  projectReference,
  onDownloadPDF,
  onClose,
  onStartAnother
}) => {
  return (
    <div className="px-1 py-2" data-testid="build-enquiry-success">
      <p className="mb-2 text-[0.62rem] font-medium uppercase tracking-[0.14em] text-[#9a9a9a]">
        Enquiry received
      </p>
      <h2
        id="build-enquiry-success-title"
        className="mb-3 font-serif text-[1.75rem] font-normal leading-tight text-[#1a1a1a]"
      >
        We have your project details.
      </h2>
      <p className="mb-6 text-[0.85rem] leading-relaxed text-[#5a5a5a]">
        Your enquiry was saved successfully. Use this reference if you contact us about this
        configuration.
      </p>

      <div className="mb-6 rounded-[2px] border border-[#e0e0e0] bg-[#faf9f7] px-4 py-4">
        <div className="text-[0.62rem] uppercase tracking-[0.12em] text-[#9a9a9a]">
          Project reference
        </div>
        <div
          className="mt-1 font-mono text-base font-semibold tracking-wide text-[#1a1a1a]"
          data-testid="build-enquiry-project-reference"
        >
          {projectReference}
        </div>
      </div>

      <a
        href={BUILD_CONSULTATION_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="mb-3 block w-full rounded-[2px] bg-[#1a1a1a] px-4 py-4 text-center text-[0.7rem] font-medium uppercase tracking-[0.14em] text-white no-underline transition-colors hover:bg-[#2b2b2b]"
        data-testid="build-enquiry-consultation-cta"
      >
        Schedule a free consultation
      </a>

      <button
        type="button"
        onClick={onDownloadPDF}
        className="mb-3 w-full rounded-[2px] border border-[#e0e0e0] px-4 py-3.5 text-[0.7rem] uppercase tracking-[0.14em] text-[#5a5a5a] transition-colors hover:border-[#1a1a1a] hover:text-[#1a1a1a]"
      >
        Download spec PDF
      </button>

      <div className="flex gap-2">
        {onStartAnother ? (
          <button
            type="button"
            onClick={onStartAnother}
            className="flex-1 rounded-[2px] border border-[#e0e0e0] px-4 py-3 text-[0.68rem] uppercase tracking-[0.1em] text-[#5a5a5a] transition-colors hover:border-[#1a1a1a]"
          >
            New enquiry
          </button>
        ) : null}
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-[2px] border border-[#e0e0e0] px-4 py-3 text-[0.68rem] uppercase tracking-[0.1em] text-[#5a5a5a] transition-colors hover:border-[#1a1a1a]"
          >
            Close
          </button>
        ) : null}
      </div>
    </div>
  );
};

export default BuildEnquirySuccess;
