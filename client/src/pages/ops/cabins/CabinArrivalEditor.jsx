import OpsTextField from '../../../ops/primitives/OpsTextField';
import OpsTextarea from '../../../ops/primitives/OpsTextarea';
import { CabinEditorActions, CabinEditorSection } from './CabinEditorSection';

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

  const update = (key) => (event) =>
    setArrivalForm((current) => ({ ...current, [key]: event.target.value }));

  return (
    <CabinEditorSection title="Edit location, arrival & safety">
      <div className="ops-cabin-editor__grid ops-cabin-editor__grid--2">
        <OpsTextField
          className="ops-cabin-editor__span-2"
          label="Location"
          value={arrivalForm.location}
          onChange={update('location')}
          maxLength={200}
        />
        <OpsTextField
          label="Geo latitude"
          type="number"
          step="0.000001"
          value={arrivalForm.geoLatitude}
          onChange={update('geoLatitude')}
        />
        <OpsTextField
          label="Geo longitude"
          type="number"
          step="0.000001"
          value={arrivalForm.geoLongitude}
          onChange={update('geoLongitude')}
        />
        <OpsTextField
          label="Geo zoom"
          type="number"
          step="1"
          min="1"
          max="20"
          value={arrivalForm.geoZoom}
          onChange={update('geoZoom')}
        />
      </div>

      <div className="ops-cabin-editor__grid ops-cabin-editor__grid--2">
        <OpsTextField
          className="ops-cabin-editor__span-2"
          label="Meeting point label"
          value={arrivalForm.meetingLabel}
          onChange={update('meetingLabel')}
          maxLength={200}
        />
        <OpsTextField
          className="ops-cabin-editor__span-2"
          label="Google Maps URL"
          type="url"
          value={arrivalForm.meetingGoogleMapsUrl}
          onChange={update('meetingGoogleMapsUrl')}
        />
        <OpsTextField
          label="what3words"
          value={arrivalForm.meetingWhat3words}
          onChange={update('meetingWhat3words')}
        />
        <OpsTextField
          label="Meeting latitude"
          type="number"
          step="0.000001"
          value={arrivalForm.meetingLat}
          onChange={update('meetingLat')}
        />
        <OpsTextField
          label="Meeting longitude"
          type="number"
          step="0.000001"
          value={arrivalForm.meetingLng}
          onChange={update('meetingLng')}
        />
        <OpsTextField
          label="Arrival window default"
          value={arrivalForm.arrivalWindowDefault}
          onChange={update('arrivalWindowDefault')}
          maxLength={50}
        />
        <OpsTextField
          className="ops-cabin-editor__span-2"
          label="Arrival guide URL"
          type="url"
          value={arrivalForm.arrivalGuideUrl}
          onChange={update('arrivalGuideUrl')}
        />
      </div>

      <div className="ops-cabin-editor__grid ops-cabin-editor__grid--2">
        <OpsTextField
          label="Emergency contact"
          value={arrivalForm.emergencyContact}
          onChange={update('emergencyContact')}
          maxLength={200}
        />
        <OpsTextarea
          className="ops-cabin-editor__span-2"
          label="Safety notes"
          rows={3}
          value={arrivalForm.safetyNotes}
          onChange={update('safetyNotes')}
          maxLength={1000}
        />
        <OpsTextarea
          className="ops-cabin-editor__span-2"
          label="Packing list (one item per line)"
          rows={4}
          value={arrivalForm.packingListText}
          onChange={update('packingListText')}
        />
      </div>

      <CabinEditorActions
        onSave={onSave}
        onCancel={onCancel}
        busy={arrivalBusy}
        error={arrivalError}
      />
    </CabinEditorSection>
  );
}
