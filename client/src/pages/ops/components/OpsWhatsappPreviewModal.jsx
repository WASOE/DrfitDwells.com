import OpsBanner from '../../../ops/primitives/OpsBanner';
import OpsModal from '../../../ops/primitives/OpsModal';
import OpsTable, {
  OpsTableBody,
  OpsTableCell,
  OpsTableHead,
  OpsTableHeader,
  OpsTableRow
} from '../../../ops/primitives/OpsTable';
import './OpsMessagePreview.css';

/** GMA WhatsApp reference-body preview (read-only, no send actions). */
export function OpsWhatsappPreviewModal({
  open,
  onClose,
  titleId,
  title,
  ruleKey = '',
  statusBadge = null,
  templateName = '',
  locale = '',
  body = '',
  variables = null
}) {
  return (
    <OpsModal
      open={open}
      onClose={onClose}
      title={title}
      titleId={titleId}
      size="lg"
      panelProps={{
        className: 'ops-message-preview ops-message-preview--whatsapp'
      }}
    >
      <div className="ops-message-preview__meta">
        <span>{ruleKey || ''}</span>
        {statusBadge}
      </div>
      <dl className="ops-message-preview__definition-grid">
        <div>
          <dt>Template name</dt>
          <dd className="ops-message-preview__mono">{templateName || '—'}</dd>
        </div>
        <div>
          <dt>Locale</dt>
          <dd>{locale || '—'}</dd>
        </div>
      </dl>
      <OpsBanner
        tone="warning"
        body="GMA preview only. Nothing is sent. WhatsApp preview shows the approved reference body stored for review. Final Meta rendering depends on the submitted Meta template."
        className="ops-message-preview__banner"
      />
      <div className="ops-message-preview__whatsapp-stage">
        <pre>{body || '—'}</pre>
      </div>
      <details className="ops-message-preview__variables">
        <summary>Filled variables (secondary)</summary>
        <OpsTable caption="Filled WhatsApp template variables">
          <OpsTableHead>
            <OpsTableRow>
              <OpsTableHeader>Key</OpsTableHeader>
              <OpsTableHeader>Value</OpsTableHeader>
            </OpsTableRow>
          </OpsTableHead>
          <OpsTableBody>
            {variables &&
              Object.entries(variables).map(([key, value]) => (
                <OpsTableRow key={key}>
                  <OpsTableCell className="ops-message-preview__mono">{key}</OpsTableCell>
                  <OpsTableCell>{String(value ?? '')}</OpsTableCell>
                </OpsTableRow>
              ))}
          </OpsTableBody>
        </OpsTable>
      </details>
    </OpsModal>
  );
}
