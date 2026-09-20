import { useRef } from 'react';
import OpsButton from './OpsButton';
import OpsModal from './OpsModal';

export default function OpsConfirmDialog({
  open,
  title,
  body,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  onConfirm,
  onCancel,
  onClose,
  loading = false,
  closeOnEscape = true,
  initialFocusRef
}) {
  const cancelRef = useRef(null);
  const copy = body || description;
  const destructive = tone === 'destructive';

  function requestCancel(reason) {
    onCancel?.({ reason });
    onClose?.({ reason });
  }

  function requestConfirm() {
    if (loading) return;
    onConfirm?.({ reason: 'confirm' });
  }

  return (
    <OpsModal
      open={open}
      onClose={({ reason } = {}) => requestCancel(reason || 'cancel')}
      title={title}
      description={copy}
      size="sm"
      closeOnBackdrop={false}
      closeOnEscape={closeOnEscape}
      showCloseButton={false}
      initialFocusRef={initialFocusRef || cancelRef}
      footer={
        <>
          <OpsButton ref={cancelRef} variant="secondary" onClick={() => requestCancel('cancel')}>
            {cancelLabel}
          </OpsButton>
          <OpsButton
            variant={destructive ? 'destructive' : 'primary'}
            loading={loading}
            loadingLabel={confirmLabel}
            onClick={requestConfirm}
          >
            {confirmLabel}
          </OpsButton>
        </>
      }
    />
  );
}
