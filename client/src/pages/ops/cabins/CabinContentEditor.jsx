export default function CabinContentEditor({
  contentEditOpen,
  contentForm,
  setContentForm,
  contentBusy,
  contentError,
  onCancel,
  onSave
}) {
  if (!contentEditOpen) return null;

  return (
    <section className="bg-white border border-gray-200 rounded-xl p-4 md:p-5">
      <h3 className="text-sm font-semibold text-gray-900">Edit content</h3>
      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-xs text-gray-600 mb-1">Name</span>
          <input
            type="text"
            value={contentForm.name}
            onChange={(e) => setContentForm((p) => ({ ...p, name: e.target.value }))}
            className="w-full border border-gray-200 rounded-md px-2.5 py-2 text-sm"
            maxLength={100}
          />
        </label>
        <label className="block">
          <span className="block text-xs text-gray-600 mb-1">Host name</span>
          <input
            type="text"
            value={contentForm.hostName}
            onChange={(e) => setContentForm((p) => ({ ...p, hostName: e.target.value }))}
            className="w-full border border-gray-200 rounded-md px-2.5 py-2 text-sm"
            maxLength={120}
          />
        </label>
        <label className="block md:col-span-2">
          <span className="block text-xs text-gray-600 mb-1">Description</span>
          <textarea
            rows={4}
            value={contentForm.description}
            onChange={(e) => setContentForm((p) => ({ ...p, description: e.target.value }))}
            className="w-full border border-gray-200 rounded-md px-2.5 py-2 text-sm"
            maxLength={1000}
          />
        </label>
        <label className="block">
          <span className="block text-xs text-gray-600 mb-1">Avg response time (hours)</span>
          <input
            type="number"
            min="0"
            step="0.1"
            value={contentForm.avgResponseTimeHours}
            onChange={(e) => setContentForm((p) => ({ ...p, avgResponseTimeHours: e.target.value }))}
            className="w-full border border-gray-200 rounded-md px-2.5 py-2 text-sm"
          />
        </label>
        <label className="block md:col-span-2">
          <span className="block text-xs text-gray-600 mb-1">Highlights (up to 5, one per line)</span>
          <textarea
            rows={4}
            value={contentForm.highlightsText}
            onChange={(e) => setContentForm((p) => ({ ...p, highlightsText: e.target.value }))}
            className="w-full border border-gray-200 rounded-md px-2.5 py-2 text-sm font-mono"
          />
        </label>
      </div>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="border border-gray-100 rounded-md p-3">
          <label className="flex items-center gap-2 text-xs text-gray-700">
            <input
              type="checkbox"
              checked={contentForm.superhostEnabled}
              onChange={(e) => setContentForm((p) => ({ ...p, superhostEnabled: e.target.checked }))}
            />
            Superhost enabled
          </label>
          <input
            type="text"
            value={contentForm.superhostLabel}
            onChange={(e) => setContentForm((p) => ({ ...p, superhostLabel: e.target.value }))}
            className="mt-2 w-full border border-gray-200 rounded-md px-2.5 py-2 text-sm"
            maxLength={100}
          />
        </div>
        <div className="border border-gray-100 rounded-md p-3">
          <label className="flex items-center gap-2 text-xs text-gray-700">
            <input
              type="checkbox"
              checked={contentForm.guestFavoriteEnabled}
              onChange={(e) => setContentForm((p) => ({ ...p, guestFavoriteEnabled: e.target.checked }))}
            />
            Guest favorite enabled
          </label>
          <input
            type="text"
            value={contentForm.guestFavoriteLabel}
            onChange={(e) => setContentForm((p) => ({ ...p, guestFavoriteLabel: e.target.value }))}
            className="mt-2 w-full border border-gray-200 rounded-md px-2.5 py-2 text-sm"
            maxLength={100}
          />
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={contentBusy}
          className="text-xs px-3 py-2 rounded-lg bg-[#81887A] text-white disabled:opacity-50"
        >
          {contentBusy ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={contentBusy}
          className="text-xs px-3 py-2 rounded-lg border border-gray-200 bg-white disabled:opacity-50"
        >
          Cancel
        </button>
        {contentError ? <span className="text-xs text-red-700">{contentError}</span> : null}
      </div>
    </section>
  );
}
