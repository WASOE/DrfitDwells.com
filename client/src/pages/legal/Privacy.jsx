import DocumentViewer from './DocumentViewer';

const Privacy = () => {
  return (
    <DocumentViewer
      title="Privacy Policy"
      description="Learn how Drift & Dwells collects, uses, and protects personal information when you browse the site, request availability, or complete a booking. The full Privacy Policy is provided in the document below."
      canonicalPath="/privacy"
      noindex
      pdfPath="/uploads/PDFs/drift-dwells-docs-v2/privacy.pdf"
      fileName="drift-dwells-privacy-policy.pdf"
    />
  );
};

export default Privacy;
