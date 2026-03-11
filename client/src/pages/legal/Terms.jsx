import DocumentViewer from './DocumentViewer';

const Terms = () => {
  return (
    <DocumentViewer
      title="Terms & Conditions"
      description="Please read our terms and conditions carefully before making a booking. These terms govern your stay at Drift & Dwells eco-retreat cabins."
      canonicalPath="/terms"
      noindex
      pdfPath="/uploads/PDFs/drift-dwells-docs-v2/terms.pdf"
      fileName="drift-dwells-terms-and-conditions.pdf"
    />
  );
};

export default Terms;
