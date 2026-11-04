import DocumentViewer from './DocumentViewer';

const CancellationPolicy = () => {
  return (
    <DocumentViewer
      title="Cancellation Policy"
      description="Understand cancellation windows, refunds, and related booking conditions for Drift & Dwells stays. The current Cancellation Policy document is embedded below for checkout and guest reference."
      canonicalPath="/cancellation-policy"
      noindex
      pdfPath="/legal/cancellation-policy-2026-10-12-v2.pdf"
      fileName="drift-dwells-cancellation-policy.pdf"
    />
  );
};

export default CancellationPolicy;
