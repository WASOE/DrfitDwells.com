export default function CabinExperiencesEditor({
  experiencesEditOpen,
  experiencesRows,
  experiencesBusy,
  experiencesError,
  onAddRow,
  onRemoveRow,
  onUpdateRow,
  onCancel,
  onSave
}) {
  if (!experiencesEditOpen) return null;

  return (
    <section className="bg-white border border-gray-200 rounded-xl p-4 md:p-5 max-w-4xl mx-auto w-full">
      <h3 className="text-sm font-semibold text-gray-900">Edit experiences</h3>
      <p className="mt-1 text-xs text-amber-700">Experiences can affect guest extras and quote totals.</p>
      <div className="mt-3 space-y-3">
        {experiencesRows.map((row, index) => (
          <div key={`experience-row-${index}`} className="border border-gray-100 rounded-md p-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <label className="block">
                <span className="block text-[11px] text-gray-600 mb-1">Name</span>
                <input
                  type="text"
                  value={row.name}
                  onChange={(e) => onUpdateRow(index, 'name', e.target.value)}
                  className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-sm"
                />
              </label>
              <label className="block">
                <span className="block text-[11px] text-gray-600 mb-1">Price</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={row.price}
                  onChange={(e) => onUpdateRow(index, 'price', e.target.value)}
                  className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-sm"
                />
              </label>
              <label className="block">
                <span className="block text-[11px] text-gray-600 mb-1">Currency</span>
                <input
                  type="text"
                  value={row.currency}
                  onChange={(e) => onUpdateRow(index, 'currency', e.target.value)}
                  className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-sm"
                />
              </label>
              <label className="block">
                <span className="block text-[11px] text-gray-600 mb-1">Unit</span>
                <select
                  value={row.unit}
                  onChange={(e) => onUpdateRow(index, 'unit', e.target.value)}
                  className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-sm"
                >
                  <option value="flat_per_stay">flat_per_stay</option>
                  <option value="per_guest">per_guest</option>
                </select>
              </label>
              <label className="block">
                <span className="block text-[11px] text-gray-600 mb-1">Sort order</span>
                <input
                  type="number"
                  step="1"
                  value={row.sortOrder}
                  onChange={(e) => onUpdateRow(index, 'sortOrder', e.target.value)}
                  className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-sm"
                />
              </label>
              <label className="block">
                <span className="block text-[11px] text-gray-600 mb-1">Active</span>
                <select
                  value={row.active ? 'true' : 'false'}
                  onChange={(e) => onUpdateRow(index, 'active', e.target.value === 'true')}
                  className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-sm"
                >
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              </label>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span className="text-[11px] text-gray-500 font-mono break-all">Key: {row.key || '(generated on save)'}</span>
              <button
                type="button"
                onClick={() => onRemoveRow(index)}
                className="ml-auto text-xs px-2.5 py-1.5 rounded border border-red-200 text-red-700 bg-white hover:bg-red-50"
              >
                Remove
              </button>
            </div>
          </div>
        ))}
        {experiencesRows.length === 0 ? (
          <p className="text-xs text-gray-500">No experiences configured.</p>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onAddRow}
          className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50"
          disabled={experiencesBusy}
        >
          Add row
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={experiencesBusy}
          className="text-xs px-3 py-1.5 rounded-lg bg-[#81887A] text-white disabled:opacity-50"
        >
          {experiencesBusy ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={experiencesBusy}
          className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 bg-white disabled:opacity-50"
        >
          Cancel
        </button>
        {experiencesError ? <span className="text-xs text-red-700">{experiencesError}</span> : null}
      </div>
    </section>
  );
}
