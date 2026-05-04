export default function CabinTransportEditor({
  transportOptionsEditOpen,
  transportOptionsForm,
  setTransportOptionsForm: _setTransportOptionsForm,
  transportOptionsBusy,
  transportOptionsError,
  onCancelTransportOptions,
  onSaveTransportOptions,
  onAddTransportOptionRow,
  onRemoveTransportOptionRow,
  onUpdateTransportOptionRow,
  transportCutoffsEditOpen,
  transportCutoffsForm,
  setTransportCutoffsForm: _setTransportCutoffsForm,
  transportCutoffsBusy,
  transportCutoffsError,
  onCancelTransportCutoffs,
  onSaveTransportCutoffs,
  onAddTransportCutoffRow,
  onRemoveTransportCutoffRow,
  onUpdateTransportCutoffRow
}) {
  return (
    <>
      {transportOptionsEditOpen ? (
        <section className="bg-white border border-gray-200 rounded-xl p-4 md:p-5 max-w-4xl mx-auto w-full">
          <h3 className="text-sm font-semibold text-gray-900">Edit transport options</h3>
          <p className="mt-1 text-xs text-amber-700">Transport prices affect guest quote totals.</p>
          <div className="mt-3 space-y-3">
            {transportOptionsForm.map((row, index) => (
              <div key={`transport-option-row-${index}`} className="border border-gray-100 rounded-md p-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <label className="block">
                    <span className="block text-[11px] text-gray-600 mb-1">Type</span>
                    <input
                      type="text"
                      value={row.type}
                      onChange={(e) => onUpdateTransportOptionRow(index, 'type', e.target.value)}
                      className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-sm"
                      placeholder="Horse, ATV, Jeep..."
                    />
                  </label>
                  <label className="block">
                    <span className="block text-[11px] text-gray-600 mb-1">Price per person</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={row.pricePerPerson}
                      onChange={(e) => onUpdateTransportOptionRow(index, 'pricePerPerson', e.target.value)}
                      className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-sm"
                    />
                  </label>
                  <label className="block md:col-span-2">
                    <span className="block text-[11px] text-gray-600 mb-1">Description</span>
                    <input
                      type="text"
                      value={row.description}
                      onChange={(e) => onUpdateTransportOptionRow(index, 'description', e.target.value)}
                      className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-sm"
                    />
                  </label>
                  <label className="block">
                    <span className="block text-[11px] text-gray-600 mb-1">Duration</span>
                    <input
                      type="text"
                      value={row.duration}
                      onChange={(e) => onUpdateTransportOptionRow(index, 'duration', e.target.value)}
                      className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-sm"
                    />
                  </label>
                  <label className="block">
                    <span className="block text-[11px] text-gray-600 mb-1">Available</span>
                    <select
                      value={row.isAvailable ? 'true' : 'false'}
                      onChange={(e) => onUpdateTransportOptionRow(index, 'isAvailable', e.target.value === 'true')}
                      className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-sm"
                    >
                      <option value="true">Yes</option>
                      <option value="false">No</option>
                    </select>
                  </label>
                </div>
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => onRemoveTransportOptionRow(index)}
                    className="text-xs px-2.5 py-1.5 rounded border border-red-200 text-red-700 bg-white hover:bg-red-50"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
            {transportOptionsForm.length === 0 ? (
              <p className="text-xs text-gray-500">No transport options configured.</p>
            ) : null}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onAddTransportOptionRow}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50"
              disabled={transportOptionsBusy}
            >
              Add row
            </button>
            <button
              type="button"
              onClick={onSaveTransportOptions}
              disabled={transportOptionsBusy}
              className="text-xs px-3 py-1.5 rounded-lg bg-[#81887A] text-white disabled:opacity-50"
            >
              {transportOptionsBusy ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={onCancelTransportOptions}
              disabled={transportOptionsBusy}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 bg-white disabled:opacity-50"
            >
              Cancel
            </button>
            {transportOptionsError ? <span className="text-xs text-red-700">{transportOptionsError}</span> : null}
          </div>
        </section>
      ) : null}

      {transportCutoffsEditOpen ? (
        <section className="bg-white border border-gray-200 rounded-xl p-4 md:p-5 max-w-4xl mx-auto w-full">
          <h3 className="text-sm font-semibold text-gray-900">Edit transport cutoffs</h3>
          <div className="mt-3 space-y-2">
            {transportCutoffsForm.map((row, index) => (
              <div
                key={`cutoff-row-${index}`}
                className="flex flex-col md:flex-row md:items-center gap-2 border border-gray-100 rounded-md p-2"
              >
                <select
                  value={row.type}
                  onChange={(e) => onUpdateTransportCutoffRow(index, 'type', e.target.value)}
                  className="border border-gray-200 rounded-md px-2 py-1.5 text-sm w-full md:w-44"
                >
                  <option value="Horse">Horse</option>
                  <option value="ATV">ATV</option>
                  <option value="Jeep">Jeep</option>
                  <option value="Hike">Hike</option>
                  <option value="Boat">Boat</option>
                  <option value="Helicopter">Helicopter</option>
                </select>
                <input
                  type="time"
                  value={row.lastDeparture}
                  onChange={(e) => onUpdateTransportCutoffRow(index, 'lastDeparture', e.target.value)}
                  className="border border-gray-200 rounded-md px-2 py-1.5 text-sm w-full md:w-40"
                />
                <button
                  type="button"
                  onClick={() => onRemoveTransportCutoffRow(index)}
                  className="text-xs px-2.5 py-1.5 rounded border border-red-200 text-red-700 bg-white hover:bg-red-50 w-full md:w-auto"
                >
                  Remove
                </button>
              </div>
            ))}
            {transportCutoffsForm.length === 0 ? (
              <p className="text-xs text-gray-500">No cutoffs configured.</p>
            ) : null}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onAddTransportCutoffRow}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50"
              disabled={transportCutoffsBusy}
            >
              Add row
            </button>
            <button
              type="button"
              onClick={onSaveTransportCutoffs}
              disabled={transportCutoffsBusy}
              className="text-xs px-3 py-1.5 rounded-lg bg-[#81887A] text-white disabled:opacity-50"
            >
              {transportCutoffsBusy ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={onCancelTransportCutoffs}
              disabled={transportCutoffsBusy}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 bg-white disabled:opacity-50"
            >
              Cancel
            </button>
            {transportCutoffsError ? <span className="text-xs text-red-700">{transportCutoffsError}</span> : null}
          </div>
        </section>
      ) : null}
    </>
  );
}
