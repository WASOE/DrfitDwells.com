export default function CabinArrivalEditor({
  arrivalEditOpen,
  arrivalForm,
  setArrivalForm,
  arrivalBusy,
  arrivalError,
  onCancel,
  onSave
}) {
  if (!arrivalEditOpen) return null;

  return (
    <section className="bg-white border border-gray-200 rounded-xl p-4 md:p-5">
      <h3 className="text-sm font-semibold text-gray-900">Edit location, arrival &amp; safety</h3>
      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="block md:col-span-2">
          <span className="block text-xs text-gray-600 mb-1">Location</span>
          <input
            type="text"
            value={arrivalForm.location}
            onChange={(e) => setArrivalForm((p) => ({ ...p, location: e.target.value }))}
            className="w-full border border-gray-200 rounded-md px-2.5 py-2 text-sm"
            maxLength={200}
          />
        </label>
        <label className="block">
          <span className="block text-xs text-gray-600 mb-1">Geo latitude</span>
          <input
            type="number"
            step="0.000001"
            value={arrivalForm.geoLatitude}
            onChange={(e) => setArrivalForm((p) => ({ ...p, geoLatitude: e.target.value }))}
            className="w-full border border-gray-200 rounded-md px-2.5 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="block text-xs text-gray-600 mb-1">Geo longitude</span>
          <input
            type="number"
            step="0.000001"
            value={arrivalForm.geoLongitude}
            onChange={(e) => setArrivalForm((p) => ({ ...p, geoLongitude: e.target.value }))}
            className="w-full border border-gray-200 rounded-md px-2.5 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="block text-xs text-gray-600 mb-1">Geo zoom</span>
          <input
            type="number"
            step="1"
            min="1"
            max="20"
            value={arrivalForm.geoZoom}
            onChange={(e) => setArrivalForm((p) => ({ ...p, geoZoom: e.target.value }))}
            className="w-full border border-gray-200 rounded-md px-2.5 py-2 text-sm"
          />
        </label>
      </div>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="block md:col-span-2">
          <span className="block text-xs text-gray-600 mb-1">Meeting point label</span>
          <input
            type="text"
            value={arrivalForm.meetingLabel}
            onChange={(e) => setArrivalForm((p) => ({ ...p, meetingLabel: e.target.value }))}
            className="w-full border border-gray-200 rounded-md px-2.5 py-2 text-sm"
            maxLength={200}
          />
        </label>
        <label className="block md:col-span-2">
          <span className="block text-xs text-gray-600 mb-1">Google Maps URL</span>
          <input
            type="url"
            value={arrivalForm.meetingGoogleMapsUrl}
            onChange={(e) => setArrivalForm((p) => ({ ...p, meetingGoogleMapsUrl: e.target.value }))}
            className="w-full border border-gray-200 rounded-md px-2.5 py-2 text-sm font-mono"
          />
        </label>
        <label className="block">
          <span className="block text-xs text-gray-600 mb-1">what3words</span>
          <input
            type="text"
            value={arrivalForm.meetingWhat3words}
            onChange={(e) => setArrivalForm((p) => ({ ...p, meetingWhat3words: e.target.value }))}
            className="w-full border border-gray-200 rounded-md px-2.5 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="block text-xs text-gray-600 mb-1">Meeting lat</span>
          <input
            type="number"
            step="0.000001"
            value={arrivalForm.meetingLat}
            onChange={(e) => setArrivalForm((p) => ({ ...p, meetingLat: e.target.value }))}
            className="w-full border border-gray-200 rounded-md px-2.5 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="block text-xs text-gray-600 mb-1">Meeting lng</span>
          <input
            type="number"
            step="0.000001"
            value={arrivalForm.meetingLng}
            onChange={(e) => setArrivalForm((p) => ({ ...p, meetingLng: e.target.value }))}
            className="w-full border border-gray-200 rounded-md px-2.5 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="block text-xs text-gray-600 mb-1">Arrival window default</span>
          <input
            type="text"
            value={arrivalForm.arrivalWindowDefault}
            onChange={(e) => setArrivalForm((p) => ({ ...p, arrivalWindowDefault: e.target.value }))}
            className="w-full border border-gray-200 rounded-md px-2.5 py-2 text-sm"
            maxLength={50}
          />
        </label>
        <label className="block md:col-span-2">
          <span className="block text-xs text-gray-600 mb-1">Arrival guide URL</span>
          <input
            type="url"
            value={arrivalForm.arrivalGuideUrl}
            onChange={(e) => setArrivalForm((p) => ({ ...p, arrivalGuideUrl: e.target.value }))}
            className="w-full border border-gray-200 rounded-md px-2.5 py-2 text-sm font-mono"
          />
        </label>
      </div>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-xs text-gray-600 mb-1">Emergency contact</span>
          <input
            type="text"
            value={arrivalForm.emergencyContact}
            onChange={(e) => setArrivalForm((p) => ({ ...p, emergencyContact: e.target.value }))}
            className="w-full border border-gray-200 rounded-md px-2.5 py-2 text-sm"
            maxLength={200}
          />
        </label>
        <label className="block md:col-span-2">
          <span className="block text-xs text-gray-600 mb-1">Safety notes</span>
          <textarea
            rows={3}
            value={arrivalForm.safetyNotes}
            onChange={(e) => setArrivalForm((p) => ({ ...p, safetyNotes: e.target.value }))}
            className="w-full border border-gray-200 rounded-md px-2.5 py-2 text-sm"
            maxLength={1000}
          />
        </label>
        <label className="block md:col-span-2">
          <span className="block text-xs text-gray-600 mb-1">Packing list (one item per line)</span>
          <textarea
            rows={4}
            value={arrivalForm.packingListText}
            onChange={(e) => setArrivalForm((p) => ({ ...p, packingListText: e.target.value }))}
            className="w-full border border-gray-200 rounded-md px-2.5 py-2 text-sm font-mono"
          />
        </label>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={arrivalBusy}
          className="text-xs px-3 py-2 rounded-lg bg-[#81887A] text-white disabled:opacity-50"
        >
          {arrivalBusy ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={arrivalBusy}
          className="text-xs px-3 py-2 rounded-lg border border-gray-200 bg-white disabled:opacity-50"
        >
          Cancel
        </button>
        {arrivalError ? <span className="text-xs text-red-700">{arrivalError}</span> : null}
      </div>
    </section>
  );
}
