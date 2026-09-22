import OpsTextField from '../../../ops/primitives/OpsTextField';
import { CabinEditorActions, CabinEditorSection } from './CabinEditorSection';

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
        <CabinEditorSection
          title="Edit occupancy settings"
          warning="These fields affect guest eligibility and minimum stay rules."
        >
          <div className="ops-cabin-editor__grid ops-cabin-editor__grid--2">
            <OpsTextField
              label="Capacity"
              type="number"
              min="1"
              step="1"
              value={occupancyForm.capacity}
              onChange={(event) =>
                setOccupancyForm((current) => ({ ...current, capacity: event.target.value }))
              }
            />
            <OpsTextField
              label="Minimum nights"
              type="number"
              min="1"
              step="1"
              value={occupancyForm.minNights}
              onChange={(event) =>
                setOccupancyForm((current) => ({ ...current, minNights: event.target.value }))
              }
            />
          </div>
          <CabinEditorActions
            onSave={onSaveOccupancy}
            onCancel={onCancelOccupancy}
            busy={occupancyBusy}
            error={occupancyError}
          />
        </CabinEditorSection>
      ) : null}

      {pricingEditOpen ? (
        <CabinEditorSection
          title="Edit pricing"
          warning="This changes guest quote totals and payment amounts."
        >
          <OpsTextField
            className="ops-cabin-editor__compact-control"
            label="Price per night"
            type="number"
            min="0.01"
            step="0.01"
            value={pricingForm.pricePerNight}
            onChange={(event) =>
              setPricingForm((current) => ({ ...current, pricePerNight: event.target.value }))
            }
          />
          <CabinEditorActions
            onSave={onSavePricing}
            onCancel={onCancelPricing}
            busy={pricingBusy}
            error={pricingError}
          />
        </CabinEditorSection>
      ) : null}
    </>
  );
}
