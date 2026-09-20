import { useId, useRef } from 'react';
import { X } from 'lucide-react';
import { opsCx } from './opsCx';
import OpsIconButton from './OpsIconButton';
import { OpsOverlayPortal, useOpsOverlay } from './opsOverlay';

export default function OpsSheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  side = 'bottom',
  initialFocusRef,
  dismissible = true,
  closeOnBackdrop,
  closeOnEscape,
  showCloseButton = true
}) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef(null);
  const resolvedSide = side === 'right' ? 'right' : 'bottom';
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
        className={opsCx('ops-overlay', `ops-overlay--sheet-${resolvedSide}`)}
        data-ops-overlay="sheet"
        data-ops-sheet-side={resolvedSide}
      >
        <div
          className="ops-overlay__scrim"
          aria-hidden="true"
          onClick={canBackdrop ? () => onClose?.({ reason: 'backdrop' }) : undefined}
        />
        <div
          ref={panelRef}
          className={opsCx('ops-sheet', `ops-sheet--${resolvedSide}`)}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description ? descriptionId : undefined}
          tabIndex={-1}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="ops-sheet__header">
            <h2 id={titleId} className="ops-sheet__title">
              {title}
            </h2>
            {showCloseButton ? (
              <OpsIconButton label="Close" onClick={() => onClose?.({ reason: 'close-button' })}>
                <X size={18} aria-hidden="true" />
              </OpsIconButton>
            ) : null}
          </div>
          {description ? (
            <p id={descriptionId} className="ops-sheet__description">
              {description}
            </p>
          ) : null}
          <div className="ops-sheet__body">{children}</div>
          {footer ? <div className="ops-sheet__footer">{footer}</div> : null}
        </div>
      </div>
    </OpsOverlayPortal>
  );
}
