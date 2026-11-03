import DocumentViewer from './DocumentViewer';

const Career = () => {
  return (
    <DocumentViewer
      title="Careers"
      description="Careers at Drift & Dwells. When roles are open, details appear in the document below. We do not invent openings here—check the current careers PDF for authentic opportunities."
      canonicalPath="/career"
      noindex
      pdfPath="/uploads/PDFs/drift-dwells-docs-v2/career.pdf"
      fileName="drift-dwells-careers.pdf"
    />
  );
};

export default Career;
