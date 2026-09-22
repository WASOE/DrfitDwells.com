import OpsCheckbox from '../../../ops/primitives/OpsCheckbox';
import OpsTextField from '../../../ops/primitives/OpsTextField';
import OpsTextarea from '../../../ops/primitives/OpsTextarea';
import { CabinEditorActions, CabinEditorRow, CabinEditorSection } from './CabinEditorSection';

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

  const update = (key) => (event) =>
    setContentForm((current) => ({ ...current, [key]: event.target.value }));

  return (
    <CabinEditorSection title="Edit content">
      <div className="ops-cabin-editor__grid ops-cabin-editor__grid--2">
        <OpsTextField label="Name" value={contentForm.name} onChange={update('name')} maxLength={100} />
        <OpsTextField
          label="Host name"
          value={contentForm.hostName}
          onChange={update('hostName')}
          maxLength={120}
        />
        <OpsTextarea
          className="ops-cabin-editor__span-2"
          label="Description"
          rows={4}
          value={contentForm.description}
          onChange={update('description')}
          maxLength={1000}
        />
        <OpsTextField
          label="Avg response time (hours)"
          type="number"
          min="0"
          step="0.1"
          value={contentForm.avgResponseTimeHours}
          onChange={update('avgResponseTimeHours')}
        />
        <OpsTextarea
          className="ops-cabin-editor__span-2"
          label="Highlights (up to 5, one per line)"
          rows={4}
          value={contentForm.highlightsText}
          onChange={update('highlightsText')}
        />
      </div>

      <CabinEditorRow>
        <div>
          <strong>Bulgarian translation (BG)</strong>
          <p className="ops-surface__description">
            Shown on the /bg site. Empty fields fall back to the English text.
          </p>
        </div>
        <div className="ops-cabin-editor__grid ops-cabin-editor__grid--2">
          <OpsTextField
            label="Name (BG)"
            value={contentForm.i18nBgName}
            onChange={update('i18nBgName')}
            maxLength={100}
          />
          <OpsTextField
            label="Location (BG)"
            value={contentForm.i18nBgLocation}
            onChange={update('i18nBgLocation')}
            maxLength={200}
          />
          <OpsTextarea
            className="ops-cabin-editor__span-2"
            label="Description (BG)"
            rows={4}
            value={contentForm.i18nBgDescription}
            onChange={update('i18nBgDescription')}
            maxLength={1000}
          />
        </div>
      </CabinEditorRow>

      <div className="ops-cabin-editor__grid ops-cabin-editor__grid--2">
        <CabinEditorRow>
          <OpsCheckbox
            label="Superhost enabled"
            checked={contentForm.superhostEnabled}
            onChange={(event) =>
              setContentForm((current) => ({
                ...current,
                superhostEnabled: event.target.checked
              }))
            }
          />
          <OpsTextField
            label="Superhost label"
            value={contentForm.superhostLabel}
            onChange={update('superhostLabel')}
            maxLength={100}
          />
        </CabinEditorRow>
        <CabinEditorRow>
          <OpsCheckbox
            label="Guest favorite enabled"
            checked={contentForm.guestFavoriteEnabled}
            onChange={(event) =>
              setContentForm((current) => ({
                ...current,
                guestFavoriteEnabled: event.target.checked
              }))
            }
          />
          <OpsTextField
            label="Guest favorite label"
            value={contentForm.guestFavoriteLabel}
            onChange={update('guestFavoriteLabel')}
            maxLength={100}
          />
        </CabinEditorRow>
      </div>

      <CabinEditorActions
        onSave={onSave}
        onCancel={onCancel}
        busy={contentBusy}
        error={contentError}
      />
    </CabinEditorSection>
  );
}
