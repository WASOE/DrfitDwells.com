import DocumentViewer from './DocumentViewer';

const Terms = () => {
  return (
    <DocumentViewer
      title="Terms & Conditions"
      description="Please read these terms carefully before completing a booking. They govern stays and purchases with Drift & Dwells. The authoritative Terms & Conditions document is embedded below."
      canonicalPath="/terms"
      noindex
      pdfPath="/legal/terms-2026-04-19-v2.pdf"
      fileName="drift-dwells-terms-and-conditions.pdf"
    />
  );
};

export default Terms;
