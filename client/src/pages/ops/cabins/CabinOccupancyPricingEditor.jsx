export default function CabinOccupancyPricingEditor({
  occupancyEditOpen,
  occupancyForm,
  setOccupancyForm,
  occupancyBusy,
  occupancyError,
  onCancelOccupancy,
  onSaveOccupancy,
  pricingEditOpen,
  pricingForm,
  setPricingForm,
  pricingBusy,
  pricingError,
  onCancelPricing,
  onSavePricing
}) {
  return (
    <>
      {occupancyEditOpen ? (
        <section className="bg-white border border-gray-200 rounded-xl p-4 md:p-5 max-w-4xl mx-auto w-full">
          <h3 className="text-sm font-semibold text-gray-900">Edit occupancy settings</h3>
          <p className="mt-1 text-xs text-amber-700">These fields affect guest eligibility and minimum stay rules.</p>
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-xs text-gray-600 mb-1">Capacity</span>
              <input
                type="number"
                min="1"
                step="1"
                value={occupancyForm.capacity}
                onChange={(e) => setOccupancyForm((p) => ({ ...p, capacity: e.target.value }))}
                className="w-full border border-gray-200 rounded-md px-2.5 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="block text-xs text-gray-600 mb-1">Minimum nights</span>
              <input
                type="number"
                min="1"
                step="1"
                value={occupancyForm.minNights}
                onChange={(e) => setOccupancyForm((p) => ({ ...p, minNights: e.target.value }))}
                className="w-full border border-gray-200 rounded-md px-2.5 py-2 text-sm"
              />
            </label>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              onClick={onSaveOccupancy}
              disabled={occupancyBusy}
              className="text-xs px-3 py-2 rounded-lg bg-[#81887A] text-white disabled:opacity-50"
            >
              {occupancyBusy ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={onCancelOccupancy}
              disabled={occupancyBusy}
              className="text-xs px-3 py-2 rounded-lg border border-gray-200 bg-white disabled:opacity-50"
            >
              Cancel
            </button>
            {occupancyError ? <span className="text-xs text-red-700">{occupancyError}</span> : null}
          </div>
        </section>
      ) : null}

      {pricingEditOpen ? (
        <section className="bg-white border border-gray-200 rounded-xl p-4 md:p-5 max-w-4xl mx-auto w-full">
          <h3 className="text-sm font-semibold text-gray-900">Edit pricing</h3>
          <p className="mt-1 text-xs text-amber-700">This changes guest quote totals and payment amounts.</p>
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-xs text-gray-600 mb-1">Price per night</span>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={pricingForm.pricePerNight}
                onChange={(e) => setPricingForm((p) => ({ ...p, pricePerNight: e.target.value }))}
                className="w-full border border-gray-200 rounded-md px-2.5 py-2 text-sm"
              />
            </label>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              onClick={onSavePricing}
              disabled={pricingBusy}
              className="text-xs px-3 py-2 rounded-lg bg-[#81887A] text-white disabled:opacity-50"
            >
              {pricingBusy ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={onCancelPricing}
              disabled={pricingBusy}
              className="text-xs px-3 py-2 rounded-lg border border-gray-200 bg-white disabled:opacity-50"
            >
              Cancel
            </button>
            {pricingError ? <span className="text-xs text-red-700">{pricingError}</span> : null}
          </div>
        </section>
      ) : null}
    </>
  );
}
