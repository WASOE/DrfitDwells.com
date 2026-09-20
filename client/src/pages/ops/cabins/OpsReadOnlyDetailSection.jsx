export default function OpsReadOnlyDetailSection({ title, children, actions }) {
  return (
    <section className="ops-cd-surface">
      <div className="ops-cd-surface__head">
        <h2 className="ops-cd-surface__title">{title}</h2>
        {actions ? <div className="ops-cd-actions">{actions}</div> : null}
      </div>
      <div className="ops-cd-surface__body">{children}</div>
    </section>
  );
}
