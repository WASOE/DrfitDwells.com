export default function CreateCabinModal({
  open,
  onClose,
  createForm,
  setCreateForm,
  createError,
  createBusy,
  onSubmit
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-white rounded-t-2xl sm:rounded-xl shadow-lg w-full max-w-lg max-h-[90vh] overflow-y-auto border border-gray-200"
        role="dialog"
        aria-labelledby="ops-create-cabin-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-gray-100 px-4 py-3 md:px-5 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 id="ops-create-cabin-title" className="text-base font-semibold text-gray-900">
              Create single cabin
            </h3>
            <p className="text-xs text-gray-500 mt-1 max-w-md">
              Creates a single cabin only. Multi-unit provisioning remains separate.
            </p>
          </div>
          <button
            type="button"
            className="text-sm text-gray-500 hover:text-gray-800 shrink-0 px-2 py-1"
            onClick={() => onClose()}
          >
            Close
          </button>
        </div>

        <form className="p-4 md:p-5 space-y-3 max-w-lg mx-auto w-full" onSubmit={onSubmit}>
          {createError ? (
            <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{createError}</p>
          ) : null}

          <label className="block">
            <span className="text-xs font-medium text-gray-700">Name</span>
            <input
              required
              type="text"
              value={createForm.name}
              onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
              className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
              disabled={createBusy}
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-700">Description</span>
            <textarea
              required
              rows={4}
              value={createForm.description}
              onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))}
              className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-y min-h-[96px]"
              disabled={createBusy}
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-700">Location</span>
            <input
              required
              type="text"
              value={createForm.location}
              onChange={(e) => setCreateForm((f) => ({ ...f, location: e.target.value }))}
              className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
              disabled={createBusy}
            />
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-gray-700">Capacity (guests)</span>
              <input
                required
                type="number"
                min={1}
                step={1}
                value={createForm.capacity}
                onChange={(e) => setCreateForm((f) => ({ ...f, capacity: e.target.value }))}
                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                disabled={createBusy}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-700">Price per night</span>
              <input
                required
                type="number"
                min={0}
                step={0.01}
                value={createForm.pricePerNight}
                onChange={(e) => setCreateForm((f) => ({ ...f, pricePerNight: e.target.value }))}
                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                disabled={createBusy}
              />
            </label>
          </div>
          <label className="block max-w-xs">
            <span className="text-xs font-medium text-gray-700">Minimum nights</span>
            <input
              required
              type="number"
              min={1}
              step={1}
              value={createForm.minNights}
              onChange={(e) => setCreateForm((f) => ({ ...f, minNights: e.target.value }))}
              className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
              disabled={createBusy}
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-700">Host name (optional)</span>
            <input
              type="text"
              value={createForm.hostName}
              onChange={(e) => setCreateForm((f) => ({ ...f, hostName: e.target.value }))}
              className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
              disabled={createBusy}
            />
          </label>

          <div className="flex flex-col sm:flex-row gap-2 pt-2">
            <button
              type="submit"
              disabled={createBusy}
              className="px-4 py-2 text-sm rounded-lg bg-[#81887A] text-white hover:opacity-90 disabled:opacity-50"
            >
              {createBusy ? 'Creating…' : 'Create cabin'}
            </button>
            <button
              type="button"
              disabled={createBusy}
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
