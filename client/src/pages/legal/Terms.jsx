import DocumentViewer from './DocumentViewer';

const Terms = () => {
  return (
    <DocumentViewer
      title="Terms & Conditions"
      description="Please read our terms and conditions carefully before making a booking. These terms govern your stay at Drift & Dwells eco-retreat cabins."
      canonicalPath="/terms"
      noindex
      pdfPath="/legal/terms-2026-04-19-v2.pdf"
      fileName="drift-dwells-terms-and-conditions.pdf"
    />
  );
};

export default Terms;
