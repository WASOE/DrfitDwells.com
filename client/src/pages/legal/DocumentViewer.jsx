import { useEffect, useState } from 'react';
import Seo from '../../components/Seo';

async function responseLooksLikePdf(res) {
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  return (res.ok || res.status === 206) && ct.includes('application/pdf');
}

/** HEAD, then Range GET fallback for servers that omit HEAD on static files. */
async function verifyPdfUrl(urlWithoutHash) {
  try {
    let res = await fetch(urlWithoutHash, { method: 'HEAD', cache: 'no-store' });
    if (await responseLooksLikePdf(res)) return true;
    if (res.status === 405 || res.status === 501) {
      res = await fetch(urlWithoutHash, {
        method: 'GET',
        headers: { Range: 'bytes=0-0' },
        cache: 'no-store'
      });
      if (await responseLooksLikePdf(res)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Reusable component for displaying legal documents as embedded PDFs
 * with download functionality and proper SEO meta tags
 */
const DocumentViewer = ({ 
  title, 
  description, 
  pdfPath, 
  fileName,
  canonicalPath,
  noindex = false
}) => {
  const [embedState, setEmbedState] = useState('loading');

  const pdfUrlBase = pdfPath.split('#')[0];

  useEffect(() => {
    let cancelled = false;
    setEmbedState('loading');
    verifyPdfUrl(pdfUrlBase).then((ok) => {
      if (!cancelled) setEmbedState(ok ? 'ready' : 'unavailable');
    });
    return () => {
      cancelled = true;
    };
  }, [pdfUrlBase]);

  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = pdfPath;
    link.download = fileName || pdfPath.split('/').pop();
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <>
      <Seo
        title={`${title} | Drift & Dwells`}
        description={description}
        canonicalPath={canonicalPath}
        noindex={noindex}
      />
      <div className="min-h-screen bg-white pb-12 md:pb-24">
        <div className="max-w-6xl mx-auto px-4 md:px-6">
        {/* Header */}
        <div className="mb-8 md:mb-12 text-center">
          <h1 className="text-3xl md:text-4xl lg:text-5xl font-serif font-bold text-black mb-4 md:mb-6 tracking-tight">
            {title}
          </h1>
          <p className="text-base md:text-lg text-gray-600 max-w-2xl mx-auto font-light">
            {description}
          </p>
        </div>

        {/* Download Button */}
        <div className="flex justify-center mb-6 md:mb-8">
          <button
            onClick={handleDownload}
            className="btn-pill flex items-center gap-2 px-6 py-3"
          >
            <svg 
              className="w-5 h-5" 
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path 
                strokeLinecap="round" 
                strokeLinejoin="round" 
                strokeWidth={2} 
                d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" 
              />
            </svg>
            Download PDF
          </button>
        </div>

        {/* PDF Embed — only after Content-Type check so SW/HTML fallbacks cannot nest the SPA */}
        <div className="bg-gray-100 rounded-lg overflow-hidden shadow-lg" style={{ minHeight: '600px' }}>
          {embedState === 'loading' && (
            <div
              className="flex items-center justify-center text-gray-500 text-sm font-light w-full"
              style={{ minHeight: '600px', height: 'calc(100vh - 300px)', maxHeight: '1200px' }}
            >
              Loading preview…
            </div>
          )}
          {embedState === 'ready' && (
            <iframe
              src={`${pdfPath}#toolbar=1&navpanes=1&scrollbar=1`}
              title={title}
              className="w-full"
              style={{
                minHeight: '600px',
                height: 'calc(100vh - 300px)',
                maxHeight: '1200px'
              }}
              frameBorder="0"
              onLoad={(e) => {
                try {
                  const doc = e.currentTarget.contentDocument;
                  const ct = doc?.contentType?.toLowerCase() ?? '';
                  if (doc && ct.includes('text/html')) {
                    setEmbedState('unavailable');
                  }
                } catch {
                  /* PDF plugin / opaque — treat as OK */
                }
              }}
            />
          )}
          {embedState === 'unavailable' && (
            <div
              className="flex flex-col items-center justify-center gap-3 px-6 text-center text-gray-600 w-full"
              style={{ minHeight: '600px', height: 'calc(100vh - 300px)', maxHeight: '1200px' }}
            >
              <p className="text-base font-light">This document cannot be shown inline right now.</p>
              <p className="text-sm text-gray-500 font-light">
                Use Download PDF below, or try again later.
              </p>
            </div>
          )}
        </div>

        {/* Footer Note */}
        <div className="mt-8 text-center">
          <p className="text-sm text-gray-500 font-light">
            If the document doesn't load, please{' '}
            <button
              onClick={handleDownload}
              className="text-sage underline hover:text-sage-dark"
            >
              download the PDF
            </button>
            {' '}to view it.
          </p>
        </div>
        </div>
      </div>
    </>
  );
};

export default DocumentViewer;
