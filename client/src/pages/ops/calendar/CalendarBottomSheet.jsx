import OpsSheet from '../../../ops/primitives/OpsSheet';
import './OpsCalendar.css';

/**
 * Calendar form/confirm sheet — thin OpsSheet wrapper preserving the prior prop surface.
 */
export default function CalendarBottomSheet({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
  dismissible = true
}) {
  return (
    <OpsSheet
      open={Boolean(open)}
      onClose={() => onClose?.()}
      title={title}
      description={subtitle}
      footer={footer}
      side="bottom"
      dismissible={dismissible}
    >
      <div className="ops-cal-sheet-stack">{children}</div>
    </OpsSheet>
  );
}
