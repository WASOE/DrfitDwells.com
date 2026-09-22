import OpsButton from '../../../ops/primitives/OpsButton';
import OpsSelect from '../../../ops/primitives/OpsSelect';
import OpsTextField from '../../../ops/primitives/OpsTextField';
import {
  CabinEditorActions,
  CabinEditorEmpty,
  CabinEditorRow,
  CabinEditorSection
} from './CabinEditorSection';

const CUTOFF_TYPES = ['Horse', 'ATV', 'Jeep', 'Hike', 'Boat', 'Helicopter'];

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
        <CabinEditorSection
          title="Edit transport options"
          warning="Transport prices affect guest quote totals."
        >
          <div className="ops-cabin-editor__stack">
            {transportOptionsForm.map((row, index) => (
              <CabinEditorRow key={`transport-option-row-${index}`}>
                <div className="ops-cabin-editor__grid ops-cabin-editor__grid--2">
                  <OpsTextField
                    label="Type"
                    value={row.type}
                    onChange={(event) =>
                      onUpdateTransportOptionRow(index, 'type', event.target.value)
                    }
                    placeholder="Horse, ATV, Jeep..."
                  />
                  <OpsTextField
                    label="Price per person"
                    type="number"
                    min="0"
                    step="0.01"
                    value={row.pricePerPerson}
                    onChange={(event) =>
                      onUpdateTransportOptionRow(index, 'pricePerPerson', event.target.value)
                    }
                  />
                  <OpsTextField
                    className="ops-cabin-editor__span-2"
                    label="Description"
                    value={row.description}
                    onChange={(event) =>
                      onUpdateTransportOptionRow(index, 'description', event.target.value)
                    }
                  />
                  <OpsTextField
                    label="Duration"
                    value={row.duration}
                    onChange={(event) =>
                      onUpdateTransportOptionRow(index, 'duration', event.target.value)
                    }
                  />
                  <OpsSelect
                    label="Available"
                    value={row.isAvailable ? 'true' : 'false'}
                    onChange={(event) =>
                      onUpdateTransportOptionRow(
                        index,
                        'isAvailable',
                        event.target.value === 'true'
                      )
                    }
                  >
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </OpsSelect>
                </div>
                <div className="ops-cabin-editor__row-meta">
                  <OpsButton
                    variant="destructive"
                    size="compact"
                    onClick={() => onRemoveTransportOptionRow(index)}
                  >
                    Remove
                  </OpsButton>
                </div>
              </CabinEditorRow>
            ))}
            {transportOptionsForm.length === 0 ? (
              <CabinEditorEmpty title="No transport options configured." />
            ) : null}
          </div>
          <CabinEditorActions
            onAdd={onAddTransportOptionRow}
            onSave={onSaveTransportOptions}
            onCancel={onCancelTransportOptions}
            busy={transportOptionsBusy}
            error={transportOptionsError}
          />
        </CabinEditorSection>
      ) : null}

      {transportCutoffsEditOpen ? (
        <CabinEditorSection title="Edit transport cutoffs">
          <div className="ops-cabin-editor__stack">
            {transportCutoffsForm.map((row, index) => (
              <CabinEditorRow key={`cutoff-row-${index}`}>
                <div className="ops-cabin-editor__grid ops-cabin-editor__grid--2">
                  <OpsSelect
                    label="Transport type"
                    value={row.type}
                    onChange={(event) =>
                      onUpdateTransportCutoffRow(index, 'type', event.target.value)
                    }
                  >
                    {CUTOFF_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </OpsSelect>
                  <OpsTextField
                    label="Last departure"
                    type="time"
                    value={row.lastDeparture}
                    onChange={(event) =>
                      onUpdateTransportCutoffRow(index, 'lastDeparture', event.target.value)
                    }
                  />
                </div>
                <div className="ops-cabin-editor__row-meta">
                  <OpsButton
                    variant="destructive"
                    size="compact"
                    onClick={() => onRemoveTransportCutoffRow(index)}
                  >
                    Remove
                  </OpsButton>
                </div>
              </CabinEditorRow>
            ))}
            {transportCutoffsForm.length === 0 ? (
              <CabinEditorEmpty title="No cutoffs configured." />
            ) : null}
          </div>
          <CabinEditorActions
            onAdd={onAddTransportCutoffRow}
            onSave={onSaveTransportCutoffs}
            onCancel={onCancelTransportCutoffs}
            busy={transportCutoffsBusy}
            error={transportCutoffsError}
          />
        </CabinEditorSection>
      ) : null}
    </>
  );
}
