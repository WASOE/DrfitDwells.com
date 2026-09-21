import { Link } from 'react-router-dom';
import { opsCx } from './opsCx';

export default function OpsPageHeader({
  title,
  description,
  meta,
  metaPlacement = 'stacked',
  actions,
  back,
  className,
  ...rest
}) {
  const showBack = Boolean(back?.to);
  const metaClassName = metaPlacement === 'inline' ? 'ops-page-header--meta-inline' : null;

  return (
    <header className={opsCx('ops-page-header', metaClassName, className)} {...rest}>
      {showBack ? (
        <p className="ops-page-header__back">
          <Link to={back.to} className="ops-page-header__back-link">
            {back.label}
          </Link>
        </p>
      ) : null}
      <div className="ops-page-header__main">
        <div className="ops-page-header__copy">
          <h1 className="ops-page-header__title">{title}</h1>
          {description ? <p className="ops-page-header__description">{description}</p> : null}
          {meta ? <div className="ops-page-header__meta">{meta}</div> : null}
        </div>
        {actions ? <div className="ops-page-header__actions">{actions}</div> : null}
      </div>
    </header>
  );
}
