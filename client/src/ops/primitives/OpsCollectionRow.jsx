import { Link } from 'react-router-dom';
import { opsCx } from './opsCx';

export default function OpsCollectionRow({
  title,
  meta,
  status,
  to,
  actions,
  className,
  ...rest
}) {
  const Main = to ? Link : 'div';
  const mainProps = to ? { to } : {};

  return (
    <div className={opsCx('ops-collection-row', className)} {...rest}>
      <Main className="ops-collection-row__main" {...mainProps}>
        <p className="ops-collection-row__title">{title}</p>
        {meta ? <p className="ops-collection-row__meta">{meta}</p> : null}
        {status}
      </Main>
      {actions ? <div className="ops-collection-row__actions">{actions}</div> : null}
    </div>
  );
}
