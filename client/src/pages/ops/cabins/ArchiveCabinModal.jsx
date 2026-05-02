export default function ArchiveCabinModal({
  open,
  onClose,
  cabinDisplayName,
  archiveConfirmName,
  setArchiveConfirmName,
  archiveReason,
  setArchiveReason,
  archiveError,
  archiveBusy,
  onSubmit
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !archiveBusy) onClose();
      }}
    >
      <div
        className="bg-white rounded-t-2xl sm:rounded-xl shadow-lg w-full max-w-lg max-h-[90vh] overflow-y-auto border border-gray-200"
        role="dialog"
        aria-labelledby="ops-archive-cabin-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-gray-100 px-4 py-3 md:px-5 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 id="ops-archive-cabin-title" className="text-base font-semibold text-gray-900">
              Archive cabin
            </h3>
            <p className="text-xs text-gray-600 mt-1 max-w-md">
              Archiving hides this cabin from public listings, search, quotes, and booking. This does not delete data.
            </p>
          </div>
          <button
            type="button"
            disabled={archiveBusy}
            className="text-sm text-gray-500 hover:text-gray-800 shrink-0 px-2 py-1"
            onClick={() => !archiveBusy && onClose()}
          >
            Close
          </button>
        </div>

        <form className="p-4 md:p-5 space-y-3 max-w-lg mx-auto w-full" onSubmit={onSubmit}>
          {archiveError ? (
            <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{archiveError}</p>
          ) : null}

          <p className="text-xs text-gray-700">
            Type the cabin name exactly to confirm:{' '}
            <span className="font-semibold text-gray-900">{cabinDisplayName || '—'}</span>
          </p>
          <label className="block">
            <span className="text-xs font-medium text-gray-700">Confirm cabin name</span>
            <input
              type="text"
              value={archiveConfirmName}
              onChange={(e) => setArchiveConfirmName(e.target.value)}
              autoComplete="off"
              className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
              disabled={archiveBusy}
              placeholder={cabinDisplayName || ''}
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-700">Reason (min. 8 characters)</span>
            <textarea
              value={archiveReason}
              onChange={(e) => setArchiveReason(e.target.value)}
              rows={3}
              className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-y min-h-[80px]"
              disabled={archiveBusy}
              placeholder="Why this cabin is being archived…"
            />
          </label>

          <div className="flex flex-col sm:flex-row gap-2 pt-2">
            <button
              type="submit"
              disabled={archiveBusy}
              className="px-4 py-2 text-sm rounded-lg bg-red-800 text-white hover:opacity-90 disabled:opacity-50"
            >
              {archiveBusy ? 'Archiving…' : 'Archive cabin'}
            </button>
            <button
              type="button"
              disabled={archiveBusy}
              onClick={() => onClose()}
              className="px-4 py-2 text-sm rounded-lg border border-gray-200 bg-white hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
