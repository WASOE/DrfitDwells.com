import { opsCx } from './opsCx';

export default function OpsPageHeader({ title, description, meta, actions, className, ...rest }) {
  return (
    <header className={opsCx('ops-page-header', className)} {...rest}>
      <div className="ops-page-header__copy">
        <h1 className="ops-page-header__title">{title}</h1>
        {description ? <p className="ops-page-header__description">{description}</p> : null}
        {meta ? <div className="ops-page-header__meta">{meta}</div> : null}
      </div>
      {actions ? <div className="ops-page-header__actions">{actions}</div> : null}
    </header>
  );
}
