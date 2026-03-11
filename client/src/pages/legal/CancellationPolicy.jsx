import DocumentViewer from './DocumentViewer';

const CancellationPolicy = () => {
  return (
    <DocumentViewer
      title="Cancellation Policy"
      description="Understand our cancellation and refund policy for bookings at Drift & Dwells eco-retreat cabins."
      canonicalPath="/cancellation-policy"
      noindex
      pdfPath="/uploads/PDFs/drift-dwells-docs-v2/cancellation-policy.pdf"
      fileName="drift-dwells-cancellation-policy.pdf"
    />
  );
};

export default CancellationPolicy;
