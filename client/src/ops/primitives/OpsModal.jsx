import { useId, useRef } from 'react';
import { X } from 'lucide-react';
import { opsCx } from './opsCx';
import OpsIconButton from './OpsIconButton';
import { OpsOverlayPortal, useOpsOverlay } from './opsOverlay';

export default function OpsModal({
  open,
  onClose,
  title,
  titleId: providedTitleId,
  description,
  children,
  footer,
  size = 'md',
  initialFocusRef,
  dismissible = true,
  closeOnBackdrop,
  closeOnEscape,
  showCloseButton = true,
  mobileSheet = false,
  panelProps
}) {
  const generatedTitleId = useId();
  const titleId = providedTitleId || generatedTitleId;
  const descriptionId = useId();
  const panelRef = useRef(null);
  const canBackdrop = closeOnBackdrop ?? dismissible;
  const canEscape = closeOnEscape ?? dismissible;

  useOpsOverlay({
    open,
    onClose,
    panelRef,
    initialFocusRef,
    closeOnEscape: canEscape
  });

  if (!open) return null;

  return (
    <OpsOverlayPortal>
      <div
        className={opsCx(
          'ops-overlay',
          'ops-overlay--modal',
          mobileSheet && 'ops-overlay--modal-sheet-mobile'
        )}
        data-ops-overlay="modal"
      >
        <div
          className="ops-overlay__scrim"
          aria-hidden="true"
          onClick={canBackdrop ? () => onClose?.({ reason: 'backdrop' }) : undefined}
        />
        <div
          {...panelProps}
          ref={panelRef}
          className={opsCx(
            'ops-modal',
            size !== 'md' && `ops-modal--${size}`,
            mobileSheet && 'ops-modal--sheet-mobile',
            panelProps?.className
          )}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description ? descriptionId : undefined}
          tabIndex={-1}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="ops-modal__header">
            <h2 id={titleId} className="ops-modal__title">
              {title}
            </h2>
            {showCloseButton ? (
              <OpsIconButton label="Close" onClick={() => onClose?.({ reason: 'close-button' })}>
                <X size={18} aria-hidden="true" />
              </OpsIconButton>
            ) : null}
          </div>
          {description ? (
            <p id={descriptionId} className="ops-modal__description">
              {description}
            </p>
          ) : null}
          <div className="ops-modal__body">{children}</div>
          {footer ? <div className="ops-modal__footer">{footer}</div> : null}
        </div>
      </div>
    </OpsOverlayPortal>
  );
}
