import DocumentViewer from './DocumentViewer';

const Privacy = () => {
  return (
    <DocumentViewer
      title="Privacy Policy"
      description="Learn how we collect, use, and protect your personal information when you book a stay or interact with our website."
      canonicalPath="/privacy"
      noindex
      pdfPath="/uploads/PDFs/drift-dwells-docs-v2/privacy.pdf"
      fileName="drift-dwells-privacy-policy.pdf"
    />
  );
};

export default Privacy;
