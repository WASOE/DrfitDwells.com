/**
 * GMA WhatsApp reference-body preview (read-only, no send actions).
 */
export function OpsWhatsappPreviewModal({
  open,
  onClose,
  titleId,
  title,
  ruleKey = '',
  statusBadge = null,
  templateName = '',
  locale = '',
  body = '',
  variables = null
}) {
  if (!open) return null;

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
        aria-label="Close WhatsApp preview"
        onClick={onClose}
      />
      <div className="relative w-full max-w-lg h-[min(92vh,720px)] flex flex-col rounded-xl border border-gray-200 bg-white shadow-xl overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 px-4 py-3 sm:px-5 shrink-0">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-sm font-semibold text-gray-900">
              {title}
            </h2>
            <p className="mt-1 text-xs text-gray-500">
              {ruleKey || ''}
              {statusBadge}
            </p>
            <dl className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <div>
                <dt className="text-gray-500">Template name</dt>
                <dd className="font-mono text-gray-900 break-all">{templateName || '—'}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Locale</dt>
                <dd className="text-gray-900">{locale || '—'}</dd>
              </div>
            </dl>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 border border-gray-200 shrink-0"
          >
            Close
          </button>
        </div>
        <p className="px-4 py-2 text-xs text-amber-900 bg-amber-50 border-b border-amber-100/80 shrink-0">
          GMA preview only. Nothing is sent. WhatsApp preview shows the approved reference body stored for
          review. Final Meta rendering depends on the submitted Meta template.
        </p>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 sm:px-5 space-y-4 text-sm">
          <div className="mx-auto w-full max-w-sm">
            <div className="rounded-2xl border border-[#d1ccc4] bg-[#e5ddd5] p-4 shadow-inner">
              <div className="rounded-xl rounded-tl-sm bg-white px-3.5 py-3 text-sm text-gray-900 shadow-sm">
                <pre className="whitespace-pre-wrap font-sans leading-relaxed text-[13px] text-gray-900 m-0">
                  {body || '—'}
                </pre>
              </div>
            </div>
          </div>
          <details className="rounded-lg border border-gray-200 bg-gray-50/80">
            <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-gray-700 select-none">
              Filled variables (secondary)
            </summary>
            <div className="border-t border-gray-200 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-gray-200 bg-white text-gray-600">
                    <th className="py-1.5 px-2 font-medium">Key</th>
                    <th className="py-1.5 px-2 font-medium">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {variables &&
                    Object.entries(variables).map(([key, value]) => (
                      <tr key={key} className="border-b border-gray-100 align-top bg-white">
                        <td className="py-1.5 px-2 font-mono text-gray-700 whitespace-nowrap">{key}</td>
                        <td className="py-1.5 px-2 text-gray-900 break-all">{String(value ?? '')}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}
