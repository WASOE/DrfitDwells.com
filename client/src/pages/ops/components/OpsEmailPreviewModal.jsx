import { useEffect, useRef } from 'react';

const DEFAULT_BANNER =
  'Preview only — nothing is sent. Sandbox blocks scripts; images may load for preview (same-origin).';

function resetIframeScroll(iframe) {
  if (!iframe) return;
  try {
    iframe.contentWindow?.scrollTo(0, 0);
    const doc = iframe.contentDocument;
    if (doc) {
      doc.documentElement?.scrollTo(0, 0);
      doc.body?.scrollTo(0, 0);
    }
  } catch {
    // sandbox may block until load
  }
}

/**
 * Shared OPS email HTML preview — lifecycle and GMA use the same shell/iframe behavior.
 */
export function OpsEmailPreviewModal({
  open,
  onClose,
  titleId,
  title,
  metaLine = '',
  statusBadge = null,
  subject = '',
  html = '',
  bannerText = DEFAULT_BANNER,
  iframeTitle = 'Email HTML preview',
  previewKey = '',
  headerActions = null
}) {
  const iframeRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const iframe = iframeRef.current;
    if (!iframe) return undefined;

    const handleLoad = () => resetIframeScroll(iframe);
    resetIframeScroll(iframe);
    iframe.addEventListener('load', handleLoad);
    return () => iframe.removeEventListener('load', handleLoad);
  }, [open, html, previewKey]);

  if (!open) return null;

  const closeButton = (
    <button
      type="button"
      onClick={onClose}
      className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 border border-gray-200 shrink-0"
    >
      Close
    </button>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="Close preview"
        onClick={onClose}
      />
      <div className="relative w-full max-w-4xl h-[min(92vh,900px)] flex flex-col rounded-xl border border-gray-200 bg-white shadow-xl overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 px-4 py-3 sm:px-5 shrink-0">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-sm font-semibold text-gray-900">
              {title}
            </h2>
            <p className="mt-1 text-xs text-gray-500 truncate" title={subject || metaLine || ''}>
              {metaLine || ''}
              {statusBadge}
            </p>
            {subject ? (
              <p className="mt-0.5 text-xs text-gray-600 break-words">{subject}</p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            {headerActions}
            {headerActions ? null : closeButton}
          </div>
        </div>
        <p className="px-4 py-2 text-xs text-amber-900 bg-amber-50 border-b border-amber-100/80 shrink-0">
          {bannerText}
        </p>
        <div className="flex-1 min-h-0 bg-zinc-100">
          <iframe
            key={previewKey || html}
            ref={iframeRef}
            title={iframeTitle}
            sandbox="allow-same-origin"
            srcDoc={html}
            className="block w-full h-full min-h-0 border-0 bg-zinc-100"
          />
        </div>
      </div>
    </div>
  );
}

export { DEFAULT_BANNER };
