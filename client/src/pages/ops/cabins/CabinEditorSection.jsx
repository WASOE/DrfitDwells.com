import OpsBanner from '../../../ops/primitives/OpsBanner';
import OpsButton from '../../../ops/primitives/OpsButton';
import OpsEmptyState from '../../../ops/primitives/OpsEmptyState';
import OpsInlineError from '../../../ops/primitives/OpsInlineError';
import OpsSurface, {
  OpsSurfaceDescription,
  OpsSurfaceHeader,
  OpsSurfaceTitle
} from '../../../ops/primitives/OpsSurface';
import './CabinEditor.css';

export function CabinEditorSection({ title, description, warning, children, className = '' }) {
  return (
    <OpsSurface className={`ops-cabin-editor ${className}`.trim()}>
      <OpsSurfaceHeader>
        <div>
          <OpsSurfaceTitle as="h3">{title}</OpsSurfaceTitle>
          {description ? <OpsSurfaceDescription>{description}</OpsSurfaceDescription> : null}
        </div>
      </OpsSurfaceHeader>
      {warning ? <OpsBanner tone="warning" body={warning} /> : null}
      <div className="ops-cabin-editor__body">{children}</div>
    </OpsSurface>
  );
}

export function CabinEditorRow({ children, className = '' }) {
  return (
    <OpsSurface as="div" variant="inset" className={`ops-cabin-editor__row ${className}`.trim()}>
      {children}
    </OpsSurface>
  );
}

export function CabinEditorEmpty({ title }) {
  return <OpsEmptyState title={title} />;
}

export function CabinEditorActions({
  onAdd,
  addLabel = 'Add row',
  onSave,
  onCancel,
  busy = false,
  error = ''
}) {
  return (
    <div className="ops-cabin-editor__actions">
      {onAdd ? (
        <OpsButton variant="quiet" size="compact" onClick={onAdd} disabled={busy}>
          {addLabel}
        </OpsButton>
      ) : null}
      <OpsButton size="compact" onClick={onSave} loading={busy}>
        Save
      </OpsButton>
      <OpsButton variant="secondary" size="compact" onClick={onCancel} disabled={busy}>
        Cancel
      </OpsButton>
      {error ? <OpsInlineError>{error}</OpsInlineError> : null}
    </div>
  );
}
