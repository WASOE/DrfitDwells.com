import OpsButton from '../../../ops/primitives/OpsButton';
import OpsSelect from '../../../ops/primitives/OpsSelect';
import OpsTextField from '../../../ops/primitives/OpsTextField';
import {
  CabinEditorActions,
  CabinEditorEmpty,
  CabinEditorRow,
  CabinEditorSection
} from './CabinEditorSection';

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
    <CabinEditorSection
      title="Edit experiences"
      warning="Experiences can affect guest extras and quote totals."
    >
      <div className="ops-cabin-editor__stack">
        {experiencesRows.map((row, index) => (
          <CabinEditorRow key={`experience-row-${index}`}>
            <div className="ops-cabin-editor__grid ops-cabin-editor__grid--2">
              <OpsTextField
                label="Name"
                value={row.name}
                onChange={(event) => onUpdateRow(index, 'name', event.target.value)}
              />
              <OpsTextField
                label="Price"
                type="number"
                min="0"
                step="0.01"
                value={row.price}
                onChange={(event) => onUpdateRow(index, 'price', event.target.value)}
              />
              <OpsTextField
                label="Currency"
                value={row.currency}
                onChange={(event) => onUpdateRow(index, 'currency', event.target.value)}
              />
              <OpsSelect
                label="Unit"
                value={row.unit}
                onChange={(event) => onUpdateRow(index, 'unit', event.target.value)}
              >
                <option value="flat_per_stay">flat_per_stay</option>
                <option value="per_guest">per_guest</option>
              </OpsSelect>
              <OpsTextField
                label="Sort order"
                type="number"
                step="1"
                value={row.sortOrder}
                onChange={(event) => onUpdateRow(index, 'sortOrder', event.target.value)}
              />
              <OpsSelect
                label="Active"
                value={row.active ? 'true' : 'false'}
                onChange={(event) => onUpdateRow(index, 'active', event.target.value === 'true')}
              >
                <option value="true">true</option>
                <option value="false">false</option>
              </OpsSelect>
            </div>
            <div className="ops-cabin-editor__row-meta ops-cabin-editor__row-meta--mono">
              <span>Key: {row.key || '(generated on save)'}</span>
              <OpsButton
                variant="destructive"
                size="compact"
                onClick={() => onRemoveRow(index)}
              >
                Remove
              </OpsButton>
            </div>
          </CabinEditorRow>
        ))}
        {experiencesRows.length === 0 ? (
          <CabinEditorEmpty title="No experiences configured." />
        ) : null}
      </div>
      <CabinEditorActions
        onAdd={onAddRow}
        onSave={onSave}
        onCancel={onCancel}
        busy={experiencesBusy}
        error={experiencesError}
      />
    </CabinEditorSection>
  );
}
