import OpsSurface, { OpsSurfaceHeader, OpsSurfaceTitle } from '../../../ops/primitives/OpsSurface';

export default function OpsReadOnlyDetailSection({ title, children, actions }) {
  return (
    <OpsSurface className="ops-cd-surface">
      <OpsSurfaceHeader className="ops-cd-surface__head">
        <OpsSurfaceTitle className="ops-cd-surface__title">{title}</OpsSurfaceTitle>
        {actions ? <div className="ops-cd-actions">{actions}</div> : null}
      </OpsSurfaceHeader>
      <div className="ops-cd-surface__body">{children}</div>
    </OpsSurface>
  );
}
