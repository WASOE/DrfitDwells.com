import { useEffect, useRef } from 'react';
import OpsBanner from '../../../ops/primitives/OpsBanner';
import OpsModal from '../../../ops/primitives/OpsModal';
import './OpsMessagePreview.css';

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

/** Shared OPS email HTML preview — lifecycle and GMA use the canonical overlay shell. */
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

  return (
    <OpsModal
      open={open}
      onClose={onClose}
      title={title}
      titleId={titleId}
      size="xl"
      panelProps={{
        className: 'ops-message-preview ops-message-preview--email'
      }}
    >
      <div className="ops-message-preview__meta" title={subject || metaLine || ''}>
        <span>{metaLine || ''}</span>
        {statusBadge}
      </div>
      {subject ? <p className="ops-message-preview__subject">{subject}</p> : null}
      {headerActions ? <div className="ops-message-preview__actions">{headerActions}</div> : null}
      <OpsBanner tone="warning" body={bannerText} className="ops-message-preview__banner" />
      <div className="ops-message-preview__frame-wrap">
        <iframe
          key={previewKey || html}
          ref={iframeRef}
          title={iframeTitle}
          sandbox="allow-same-origin"
          srcDoc={html}
          className="ops-message-preview__frame"
        />
      </div>
    </OpsModal>
  );
}

export { DEFAULT_BANNER };
