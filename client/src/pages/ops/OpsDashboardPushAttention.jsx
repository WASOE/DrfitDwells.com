import OpsBanner from '../../ops/primitives/OpsBanner';
import OpsButton from '../../ops/primitives/OpsButton';
import { useOptionalOpsPushNotificationsContext } from '../../context/OpsPushNotificationsContext';

/**
 * Compact Dashboard-only push attention. Healthy state renders nothing.
 */
export default function OpsDashboardPushAttention() {
  const push = useOptionalOpsPushNotificationsContext();
  if (!push?.attention) {
    return null;
  }

  const { attention, busy, subscribe } = push;
  const action =
    attention.action === 'enable' ? (
      <OpsButton
        variant="secondary"
        size="compact"
        disabled={busy}
        onClick={subscribe}
        data-testid="ops-dashboard-push-enable"
      >
        {busy ? 'Enabling…' : 'Enable'}
      </OpsButton>
    ) : attention.action === 'open_bell' ? (
      <span className="ops-dashboard-push-attention__hint">Open the notification bell for details.</span>
    ) : null;

  return (
    <div className="ops-dashboard-push-attention" data-testid="ops-dashboard-push-attention">
      <OpsBanner
        tone="warning"
        title={attention.message}
        action={action}
        data-testid={`ops-dashboard-push-attention-${attention.key}`}
      />
    </div>
  );
}
