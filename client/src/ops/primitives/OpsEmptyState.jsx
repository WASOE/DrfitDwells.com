import { opsCx } from './opsCx';

export default function OpsEmptyState({
  variant = 'empty',
  title,
  body,
  action,
  className,
  ...rest
}) {
  return (
    <div
      className={opsCx('ops-empty', className)}
      data-ops-empty-variant={variant}
      {...rest}
    >
      {title ? <p className="ops-empty__title">{title}</p> : null}
      {body ? <p className="ops-empty__body">{body}</p> : null}
      {action}
    </div>
  );
}
