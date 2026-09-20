import OpsModal from '../../../ops/primitives/OpsModal';
import OpsButton from '../../../ops/primitives/OpsButton';
import OpsTextField from '../../../ops/primitives/OpsTextField';
import OpsTextarea from '../../../ops/primitives/OpsTextarea';
import OpsInlineError from '../../../ops/primitives/OpsInlineError';

export default function ArchiveCabinModal({
  open,
  onClose,
  cabinDisplayName,
  archiveConfirmName,
  setArchiveConfirmName,
  archiveReason,
  setArchiveReason,
  archiveError,
  archiveBusy,
  onSubmit
}) {
  const handleClose = () => {
    if (archiveBusy) return;
    onClose();
  };

  return (
    <OpsModal
      open={open}
      onClose={handleClose}
      title="Archive cabin"
      description="Archiving hides this cabin from public listings, search, quotes, and booking. This does not delete data."
      dismissible={!archiveBusy}
      footer={
        <div className="ops-cd-modal-footer">
          <OpsButton variant="secondary" onClick={handleClose} disabled={archiveBusy}>
            Cancel
          </OpsButton>
          <OpsButton
            type="submit"
            form="ops-archive-cabin-form"
            variant="destructive"
            loading={archiveBusy}
            loadingLabel="Archiving…"
          >
            Archive cabin
          </OpsButton>
        </div>
      }
    >
      <form id="ops-archive-cabin-form" className="ops-cd-modal-stack" onSubmit={onSubmit}>
        {archiveError ? <OpsInlineError>{archiveError}</OpsInlineError> : null}

        <p className="ops-cd-note">
          Type the cabin name exactly to confirm:{' '}
          <span className="ops-cd-note--strong">{cabinDisplayName || '—'}</span>
        </p>

        <OpsTextField
          label="Confirm cabin name"
          value={archiveConfirmName}
          onChange={(e) => setArchiveConfirmName(e.target.value)}
          autoComplete="off"
          disabled={archiveBusy}
          placeholder={cabinDisplayName || ''}
        />

        <OpsTextarea
          label="Reason (min. 8 characters)"
          value={archiveReason}
          onChange={(e) => setArchiveReason(e.target.value)}
          rows={3}
          disabled={archiveBusy}
          placeholder="Why this cabin is being archived…"
        />
      </form>
    </OpsModal>
  );
}
